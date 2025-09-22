const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * 获取当前操作系统类型
 * @returns {string} 操作系统类型：'windows', 'macos', 'linux'
 */
function getPlatform() {
    const platform = os.platform();
    switch (platform) {
        case 'win32':
            return 'windows';
        case 'darwin':
            return 'macos';
        case 'linux':
            return 'linux';
        default:
            return 'linux'; // 默认使用 linux 路径
    }
}

/**
 * 浏览器配置信息
 */
const BROWSERS_CONFIG = {
    chrome: {
        name: 'chrome',
        paths: {
            windows: [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                path.join(
                    os.homedir(),
                    'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
                ),
            ],
            macos: [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            ],
            linux: [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium-browser',
                '/snap/bin/chromium',
            ],
        },
        regKey: 'chrome.exe',
    },
    edge: {
        name: 'edge',
        paths: {
            windows: [
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                path.join(
                    os.homedir(),
                    'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'
                ),
            ],
            macos: [
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ],
            linux: [
                '/usr/bin/microsoft-edge',
                '/usr/bin/microsoft-edge-stable',
            ],
        },
        regKey: 'msedge.exe',
    },
};

/**
 * 通用浏览器检测函数
 * @param {string} browserKey - 浏览器键名
 * @returns {Object} 包含是否存在和路径信息的对象
 */
function detectBrowser(browserKey) {
    const config = BROWSERS_CONFIG[browserKey];
    if (!config) {
        return { path: null, name: browserKey };
    }

    const platform = getPlatform();
    const paths = config.paths[platform] || [];

    // 检查文件系统路径
    for (const browserPath of paths) {
        try {
            if (fs.existsSync(browserPath)) {
                return {
                    path: browserPath,
                    name: config.name,
                };
            }
        } catch (error) {
            continue;
        }
    }

    // Windows 系统尝试注册表检查
    if (platform === 'windows' && config.regKey) {
        try {
            const regQuery = `reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${config.regKey}" /ve`;
            const result = execSync(regQuery, {
                encoding: 'utf8',
                stdio: 'pipe',
            });
            const match = result.match(/REG_SZ\s+(.+)/);
            if (match && match[1]) {
                const browserPath = match[1].trim();
                if (fs.existsSync(browserPath)) {
                    return {
                        path: browserPath,
                        name: config.name,
                    };
                }
            }
        } catch (error) {
            // 注册表查询失败，继续
        }
    }

    // macOS 系统尝试 which 命令
    if (platform === 'macos' || platform === 'linux') {
        try {
            const commandName =
                browserKey === 'chrome' ? 'google-chrome' : browserKey;
            const result = execSync(`which ${commandName}`, {
                encoding: 'utf8',
                stdio: 'pipe',
            });
            const browserPath = result.trim();
            if (browserPath && fs.existsSync(browserPath)) {
                return {
                    path: browserPath,
                    name: config.name,
                };
            }
        } catch (error) {
            // which 命令失败，继续
        }
    }

    return {
        path: null,
        name: config.name,
    };
}

/**
 * 检测所有支持的本地浏览器
 * @returns {Array} 包含所有找到的浏览器信息的数组
 */
function detectAllBrowsers() {
    const allBrowsers = ['chrome', 'edge'];

    const browsers = allBrowsers
        .map((browserKey) => detectBrowser(browserKey))
        .filter((browser) => browser.path);

    return browsers;
}

/**
 * 获取推荐的浏览器（优先级：Chrome > Edge）
 * @returns {Object|null} 推荐使用的浏览器信息，如果没有找到则返回 null
 */
function getRecommendedBrowser() {
    const browsers = detectAllBrowsers();

    if (browsers.length === 0) {
        return null;
    }

    // 按优先级查找浏览器 (chrome > edge)
    const priority = ['chrome', 'edge'];
    for (const browserName of priority) {
        const browser = browsers.find((b) => b.name === browserName);
        if (browser) {
            return browser;
        }
    }

    return browsers[0]; // 返回第一个找到的浏览器
}

// 导出所有函数
module.exports = {
    getRecommendedBrowser,
};

// 如果直接运行此文件，执行检测
if (require.main === module) {
    const browsers = detectAllBrowsers();
    console.log('检测到的浏览器:', browsers);
}

const fsp = require('fs/promises');
const path = require('path');
const puppeteer = require('./puppeteer');
const { sleep, handleSalary, getMatchExcludeWord } = require('./utils');

let browser;
let marketPage;
let logs = [];
let ignoreNum = 0;
let pageNum = 1;

let onetimeStatus = {
    init: false,
};

let queryParams = {}; // { page, query, experience, salary }, 只用到 page
let helloTxt = '';
let cookies = [
    {
        name: 'wt2',
        value: '',
        domain: '.zhipin.com',
        httpOnly: true,
        secure: true,
    },
    {
        name: 'wbg',
        value: '0',
        domain: '.zhipin.com',
        httpOnly: true,
        secure: true,
    },
];
let targetNum;
let timeout = 3000;
let salaryRange = [0, Infinity];
let keySkills = [];
let bossActiveType = '无限制';
let excludeCompanies = [];
let excludeJobs = [];

let headless = 'new';

// 初始化参数、初始化一次性状态、全局错误处理
async function start(conf = {}) {
    ({
        queryParams = {},
        helloTxt = '',
        wt2Cookie = '',
        targetNum = 2,
        timeout = 3000,
        salaryRange = [0, Infinity],
        keySkills = [],
        bossActiveType = '无限制',
        excludeCompanies = [],
        excludeJobs = [],
        headless = 'new',
    } = conf);

    cookies[0].value = wt2Cookie;
    pageNum = queryParams.page || 1;
    ignoreNum = 0;

    [keySkills, excludeCompanies, excludeJobs] = [keySkills, excludeCompanies, excludeJobs].map(list =>
        list.map(item => item.toLowerCase())
    );

    resetOnetimeStatus();

    try {
        myLog(`⏳ 自动打招呼进行中, 本次目标: ${targetNum}; 请耐心等待`);

        await init();
        let vueState = await marketPage.evaluate(() => {
            let state = document.querySelector('#wrap')?.__vue__?.$store?.state; // 用户信息
            if (!state) throw new Error('未找到 vue 数据');
            return JSON.parse(JSON.stringify(state));
        });
        await main(vueState);

        myLog('✨ 任务顺利完成！');
    } catch (error) {
        myLog('当前页码', pageNum);
        myLog('📊 未投递岗位数：', targetNum, '；略过岗位数：', ignoreNum);

        let resList = await Promise.allSettled([
            // 检测 Boss 安全检测
            marketPage.waitForSelector('#wrap > div > div.error-content > div > button[ka="validate_button_click"]'),
            // 检测 抵达沟通上限
            marketPage.waitForSelector('div.dialog-title > .title'),
        ]);
        let [isGotAught, isReachLimit] = resList.filter(curr => curr.status === 'fulfilled');

        if (isGotAught || isReachLimit) {
            if (isGotAught) myLog('❌ 执行出错：检测到 Boss 安全校验。请先在 Boss 网页上完成验证后重试');
            if (isReachLimit) myLog('❌ 执行出错：抵达 Boss 每日沟通上限（100）');
        } else {
            myLog('❌ 执行出错', error);
        }
    }

    await browser?.close()?.catch(e => myLog('关闭无头浏览器出错', e));
    browser = null;
    marketPage = null;
}
/**
 *
 */
async function main(vueState) {
    myLog(
        `页码：${pageNum}；剩余目标：${targetNum}；自定义薪资范围：${
            salaryRange[1] === Infinity ? '不限。' : ''
        }[${salaryRange.join(', ')}]`
    );

    // 执行 -> 检测 -> 翻页
    await autoSayHello(marketPage, vueState);

    if (targetNum <= 0) return; // 打招呼目标完成，退出

    // 获取翻页按钮
    let nextPageBtn = await marketPage.waitForSelector('.ui-icon-arrow-right');
    // 若右翻页按钮是禁用，说明不可翻页，岗位已全部遍历
    if ((await marketPage.evaluate(node => node?.parentElement?.className, nextPageBtn)) === 'disabled') {
        throw new Error(`已遍历所有岗位，但目标未完成`);
    }

    await sleep(10000); // 翻页等 10s

    await marketPage.evaluate(node => node.click(), nextPageBtn);
    ++pageNum;

    await main(vueState);
}
// 遍历此页的工作岗位，过滤不匹配岗位、给筛选出的BOSS打招呼
async function autoSayHello(marketPage, vueState) {
    const jobList = await marketPage.evaluate(() => {
        let jobList = document.querySelector('#wrap .page-job-wrapper')?.__vue__?.jobList;
        return JSON.parse(JSON.stringify(jobList));
    });
    if (!jobList?.length) throw new Error('岗位列表为空');

    let validJobs = jobList.filter(job => {
        let { contact, brandName, jobName, salaryDesc } = job;
        let fullName = `《${brandName}》 ${jobName}`;

        // 选择未沟通的岗位
        if (contact) {
            myLog(`🎃 略过${fullName}：曾沟通`);
            return false;
        }
        // 筛选公司名
        let excludeCompanyName = excludeCompanies.find(name => brandName.includes(name));
        if (excludeCompanyName) {
            myLog(`🎃 略过${fullName}，包含屏蔽公司关键词（${excludeCompanyName}）`);
            return false;
        }

        // 筛选岗位名
        let excludeJobName = getMatchExcludeWord(jobName, excludeJobs);
        if (excludeJobName) {
            myLog(`🎃 略过${fullName}，包含屏蔽工作关键词（${excludeJobName}）`);
            return false;
        }
        // 筛选薪资 取区间有交集的。BOSS 会返回有交集的区间，例如 12-14K，会返回 13-20K
        let [oriSalaryMin, oriSalaryMax] = handleSalary(salaryDesc);
        let [customSalaryMin, customSalaryMax] = salaryRange;
        let availSalary =
            customSalaryMax === Infinity
                ? true // [0, Infinity]，所有工作薪资都比 0 高
                : customSalaryMax >= oriSalaryMin && customSalaryMin <= oriSalaryMax;
        if (!availSalary) {
            myLog(
                `🎃 略过${fullName}，当前 [${oriSalaryMin}, ${oriSalaryMax}], 不满足 [${customSalaryMin}, ${customSalaryMax}]`
            );
            return false;
        }

        job._fullName = fullName;
        job._desc = `${fullName} [${oriSalaryMin}-${oriSalaryMax}K]`;

        return true;
    });

    while (validJobs.length && targetNum > 0) {
        let job = validJobs.shift();

        if (job._fullName === undefined || job._desc === undefined) {
            myLog('111 fullName 或 desc undefined', JSON.stringify(job)); // 异常需处理
            return;
        }

        await newSendHello(job, marketPage, { vueState });
    }
}

/**
 * 仅在“岗位页”执行任务
 * 浏览器挂载 vueState、打招呼相关的 api
 * 校验 工作内容、boss 活跃时间 - 岗位详情接口
 * 添加 BOSS 到沟通列表；
 * 发送自定义招呼语
 */
async function newSendHello(job, marketPage, { vueState }) {
    let { _fullName: fullName, _desc: desc, securityId, lid, encryptJobId } = job;

    // 浏览器挂载 vueState，打招呼相关的 api
    let scriptStr = await fsp.readFile(path.resolve(__dirname, './window-build/index.js'), 'utf-8');
    await marketPage.evaluate(
        async ({ vueState, scriptStr }) => {
            if (!window.vueState) window.vueState = vueState;
            eval(scriptStr);
        },
        {
            vueState,
            scriptStr,
        }
    );

    // 校验 工作内容、boss 活跃时间 - 岗位详情接口
    let errmsg = await marketPage.evaluate(
        async ({ securityId, lid, encryptJobId, excludeJobs, bossActiveType, fullName, keySkills }) => {
            return await window.checkJobDetail(
                { securityId, lid, encryptJobId },
                { excludeJobs, bossActiveType, fullName, keySkills }
            );
        },
        {
            securityId,
            lid,
            encryptJobId,
            excludeJobs,
            bossActiveType,
            fullName,
            keySkills,
        }
    );
    if (errmsg) return myLog(errmsg);

    await sleep(1000);

    // 添加 BOSS 到沟通列表；发送自定义招呼语
    await marketPage.evaluate(
        async ({ helloTxt, securityId, lid, encryptJobId }) => {
            await window.addBossToFriendList({
                securityId,
                lid,
                encryptJobId,
            });

            await window.sleep(3000); // 模拟点击岗位详情，然后跳转BOSS列表沟通

            await window.customGreeting({ helloTxt, vueState: window.vueState, securityId });
        },
        {
            helloTxt,
            securityId,
            lid,
            encryptJobId,
        }
    );

    await sleep(1000);

    targetNum--;

    myLog(`✅ ${desc}`);
}

/**
 * 初始化浏览器、cookie
 * 打开岗位页
 * 检查登录态是否有效
 * 关闭安全问题
 */
async function init() {
    if (!browser) await initBrowserAndSetCookie();
    // 每次页面点击"执行"，重新进行初始化
    if (!onetimeStatus.init) {
        onetimeStatus.init = true;

        // 打开岗位页
        await marketPage.goto(getMarketUrl(), {
            waitUntil: 'networkidle2',
        });
        // 登录态是否有效
        const headerLoginBtn = await marketPage.waitForSelector('.header-login-btn').catch(e => {
            if (e) return false;
        });
        if (headerLoginBtn) throw new Error('登录态过期，请重新获取 cookie');
        // 关闭安全问题弹窗
        await marketPage.click('.dialog-account-safe > div.dialog-container > div.dialog-title > a').catch(e => e);
    }
}
/** 启动浏览器，写入 cookie */
async function initBrowserAndSetCookie() {
    const BROWERLESS = process.env.BROWERLESS;
    if (BROWERLESS) {
        myLog(`使用远程浏览器启动服务，“观察打招呼过程”无效，超时时间建议 16s 以上`);

        browser = await puppeteer.connect({
            browserWSEndpoint: BROWERLESS,
        });
    } else {
        browser = await puppeteer.launch({
            headless, // 是否以浏览器视图调试
            devtools: false,
            defaultViewport: null, // null 则页面和窗口大小一致
        });
    }

    marketPage = await getNewPage();
    await marketPage.setDefaultTimeout(timeout);
    await marketPage.setCookie(...cookies);
}
async function getNewPage() {
    const page = await browser.newPage();
    return page;
}
function getMarketUrl() {
    return `https://www.zhipin.com/web/geek/job?${Object.keys(queryParams)
        .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
        .join('&')}`;
}

function myLog(...args) {
    let str = args.join(' ');
    if (str.includes('略过')) ignoreNum++;

    logs.push(`${str}`);
}
/** 重置一次性状态 */
function resetOnetimeStatus() {
    onetimeStatus.init = false;
}

module.exports = { main: start, logs };

/**
 * 细节：
 * 1. 公司下存在多个职位，名字可能是一样的，但岗位要求不一样；
 * 1.1 区分是否投递过，简单方法就是列表、详情页的“继续沟通”文案；
 * 2. 选择器拿不到，可能是出现“安全问题”弹窗；$$、$、$eval、page.click 等可能会失败
 * 3. arms-retcode.aliyuncs.com/r.png 这个请求 window 本地也会失败
 *
 * 4. 遇到问题，以 headless=false 进行调试
 */

// const fs = require('fs/promises');
const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(stealthPlugin());

let browser;
let marketPage;

let logs = [];
let ignoreNum = 0;
let onetimeStatus = {
    initMarketPage: false,
    checkSafeQues: false,
    checkLogin: false,
};
let textareaSelector = '';
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
let bossActiveType;
let excludeCompanies = [];
let excludeJobs = [];

let headless = 'new';
let openNewTabTime = 1000;

// 读取已投递公司存储，执行 main；
async function start(conf = {}) {
    ({
        queryParams = {},
        helloTxt = '',
        wt2Cookie = '',
        targetNum = 2,
        timeout = 3000,
        salaryRange = [0, Infinity],
        keySkills = [],
        bossActiveType = '',
        excludeCompanies = [],
        excludeJobs = [],
        headless = 'new',
    } = conf);

    cookies[0].value = wt2Cookie;

    [keySkills, excludeCompanies, excludeJobs] = [keySkills, excludeCompanies, excludeJobs].map(list =>
        list.map(item => item.toLowerCase())
    );

    resetOnetimeStatus();

    try {
        myLog(`⏳ 自动打招呼进行中, 本次目标: ${targetNum}; 请耐心等待`);

        await main(queryParams.page);

        myLog('✨ 任务顺利完成！');
    } catch (error) {
        myLog('当前页码', queryParams.page);
        myLog('📊 未投递岗位数：', targetNum, '；略过岗位数：', ignoreNum);
        myLog('❌ 执行出错', error);

        // BOSS安全检测随时可能触发，每一次检测都会耗时，改为报错后检测是否此原因导致的
        let validateButton = await marketPage
            .waitForSelector('#wrap > div > div.error-content > div > button[ka="validate_button_click"]')
            .catch(e => {
                myLog(`${timeout / 1000}s 内未获取到验证问题按钮`);
            });
        if (validateButton) {
            myLog('检测到 Boss 安全校验。请先在 boss 网页上完成验证后重试');
        }
    }

    await browser?.close()?.catch(e => myLog('关闭无头浏览器出错', e));

    browser = null;
    marketPage = null;
}
async function main(pageNum = 1) {
    myLog(
        `页码：${pageNum}；剩余目标：${targetNum}；自定义薪资范围：${
            salaryRange[1] === Infinity ? '不限。' : ''
        }[${salaryRange.join(', ')}]`
    );

    if (!browser) await initBrowserAndSetCookie();

    // 打开新页面或通过页码组件进行翻页
    if (!onetimeStatus.initMarketPage) {
        let marketUrl = getNewMarketUrl(pageNum); // 出现验证页，说明 puppeteer 被检测了(403)
        await marketPage.goto(marketUrl, {
            waitUntil: 'networkidle2', // 与 waitForTimeout 冲突，貌似只能存在一个
            // timeout: 60000,
        });

        await onetimeCheck();
        onetimeStatus.initMarketPage = true;
        myLog('打开岗位页面成功');
    } else {
        myLog('通过页码组件翻页');
        // 点击页码；偶尔出现 BOSS 等待（网页久久不动，会触发资源更新）；最多显示 10 页（一页 30 个岗位）
        await marketPage.waitForSelector('.options-pages > a');
        let pageNumList = Array.from(await marketPage.$$('.options-pages > a')).slice(1, -1); // 页码开头、结尾是导航箭头，不需要
        let numList = await Promise.all(
            pageNumList.map(async node => {
                let txt = await marketPage.evaluate(node => node.innerText, node);
                return Number(txt) || '...';
            })
        );
        let foundIndex = numList.findIndex(num => num === pageNum);
        if (foundIndex === -1) {
            if (pageNum <= 10) {
                throw new Error(`页码不匹配，当前页码：${numList.join(',')}`);
            } else {
                throw new Error(`BOSS 最多返回10页查询结果`);
            }
        }
        await marketPage.evaluate(node => node.click(), pageNumList[foundIndex]);
    }

    await autoSayHello(marketPage);

    if (targetNum > 0) {
        queryParams.page = pageNum + 1;
        await main(queryParams.page);
    }
}
async function autoSayHello(marketPage) {
    await marketPage.waitForSelector('li.job-card-wrapper').catch(e => {
        throw new Error(`${timeout / 1000}s 内未获取岗位列表`);
    });
    let jobCards = Array.from(await marketPage.$$('li.job-card-wrapper'));
    if (!jobCards?.length) {
        throw new Error('岗位列表为空');
    }

    let notPostJobs = await asyncFilter(jobCards, async (node, index) => {
        let companyName = (await node.$eval('.company-name', node => node.innerText)).toLowerCase();
        let jobName = (await node.$eval('.job-name', node => node.innerText)).toLowerCase();
        let fullName = `《${companyName}》 ${jobName}`;
        // 选择未沟通的岗位
        let notCommunicate = (await node.$eval('a.start-chat-btn', node => node.innerText)) !== '继续沟通';
        if (!notCommunicate) {
            myLog(`🎃 略过${fullName}：曾沟通`);
            return false;
        }

        // 筛选公司名
        let excludeCompanyName = excludeCompanies.find(name => companyName.includes(name));
        if (excludeCompanyName) {
            myLog(`🎃 略过${fullName}，包含屏蔽公司关键词（${excludeCompanyName}）`);
            return false;
        }

        // 筛选岗位名
        let excludeJobName = excludeJobs.find(name => jobName.includes(name));
        if (excludeJobName) {
            myLog(`🎃 略过${fullName}，包含屏蔽工作关键词（${excludeJobName}）`);
            return false;
        }

        // 筛选岗位最近更新时间 - lastModifyTime 被官方去掉了
        // let diff = daysBetween(currJobList[index].lastModifyTime);
        // let availDayDistance = jobUpdateTime >= diff;
        // if (!availDayDistance) {
        //     myLog(`🎃 略过 ${companyName} ${jobName}，距离 ${diff} 天更新，不满足 ${jobUpdateTime} 天内更新过`);
        //     return false;
        // }

        // 筛选薪资
        let [oriSalaryMin, oriSalaryMax] = handleSalary(await node.$eval('.salary', node => node.innerText));
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

        Object.assign(node, {
            data: {
                oriSalaryMin,
                oriSalaryMax,
                jobName,
                companyName,
            },
        });
        return true;
    });
    while (notPostJobs.length && targetNum > 0) {
        let node = notPostJobs.shift();
        await sendHello(node, marketPage);
    }
}
// sendHello 跳转到岗位详情页。至少有 3s 等待
async function sendHello(node, marketPage) {
    await marketPage.evaluate(node => node.click(), node); // 点击节点，打开公司详情页
    await sleep(openNewTabTime); // 等待新页面加载。远程浏览器需要更多时间，此处连接或新开页面，时间都会变动。

    // 一般只会有一个详情页。打开一页，执行一个任务，然后关闭页面
    const [detailPage] = (await browser.pages()).filter(page =>
        page.url().startsWith('https://www.zhipin.com/job_detail')
    );
    detailPage?.setDefaultTimeout?.(timeout); // 启动观察就没有这个问题了
    const detailPageUrl = detailPage?.url?.();

    let { oriSalaryMin = 0, oriSalaryMax = 0, companyName = '', jobName = '' } = node.data;
    const fullName = `《${companyName}》 ${jobName}`;

    if (bossActiveType && bossActiveType !== '无限制') {
        // 出错依然执行，但出错仍然被捕获了
        let resList = await Promise.allSettled([
            detailPage.$eval('.boss-active-time', node => node.innerText),
            detailPage.$eval('.boss-online-tag', node => node.innerText),
        ]);

        let res = resList.find(curr => curr.status === 'fulfilled');
        if (!res || !(await checkBossActiveStatus(bossActiveType, res.value))) {
            myLog(`🎃 略过${fullName}，BOSS 活跃时间不符：${res?.value || '活跃时间不存在'}`);
            return await detailPage.close();
        }
    }

    let communityBtn = await detailPage.waitForSelector('.btn.btn-startchat').catch(e => {
        myLog(`${timeout / 1000}s 内未获取到详情页沟通按钮`);
        throw new Error(e);
    });
    let communityBtnInnerText = await detailPage.evaluate(communityBtn => communityBtn.innerText, communityBtn);
    // todo 沟通列表偶尔会缺少待打开的岗位，目前仅 window 出现。等待 add.json 接口。岗位详情页点击打开的链接不对，没有携带 id 等参数
    // console.log('🔎 ~ sendHello ~ communityBtnInnerText data-url:', !(await detailPage.evaluate(communityBtn => communityBtn.getAttribute('data-url'), communityBtn)) && true);

    if (communityBtnInnerText.includes('继续沟通')) {
        myLog(`🎃 略过${fullName}，曾沟通`);
        return await detailPage.close();
    }

    let jobDetail = (await detailPage.$eval('.job-sec-text', node => node.innerText))?.toLowerCase();
    let foundExcludeSkill = excludeJobs.find(word => jobDetail.includes(word));
    if (foundExcludeSkill) {
        myLog(`🎃 略过${fullName}，工作内容包含屏蔽词：${foundExcludeSkill}。\n🛜 复查链接：${detailPageUrl}`);
        return await detailPage.close();
    }
    let notFoundSkill = keySkills.find(skill => !jobDetail.includes(skill));
    if (keySkills.length && notFoundSkill) {
        myLog(`🎃 略过 ${fullName}，工作内容不包含关键技能：${notFoundSkill}。\n🛜 复查链接：${detailPageUrl}`);
        return await detailPage.close();
    }

    await sleep(1000); // todo 沟通列表偶尔会缺少待打开的岗位，仅 window 出现。

    communityBtn.click(); // 点击后，(1)出现小窗 （2）详情页被替换为沟通列表页。

    let availableTextarea;
    if (!textareaSelector) {
        availableTextarea = await initTextareaSelector(detailPage, true);
    } else {
        availableTextarea = await detailPage.waitForSelector(textareaSelector).catch(e => {
            throw new Error(`尝试投递 ${fullName}。使用 ${textareaSelector}，${timeout / 1000}s 内未获取输入框`); // todo
        });
        if (!availableTextarea) throw new Error('没有可用的输入框，点击“启动任务”重试');
    }
    await availableTextarea.type(helloTxt);
    // 2. 点击发送按钮
    await detailPage.click('div.send-message').catch(e => e); // 弹窗按钮
    await detailPage.click('div.message-controls > div > div.chat-op > button').catch(e => e); // 跳转列表按钮
    await sleep(500); // 等待消息发送
    targetNum--;

    // 已投递的公司名
    myLog(`✅ ${fullName} [${oriSalaryMin}-${oriSalaryMax}K]`);

    return await detailPage.close();
}

async function getNewPage() {
    const page = await browser.newPage();
    return page;
}
function getNewMarketUrl(pageNum) {
    if (pageNum) queryParams.page = pageNum;
    return `https://www.zhipin.com/web/geek/job?${Object.keys(queryParams)
        .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
        .join('&')}`;
}
/** 启动浏览器，写入 cookie */
async function initBrowserAndSetCookie() {
    const BROWERLESS = process.env.BROWERLESS;
    if (BROWERLESS) {
        myLog(`使用远程浏览器启动服务，“观察打招呼过程”无效，超时时间建议 16s 以上`);

        browser = await puppeteer.connect({
            browserWSEndpoint: BROWERLESS,
        });
        openNewTabTime = 3000;
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
// 检查是否登录、关闭安全问题
async function onetimeCheck() {
    if (!onetimeStatus.checkLogin) {
        const headerLoginBtn = await marketPage.waitForSelector('.header-login-btn').catch(e => {
            onetimeStatus.checkLogin = true;
            myLog('登录态有效');
        });
        if (headerLoginBtn) {
            throw new Error('登录态过期，请重新获取 cookie');
        }
    }
    if (!onetimeStatus.checkSafeQues) {
        // 关闭安全问题弹窗
        await marketPage.click('.dialog-account-safe > div.dialog-container > div.dialog-title > a').catch(e => {
            myLog('未检测到安全问题弹窗');
            onetimeStatus.checkSafeQues = true;
        });
    }
}
// 获取输入框选择器，需经过 setDefaultTimeout 耗时（自定义为 3s）
async function initTextareaSelector(page, returnNode = false) {
    let originModalTextareaSelector = 'div.edit-area > textarea';
    let jumpListTextareaSelector = 'div.chat-conversation > div.message-controls > div > div.chat-input';

    // 小窗输入
    const originModalTextarea = await page.waitForSelector(originModalTextareaSelector).catch(e => {
        myLog(`${timeout / 1000}s 内未获取到小窗输入框`);
    });
    // 沟通列表输入
    const jumpListTextarea = await page.waitForSelector(jumpListTextareaSelector).catch(e => {
        myLog(`${timeout / 1000}s 内未获取到沟通列表输入框`);
    });

    const selector =
        (originModalTextarea && originModalTextareaSelector) || (jumpListTextarea && jumpListTextareaSelector);
    if (selector) textareaSelector = selector;

    if (returnNode) return originModalTextarea || jumpListTextarea;
}
async function checkBossActiveStatus(type, txt = '') {
    if (!txt) return false;
    if (txt === '在线') return true;

    let result = false;
    let prefix = txt.slice(0, txt.indexOf('活跃'));

    if (
        ![
            '半年前',
            '4月内',
            '5月内',
            '近半年',
            '2月内',
            '3月内',
            '刚刚',
            '今日',
            '3日内',
            '本周',
            '2周内',
            '本月',
        ].includes(prefix)
    ) {
        myLog(`额外BOSS状态：${txt}`);
    }

    switch (type) {
        case '半年内活跃': {
            if (['4月内', '5月内', '近半年'].includes(prefix)) {
                result = true;
            }
        }
        case '3个月内活跃': {
            if (['2月内', '3月内'].includes(prefix)) {
                result = true;
            }
        }
        case '1个月内活跃': {
            if (['刚刚', '今日', '3日内', '本周', '2周内', '3周内', '本月'].includes(prefix)) {
                result = true;
            }
        }
    }

    return result;
}

async function asyncFilter(list = [], fn) {
    const results = await Promise.all(list.map(fn)); // 建设成功返回 true，失败返回 false
    return list.filter((_v, index) => results[index]);
}
function myLog(...args) {
    ignoreNum++;
    logs.push(`${args.join(' ')}`);
}
// 处理 '18-35K·14薪' -> [18, 35]
function handleSalary(str) {
    let reg = /\d+/g;
    let [minStr, maxStr] = str.match(reg);
    return [+minStr, +maxStr];
}
function resetOnetimeStatus() {
    Object.keys(onetimeStatus).forEach(key => {
        onetimeStatus[key] = false;
    });
    ignoreNum = 0;
}
function sleep(time = 1000) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time);
    });
}

module.exports = { main: start, logs };

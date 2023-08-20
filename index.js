/**
 * 细节：
 * 1. 公司下存在多个职位，名字可能是一样的，但岗位要求不一样；
 * 1.1 区分是否投递过，简单方法就是列表、详情页的“继续沟通”文案；
 * 2. 选择器拿不到，可能是出现“安全问题”弹窗；$$、$、$eval、page.click 等可能会失败
 * 3. arms-retcode.aliyuncs.com/r.png 这个请求 window 本地也会失败
 *
 * 4. 遇到问题，以 headless=false 进行调试
 */

const fs = require('fs/promises');
const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(stealthPlugin());

let browser;
let marketPage;
let hasPost = [];
let logs = [];
let onetimeStatus = {
  initMarketPage: false,
  checkSafeQues: false,
  checkLogin: false,
};
let textareaSelector;

let queryParams = {};
let salaryStart = 0;
let keySkills = [];
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
let excludeCompanies = [];
let excludeJobs = [];
let targetNum; // 30个需大概4m30s
let timeout = 3000;
let headless = 'new';

// 读取已投递公司存储，执行 main；
async function start(conf = {}) {
  ({
    queryParams = {},
    salaryStart = 0,
    keySkills = [],
    helloTxt = '',
    wt2Cookie = '',
    targetNum = 2,
    timeout = 3000,
    excludeCompanies = [],
    excludeJobs = [],
    headless = 'new',
  } = conf);
  cookies[0].value = wt2Cookie;

  resetOnetimeStatus();

  let originHasPostContent = await fs.readFile(`${process.cwd()}/hasPostCompany.txt`, 'utf-8');

  try {
    myLog(`⏳ 自动打招呼进行中, 本次目标: ${targetNum}; 请耐心等待`);

    await main(queryParams.page);

    myLog('✨ 任务顺利完成！');
  } catch (error) {
    myLog('❌ 执行出错', error);
  }
  if (hasPost.length) {
    let hasPostCompanyStr = [originHasPostContent, '-------', hasPost.join('\n')].join('\n');
    await fs.writeFile(`${process.cwd()}/hasPostCompany.txt`, hasPostCompanyStr);
  }
  await browser.close().catch(e => myLog('关闭无头浏览器出错', e));
  browser = null;
}
async function main(pageNum = 1) {
  myLog(`页数：${pageNum}；剩余目标：${targetNum}；自定义起薪：${salaryStart}`);

  if (!browser) await initBrowserAndSetCookie();

  // 打开新页面或通过页码组件进行翻页
  if (!onetimeStatus.initMarketPage) {
    let marketUrl = getNewMarketUrl(pageNum); // 出现验证页，说明 puppeteer 被检测了(403)
    await marketPage.goto(marketUrl, {
      waitUntil: 'networkidle2', // 与 waitForTimeout 冲突貌似只能存在一个
      // timeout: 60000,
    });

    await onetimeCheck();
    onetimeStatus.initMarketPage = true;
    myLog('打开岗位页面成功');
    // marketPage.waitForNavigation(); // 加了，超时（默认3秒）会报错；关浏览器或页面，也报错
  } else {
    myLog('通过页码组件翻页');
    // 点击页码；偶尔出现 BOSS 等待（网页久久不动，会触发资源更新）
    await marketPage.waitForSelector('.options-pages > a');
    let pageNumList = Array.from(await marketPage.$$('.options-pages > a')).slice(1, -1); // 页码开头、结尾是导航箭头，不需要
    let numList = await Promise.all(
      pageNumList.map(async node => {
        return Number(await marketPage.evaluate(node => node.innerText, node));
      })
    );
    let foundIndex = numList.findIndex(num => num === pageNum);
    if (foundIndex === -1) throw new Error(`页码不匹配，${numList.join(',')}`);

    await marketPage.evaluate(node => node.click(), pageNumList[foundIndex]);
  }

  await autoSayHello(marketPage);

  if (targetNum > 0) {
    queryParams.page = pageNum + 1;
    await main(queryParams.page);
  }
}
/** 启动浏览器，写入 cookie */
async function initBrowserAndSetCookie() {
  browser = await puppeteer.launch({
    headless, // 是否以浏览器视图调试
    // headless: false,
    // slowMo: 500, // 逻辑执行速度
    devtools: false,
    defaultViewport: null, // null 则页面和窗口大小一致
  });
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
    console.log('headerLoginBtn', headerLoginBtn);
    if (headerLoginBtn) {
      throw new Error('登录态过期，请重新获取 cookie');
    }
  }
  if (!onetimeStatus.checkSafeQues) {
    // 关闭安全问题弹窗
    await marketPage.click('.dialog-account-safe > div.dialog-container > div.dialog-title > a').catch(e => {
      myLog('未检测到安全问题弹窗');
    });
    onetimeStatus.checkSafeQues = true;
  }
}
function resetOnetimeStatus() {
  Object.keys(onetimeStatus).forEach(key => {
    onetimeStatus[key] = false;
  });
}

async function autoSayHello(marketPage) {
  await marketPage.waitForSelector('li.job-card-wrapper').catch(e => {
    throw new Error('3s 内未获取岗位列表');
  });
  let jobCards = Array.from(await marketPage.$$('li.job-card-wrapper'));
  if (!jobCards?.length) {
    throw new Error('岗位列表为空');
  }

  let notPostJobs = await asyncFilter(jobCards, async node => {
    let notCommunicate = (await node.$eval('a.start-chat-btn', node => node.innerText)) !== '继续沟通'; // 岗位卡片存在，是否沟通的文案
    let [oriSalaryMin, oriSalaryMax] = handleSalary(await node.$eval('.salary', node => node.innerText));
    let availSalary = oriSalaryMax > salaryStart;

    let jobName = (await node.$eval('.job-name', node => node.innerText)).toLowerCase();
    let availJobName = !excludeJobs.some(name => jobName.includes(name));

    let companyName = (await node.$eval('.company-name', node => node.innerText)).toLowerCase();
    let availCompanyName = !excludeCompanies.some(name => companyName.includes(name));

    if (notCommunicate && availSalary && availJobName && availCompanyName) {
      Object.assign(node, {
        _oriSalaryMin: oriSalaryMin,
        _oriSalaryMax: oriSalaryMax,
        _jobName: jobName,
        _companyName: companyName,
      });
      return true;
    }
  });
  myLog('初筛岗位数量：', notPostJobs?.length);

  while (notPostJobs.length && targetNum > 0) {
    let node = notPostJobs.shift();
    await sendHello(node, marketPage);
  }
}
// sendHello 至少有 3s 等待
async function sendHello(node, marketPage) {
  await marketPage.evaluate(node => node.click(), node); // 点击节点，打开公司详情页
  await sleep(1000); // 等待新页面

  // 一般只会有一个详情页。打开一页，执行一个任务，然后关闭页面
  let [detailPage] = (await browser.pages()).filter(page => page.url().startsWith('https://www.zhipin.com/job_detail'));
  detailPage.setDefaultTimeout(timeout);

  let { _oriSalaryMin: oriSalaryMin, _oriSalaryMax: oriSalaryMax, _companyName: companyName, _jobName: jobName } = node;
  let communityBtn = await detailPage.waitForSelector('.btn.btn-startchat').catch(e => {
    myLog('3s 内未获取到详情页沟通按钮');
    throw new Error(e);
  });
  let communityBtnInnerText = await detailPage.evaluate(communityBtn => communityBtn.innerText, communityBtn);
  if (communityBtnInnerText.includes('继续沟通')) {
    myLog(`🎃 略过 ${companyName} ${jobName}，曾沟通`);
    return await detailPage.close();
  }

  let jobDetail = (await detailPage.$eval('.job-sec-text', node => node.innerText))?.toLowerCase();
  if (keySkills.length && keySkills.some(skill => !jobDetail.includes(skill))) {
    myLog(`🎃 略过：${companyName} ${jobName}，工作内容不包含关键技能；${keySkills.join(',')}`);
    return await detailPage.close();
  }

  communityBtn.click(); // 点击后，(1)出现小窗 （2）详情页被替换为沟通列表页
  // await sleep(1000);

  let availableTextarea;
  if (!textareaSelector) {
    availableTextarea = await initTextareaSelector(detailPage, true);
  } else {
    availableTextarea = await detailPage.waitForSelector(textareaSelector).catch(e => {
      throw new Error(`使用 ${textareaSelector}，3s 内未获取输入框`);
    });
    if (!availableTextarea) throw new Error('没有可用的输入框');
  }
  await availableTextarea.type(helloTxt);
  // 2. 点击发送按钮
  await detailPage.click('div.send-message').catch(e => e); // 弹窗按钮
  await detailPage.click('div.message-controls > div > div.chat-op > button').catch(e => e); // 跳转列表按钮
  await sleep(1000); // 等待消息发送
  targetNum--;

  // 打印已投递公司名
  myLog(`✅ ${companyName} ${jobName} [${oriSalaryMin}-${oriSalaryMax}K]`);
  hasPost.push(`${getCurrDate()}: ${companyName} ${jobName}`);

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
// 获取输入框选择器，需经过 setDefaultTimeout 耗时（自定义为 3s）
async function initTextareaSelector(page, returnNode = false) {
  let originModalTextareaSelector = 'div.edit-area > textarea';
  let jumpListTextareaSelector = 'div.chat-conversation > div.message-controls > div > div.chat-input';

  const originModalTextarea = await page.waitForSelector(originModalTextareaSelector).catch(e => {
    myLog('3s 内未获取到小窗输入框');
  }); // 小窗输入
  const jumpListTextarea = await page.waitForSelector(jumpListTextareaSelector).catch(e => {
    myLog('3s 内未获取到沟通列表输入框');
  }); // 沟通列表输入

  const selector =
    (originModalTextarea && originModalTextareaSelector) || (jumpListTextarea && jumpListTextareaSelector);
  if (selector) textareaSelector = selector;

  if (returnNode) return originModalTextarea || jumpListTextarea;
}

function sleep(time = 1000) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, time);
  });
}
function getCurrDate() {
  let stamp = new Date();
  let year = stamp.getFullYear();
  let month = ('0' + (stamp.getMonth() + 1)).slice(-2);
  let date = ('0' + stamp.getDate()).slice(-2);
  let hours = ('0' + stamp.getHours()).slice(-2);
  let mins = ('0' + stamp.getMinutes()).slice(-2);
  let seconds = ('0' + stamp.getSeconds()).slice(-2);
  return `${year}年${month}月${date}日 ${hours}时${mins}分${seconds}秒`;
}
async function asyncFilter(list = [], fn) {
  const results = await Promise.all(list.map(fn)); // 并发完成
  return list.filter((_v, index) => results[index]);
}
function myLog(...args) {
  logs.push(`${args.join(' ')}`);
}
// 处理 '18-35K·14薪' -> [18, 35]
function handleSalary(str) {
  let reg = /\d+/g;
  let [minStr, maxStr] = str.match(reg);
  return [+minStr, +maxStr];
}

function isError(res) {
  if (res.stack && res.message) {
    return true;
  }
  return false;
}
function promiseQueue(list) {
  let result = [];
  return list
    .reduce((accu, curr) => {
      return accu.then(curr).then(data => {
        result.push(data);
        return result;
      });
    }, Promise.resolve())
    .catch(err => `promiseQueue err: ${err}`);
}

module.exports = { main: start, logs };

/**
 * 🟩 每天固定时间执行任务，在 BOSS 上自动打招呼指定数量的岗位；
 * ⬜️ cookie 过期，发邮件通知修改 cookie;
 *
 * 细节：
 * 1. 公司下存在多个职位，名字可能是一样的，但岗位要求不一样；
 * 1.1 区分是否投递过，简单方法就是详情页的“继续沟通”文案；
 * 2. 选择器拿不到，可能是出现“安全问题”弹窗；$$、$、$eval、page.click、
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

let queryParams = {};
let salaryStart = 0;
let keySkills = [];
let targetNum; // 30个需大概4m30s
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
let headless = 'new';

// 读取已投递公司存储，执行 main；
async function start(
  conf = {
    queryParams: {},
    salaryStart,
    keySkills: [],
    targetNum: 2,
    helloTxt: '',
    wt2Cookie: '',
    excludeCompanies: [],
    excludeJobs: [],
    headless: false,
  }
) {
  ({
    queryParams = {},
    salaryStart = 0,
    keySkills = [],
    targetNum = 2,
    helloTxt = '',
    wt2Cookie = '',
    excludeCompanies = [],
    excludeJobs = [],
    headless = false,
  } = conf);
  cookies[0].value = wt2Cookie;

  let originHasPostContent = await fs.readFile(`${process.cwd()}/hasPostCompany.txt`, 'utf-8');

  try {
    myLog(`自动打招呼进行中, 本次目标: ${targetNum}; 请耐心等待`);

    await main(queryParams.page);

    myLog('✨任务顺利完成！');
  } catch (error) {
    myLog('🚀执行错误', error);
  }
  if (hasPost.length) {
    let hasPostCompanyStr = [originHasPostContent, '-------', hasPost.join('\n')].join('\n');
    await fs.writeFile(`${process.cwd()}/hasPostCompany.txt`, hasPostCompanyStr);
  }
  // process.exit();
  await browser.close().catch(e => myLog('成功关闭无头浏览器'));
  browser = null;
}
async function main(pageNum = 1) {
  myLog('页数:', pageNum, '; 剩余目标:', targetNum, '; 自定义起薪:', `${salaryStart}K`);

  if (!browser) await initBrowserAndSetCookie();
  let marketUrl = getNewMarketUrl(pageNum); // 出现验证页，说明 puppeteer 被检测了(403)
  myLog('岗位市场链接', marketUrl);

  await marketPage.goto(marketUrl, {
    waitUntil: 'networkidle2', // 与 waitForTimeout 冲突貌似只能存在一个
    // timeout: 60000,
  });
  // marketPage.waitForNavigation(); // 加了，超时（默认3秒）会报错；关浏览器或页面，也报错

  // 关闭安全问题弹窗
  await marketPage.click('.dialog-account-safe > div.dialog-container > div.dialog-title > a').catch(e => e);

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
  await marketPage.setCookie(...cookies);
}
async function autoSayHello(marketPage) {
  // 1. 获取卡片列表卡片右侧可点击区域，不投大厂、已投递
  // let cards = await marketPage.$$('li.job-card-wrapper'); // 卡片选择器
  // h3 > a，h3.innerText 可以拿到
  let jobCards = Array.from(await marketPage.$$('li.job-card-wrapper'));

  let notPostJobs = await asyncFilter(jobCards, async node => {
    let notCommunicate = (await node.$eval('a.start-chat-btn', node => node.innerText)) !== '继续沟通';
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
  myLog('白名单岗位：', notPostJobs?.length);

  while (notPostJobs.length && targetNum > 0) {
    let node = notPostJobs.shift();
    // if (!node) return console.error('节点捕获失败');
    await sendHello(node, marketPage);
  }
}
// sendHello 至少有 3s 等待
async function sendHello(node, marketPage) {
  await marketPage.evaluate(node => node.click(), node); // 点击公司卡片的右侧区域，打开公司详情页
  await sleep(1000); // 等待新页面

  // 一般只会有一个详情页。打开一页，执行一个任务，然后关闭页面
  let [detailPage] = (await browser.pages()).filter(page => page.url().startsWith('https://www.zhipin.com/job_detail'));

  let communityBtn = await detailPage.$('.btn.btn-startchat'); // todo waitForSelector
  let communityBtnInnerText = await detailPage.evaluate(communityBtn => communityBtn.innerText, communityBtn);
  if (communityBtnInnerText.includes('继续沟通')) {
    return await detailPage.close();
  }

  let jobDetail = (await detailPage.$eval('.job-sec-text', node => node.innerText))?.toLowerCase();
  if (keySkills.length && keySkills.some(skill => !jobDetail.includes(skill))) {
    return await detailPage.close();
  }

  communityBtn.click(); // 点击后，(1)出现小窗 （2）详情页被替换为沟通列表页
  await sleep(1000);

  // 1. 找到打招呼输入框，输入内容，并触发 input 事件
  const originModalTextarea = await detailPage.$('div.edit-area > textarea').catch(e => e); // 小窗输入
  const jumpListTextarea = await detailPage
    .$('div.chat-conversation > div.message-controls > div > div.chat-input')
    .catch(e => e); // 沟通列表输入
  const availableTextarea = originModalTextarea || jumpListTextarea;
  await availableTextarea.type(helloTxt);
  // 2. 点击发送按钮
  await detailPage.click('div.send-message').catch(e => e); // 弹窗按钮
  await detailPage.click('div.message-controls > div > div.chat-op > button').catch(e => e); // 跳转列表按钮
  await sleep(1000); // 等待消息发送
  targetNum--;

  // 打印已投递公司名
  let { _oriSalaryMin: oriSalaryMin, _oriSalaryMax: oriSalaryMax, _companyName: companyName, _jobName: jobName } = node;
  myLog(`✅ ${companyName} ${jobName} [${oriSalaryMin}-${oriSalaryMax}K]`);
  hasPost.push(`${getCurrDate()}: ${companyName} ${jobName}`);

  return await detailPage.close();

  // await sleep(1000); // 无意义，缓一缓
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
function myLog(name = '', txt = '') {
  logs.push(`${[name, txt].join(' ')}`);
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

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
const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);

const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(stealthPlugin());

let browser;
let marketPage;
let targetNum; // 30个需大概4m30s
let hasPost = [];
// let hasScreenShot = false;
let logs = [];
let queryParams = {};
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
let excludeCompanies = [
  '阿里巴巴',
  '字节跳动',
  '今日头条',
  '网易',
  '腾讯',
  '百度',
  'Shopee',
  '深圳腾娱互动科技',
  '人才',
  '信息技术',
];
let excludeJobs = [];
let helloTxt = '';

// 读取已投递公司存储，执行 main；
async function start(
  conf = {
    targetNum,
    queryParams: {},
    wt2Cookie: '',
    excludeCompanies: [],
    excludeJobs: [],
    helloTxt: '',
  }
) {
  ({ targetNum, queryParams, wt2Cookie, excludeCompanies = [], excludeJobs = [], helloTxt } = conf);
  cookies[0].value = wt2Cookie;

  let originHasPostContent = await fs.readFile(`${process.cwd()}/hahPostCompany.txt`, 'utf-8');

  try {
    myLog(`自动打招呼进行中, 本次目标: ${targetNum}; 请耐心等待`);

    await main(queryParams.page);

    myLog('✨任务顺利完成！');
  } catch (error) {
    myLog('🚀 ~ file: index.js:51 ~ error:', error);
  }
  if (hasPost.length) {
    let hasPostCompanyStr = [originHasPostContent, '-------', hasPost.join('\n')].join('\n');
    await fs.writeFile(`${process.cwd()}/hahPostCompany.txt`, hasPostCompanyStr);
  }
  // process.exit();
  await browser.close().catch(e => myLog('成功关闭无头浏览器'));
  browser = null;
}
async function main(pageNum = 1) {
  myLog('页数:', pageNum, '; 剩余目标:', targetNum);

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
    headless: 'new', // 是否以浏览器视图调试
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
  // myLog('🚀 ~ file: index.js:122 ~ autoSayHello ~ jobCards:', jobCards?.length);

  let notPostJobs = await asyncFilter(jobCards, async node => {
    let jobName = await node.$eval('.job-name', node => node.innerText);
    let companyName = await node.$eval('.company-name', node => node.innerText);
    let hasCommunicate = (await node.$eval('a.start-chat-btn', node => node.innerText)) === '继续沟通';

    if (
      !hasCommunicate &&
      !excludeJobs.some(name => jobName.includes(name)) &&
      !excludeCompanies.some(name => companyName.includes(name))
    ) {
      node._jobName = jobName;
      node._companyName = companyName;
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
  await sleep(1000); // 等待资源加载

  // 一般只会有一个详情页。打开一页，执行一个任务，然后关闭页面
  let [detailPage] = (await browser.pages()).filter(page => page.url().startsWith('https://www.zhipin.com/job_detail'));

  let communityBtn = await detailPage.$('.btn.btn-startchat');
  let communityBtnInnerText = await detailPage.evaluate(communityBtn => communityBtn.innerText, communityBtn);
  if (communityBtnInnerText.includes('继续沟通')) {
    return await detailPage.close();
  }
  communityBtn.click(); // 点击后，详情页被替换为沟通列表页
  await sleep(1000);

  // textarea 输入必须用以下方式触发，解除“发送”按钮禁用
  // 1. 找到打招呼输入框，输入内容，并触发 input 事件
  // todo 可能出现“安全问题”验证，导致选择器失效
  await detailPage.$eval(
    // 'div.edit-area > textarea', // 详情页，原弹窗的输入框
    'div.chat-conversation > div.message-controls > div > div.chat-input', // 沟通列表-输入框；出错计数：3，碰到“安全问题”
    (element, helloTxt) => {
      // element.value = helloTxt;
      element.innerText = helloTxt;
      element.dispatchEvent(new Event('input')); // 触发输入事件
    },
    helloTxt
  );

  // 2. 点击发送按钮
  // await detailPage.click('div.send-message');
  await detailPage.click('div.message-controls > div > div.chat-op > button');
  await sleep(1000); // 等待接口响应
  targetNum--;

  // 打印已投递公司名
  let { _companyName: companyName, _jobName: jobName } = node;
  myLog(`✅：${companyName} ${jobName}`);
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

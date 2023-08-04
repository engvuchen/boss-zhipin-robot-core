# boss-zhipin-robot

《BOSS 直聘》半自动打招呼工具；

最近一次 node.js 依赖：`v18.16.0`；

使用：

1. 执行 `npm install`；
2. 先在 BOSS 直聘[登陆页](https://www.zhipin.com/web/user/?ka=header-login)登入个人账号；
3. 使用 Chrome 控制台工具， 切换到 Application（应用），点击“存储- Cookie”，获取个人 cookie（wbg，wbg）；

![image-20230726165716384](https://engvu.oss-cn-shenzhen.aliyuncs.com/7a185a08a64782df63119eb61b0ab966.webp)

4. 将个人 cookie 替换 index.js 中的 `cookies` 变量；
5. 执行 `npm run main`；

预设条件：

1. 预设打招呼数量：5； - 变量 `targetNum`；
2. 预设筛选条件：前端开发工程师、深圳、工作经验 1-3 年、薪资待遇 10-20 K 、学历要求“本科”； - 变量 `queryParams`；
3. 预设不投递公司：阿里巴巴、字节跳动、腾讯、百度、Shopee、深圳腾娱互动科技； - 变量 `excludesCompanies`；
4. Github Action 预设北京时间早上9点59分自动执行逻辑；- `main.yml`

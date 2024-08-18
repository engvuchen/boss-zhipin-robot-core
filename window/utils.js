/**
 * 将薪水字符串转为数组
 * '18-35K·14薪' -> [18, 35]
 * '500-1000元' -> [0.5, 1]
 */
function handleSalary(str) {
    let reg = /\d+/g;
    let [minNum, maxNum] = str.match(reg).map(str => +str);

    // 适配“元”
    if (!str.includes('K')) {
        minNum = parseFloat((minNum / 1000).toFixed(4));
        maxNum = parseFloat((maxNum / 1000).toFixed(4));
    }

    return [minNum, maxNum];
}
function sleep(time = 1000) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time);
    });
}

function getDataFormJobUrl(url) {
    let queryData = handleQueryStr(url);
    queryData.encryptJobId = getEncryptJobId(url);
    return queryData;
}
/** 获取 encryptJobId */
function getEncryptJobId(url) {
    let reg = /job_detail[/](.+)?[.]html/;
    let [, id] = url.match(reg);
    return id;
}
/**
 * 从完整的 url 中，获取查询参数对象
 * 对 page、query 有特殊处理
 */
function handleQueryStr(url) {
    let [, queryStr = ''] = url.split('?');
    // a=11&b=222
    let queryObj = {};
    queryStr.split('&').map(currStr => {
        let [key, val] = currStr.split('=');

        switch (key) {
            case 'page':
                val = Number(val);
                break;
            case 'query':
                val = decodeURIComponent(val);
                break;
            default:
                break;
        }
        queryObj[key] = val;
    });
    return queryObj;
}

const getRootVue = async () => {
    let wrap = window.document.querySelector('#wrap');
    if (!wrap.__vue__) throw new Error('未找到vue根组件');
    return wrap.__vue__; // wrap.__vue__?.$store?.state
};
/**
 * @returns {Object} { key: value }
 */
function parseCookies() {
    console.log('🔎 ~ parseCookies ~ window?.document?.cookie:', window?.document?.cookie);

    const cookies = window?.document?.cookie?.split('; '); // 分隔各个 cookie
    const cookieObject = {};

    cookies.forEach(cookie => {
        const [key, value] = cookie.split('='); // 分隔 cookie 的键和值
        cookieObject[key] = decodeURIComponent(value); // 将值解码并存入对象
    });

    return cookieObject;
}

module.exports = {
    handleSalary,
    sleep,
    handleQueryStr,
    getDataFormJobUrl,
    getRootVue,
    parseCookies,
};

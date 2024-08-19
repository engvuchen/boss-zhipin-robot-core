function sleep(time = 1000) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time);
    });
}

// const getRootVue = async () => {
//     let wrap = window.document.querySelector('#wrap');
//     if (!wrap.__vue__) throw new Error('未找到vue根组件');
//     return wrap.__vue__; // wrap.__vue__?.$store?.state
// };
/**
 * @returns {Object} { key: value }
 */
function parseCookies() {
    const cookies = window?.document?.cookie?.split('; '); // 分隔各个 cookie
    const cookieObject = {};

    cookies.forEach(cookie => {
        const [key, value] = cookie.split('='); // 分隔 cookie 的键和值
        cookieObject[key] = decodeURIComponent(value); // 将值解码并存入对象
    });

    return cookieObject;
}

export { sleep, getDataFormJobUrl, parseCookies };

// module.exports = {
//     handleSalary,
//     sleep,
//     handleQueryStr,
//     getDataFormJobUrl,
//     getRootVue,
//     parseCookies,
// };

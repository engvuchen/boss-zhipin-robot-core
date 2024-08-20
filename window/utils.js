function sleep(time = 1000) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time);
    });
}

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

async function filterByCard(card, { excludeJobs, bossActiveType, fullName }) {
    let { lid, securityId } = card;

    const res = await requestCard({
        lid,
        securityId,
        encryptJobId,
    });
    if (res.data.code == 0) throw new Error('请求响应错误:' + res.data.message);

    let { activeTimeDesc, postDescription: jobDetail } = res.data.zpData.jobCard;

    // 过滤 BOSS 活跃时间 todo
    if (
        bossActiveType !== '无限制' &&
        (!activeTimeDesc || !(await checkBossActiveStatus(bossActiveType, activeTimeDesc)))
    ) {
        myLog(`🎃 略过${fullName}，Boss 活跃时间不符：${activeTimeDesc || '活跃时间不存在'}`);
        // return await detailPage.close();
        return false;
    }

    let detailPageUrl = getDetailUrl({ encryptJobId, lid, securityId });
    // 工作内容 不可包含屏蔽词
    let foundExcludeSkill = excludeJobs.find(word => jobDetail.includes(word));
    if (foundExcludeSkill) {
        myLog(`🎃 略过${fullName}，工作内容包含屏蔽词：${foundExcludeSkill}。\n🛜 复查链接：${detailPageUrl}`);
        return false;
    }
    // 工作内容 - 需包含关键技能
    let notFoundSkill = keySkills.find(skill => !jobDetail.includes(skill));
    if (keySkills.length && notFoundSkill) {
        myLog(`🎃 略过 ${fullName}，工作内容不包含关键技能：${notFoundSkill}。\n🛜 复查链接：${detailPageUrl}`);
        return false;
    }
}
async function checkBossActiveStatus(type, txt = '') {
    if (!txt) return false;
    if (txt === '在线') return true;

    let prefix = txt.slice(0, txt.indexOf('活跃'));

    switch (type) {
        case '半年内活跃': {
            if (['4月内', '5月内', '近半年'].includes(prefix)) {
                return true;
            }
        }
        case '3个月内活跃': {
            if (['2月内', '3月内'].includes(prefix)) {
                return true;
            }
        }
        case '1个月内活跃': {
            if (['刚刚', '今日', '3日内', '本周', '2周内', '3周内', '本月'].includes(prefix)) {
                return true;
            }
        }
    }

    return false;
}
function getDetailUrl({ encryptJobId, lid, securityId }) {
    return `https://www.zhipin.com/job_detail/${encryptJobId}.html?lid=${lid}&securityId=${securityId}&sessionId=`;
}

export { sleep, getDataFormJobUrl, parseCookies, filterByCard };

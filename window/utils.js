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

    cookies.forEach((cookie) => {
        const [key, value] = cookie.split('='); // 分隔 cookie 的键和值
        cookieObject[key] = decodeURIComponent(value); // 将值解码并存入对象
    });

    return cookieObject;
}

/**
 * 通过岗位详情接口，校验 BOSS 活跃时间、工作内容（屏蔽词、关键技能）
 */
async function checkJobDetail(
    { lid, securityId, encryptJobId } = {},
    { bossActiveType, excludeJobs, keySkills, fullName } = {}
) {
    const res = await window.requestCard({
        lid,
        securityId,
        encryptJobId,
    });
    if (res.data.code !== 0) {
        throw new Error('requestCard 响应错误:' + res.data.message);
    }

    let { activeTimeDesc, postDescription: jobDetail } =
        res.data.zpData.jobCard;

    jobDetail = jobDetail.toLowerCase();

    // 过滤 BOSS 活跃时间
    if (
        bossActiveType !== '无限制' &&
        (!activeTimeDesc ||
            !(await checkBossActiveStatus(bossActiveType, activeTimeDesc)))
    ) {
        return `🎃 略过${fullName}，Boss 活跃时间不符：${
            activeTimeDesc || '活跃时间不存在'
        }`;
    }

    let detailPageUrl = getDetailUrl({ encryptJobId, lid, securityId });
    // 工作内容 不可包含屏蔽词
    let foundExcludeSkill = getMatchExcludeWord(jobDetail, excludeJobs);
    if (foundExcludeSkill) {
        return `🎃 略过${fullName}，工作内容包含屏蔽词：${foundExcludeSkill}。\n🛜 复查链接：${detailPageUrl}`;
    }
    // 工作内容 - 需包含关键技能
    let notFoundSkill = keySkills.find(
        (skill) => !jobDetail.toLowerCase().includes(skill.toLowerCase())
    );
    if (keySkills.length && notFoundSkill) {
        return `🎃 略过${fullName}，工作内容不包含关键技能：${notFoundSkill}。\n🛜 复查链接：${detailPageUrl}`;
    }
}
// todo
async function checkBossActiveStatus(type, txt = '') {
    if (!txt) return false;
    if (txt === '在线') return true;
    
    // 僵尸岗位-特殊排除
    // const zombieList = [
    //     '2月内活跃',
    //     '3月内活跃',
    //     '4月内活跃',
    //     '5月内活跃',
    //     '近半年活跃',
    //     '半年前活跃',
    // ];
    // if (zombieList.includes(txt)) return true;
    // return;

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
            if (
                [
                    '刚刚',
                    '今日',
                    '3日内',
                    '本周',
                    '2周内',
                    '3周内',
                    '本月',
                ].includes(prefix)
            ) {
                return true;
            }
        }
    }

    return false;
}
function getDetailUrl({ encryptJobId, lid, securityId }) {
    return `https://www.zhipin.com/job_detail/${encryptJobId}.html?lid=${lid}&securityId=${securityId}&sessionId=`;
}

/**
 * 若内容包含排除词，返回它；否则返回 false。若是反义词检测返回 false
 *
 * 工作名、工作详情，可能包含：
 * 1. 非外包
 * 2. 不考虑外包
 */
function getMatchExcludeWord(content = '', excludeWords = []) {
    let wordsMayOppositeRegs = ['外包', '派遣', '驻场', '外派'].map(
        (word) => new RegExp(`(?<=非.{0,5})${word}`)
    );

    let lowerCaseContent = content.toLowerCase();
    for (let i = 0; i < excludeWords.length; i++) {
        const name = excludeWords[i];

        // 若反义词匹配，返回
        if (wordsMayOppositeRegs.find((reg) => reg.test(lowerCaseContent))) {
            return false;
        } else {
            // 反义词不匹配。判断排除词是否包括
            if (lowerCaseContent.includes(name)) {
                return name;
            }
        }
    }
}

export { sleep, parseCookies, checkJobDetail, getMatchExcludeWord };

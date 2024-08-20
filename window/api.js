import axios from 'axios';
import { StopError } from './error';
import { parseCookies } from './utils';
import { Message } from './protobuf';

function requestCard(params = { securityId: '', lid: '' }) {
    return axios.get('https://www.zhipin.com/wapi/zpgeek/job/card.json', {
        params,
        timeout: 5000,
    });
}

/**
 * 添加 BOSS 到沟通列表
 * @param {Object} page puppeteerPage
 * @param {Object} data { securityId: '', encryptJobId: '', lid: '' }
 * @param {Number} retries
 * @returns
 */
async function addBossToFriendList(data = { securityId: '', encryptJobId: '', lid: '' }, retries = 3) {
    if (retries === 0) throw new StopError('addBossToFriendList 重试多次失败');

    const token = parseCookies(window.document.cookies)?.bst;
    if (!token) throw new StopError('没有获取到 token');

    try {
        const res = await axios({
            url: 'https://www.zhipin.com/wapi/zpgeek/friend/add.json',
            method: 'POST',
            params: {
                securityId: data.securityId,
                jobId: data.encryptJobId,
                lid: data.lid,
            },
            headers: { Zp_token: token },
        });
        if (res.data.code === 1 && res.data?.zpData?.bizData?.chatRemindDialog?.content) {
            throw new StopError(res.data?.zpData?.bizData?.chatRemindDialog?.content);
        }

        if (res.data.code !== 0) {
            throw new StopError('状态错误:' + res.data.message);
        }

        return res.data;
    } catch (e) {
        if (e instanceof StopError) {
            throw e;
        }

        return addBossToFriendList(data, retries - 1);
    }
}

/**
 * 给BOSS打招呼
 * @param {String} helloTxt
 */
async function customGreeting({ helloTxt, vueState, securityId }) {
    const userInfo = vueState?.userInfo;
    const uid = userInfo?.userId; // todo 从页面上的 dom 获取
    if (!uid) throw new Error('没有获取到 uid');

    const bossData = await getBossData({
        encryptUserId: userInfo.encryptUserId,
        securityId,
    }); // 获取打招呼信息

    const buf = new Message({
        form_uid: uid.toString(),
        to_uid: bossData.data.bossId.toString(),
        to_name: bossData.data.encryptBossId, // encryptUserId
        content: helloTxt,
    });

    console.log(333, buf.send);

    buf.send();
}
/**
 * 获取BOSS信息，构造打招呼参数
 * @param {Object} params
 * @param {Number} retries
 * @returns
 */
async function getBossData(params = { encryptUserId: '', securityId: '' }, retries = 3) {
    if (retries === 0) throw new StopError('getBossData 重试多次失败');

    const token = parseCookies(window.document.cookies)?.bst;
    if (!token) throw new StopError('没有获取到 token');

    try {
        const data = new FormData();
        data.append('bossId', params.encryptUserId);
        data.append('securityId', params.securityId);
        data.append('bossSrc', '0');

        const res = await axios({
            url: 'https://www.zhipin.com/wapi/zpchat/geek/getBossData',
            method: 'POST',
            data,
            headers: { Zp_token: token },
        });
        if (res.data.code !== 0) {
            if (res.data.message !== '非好友关系') {
                throw new StopError('状态错误:' + res.data.message);
            }

            return getBossData(params, '非好友关系', retries - 1);
        }

        return res.data.zpData;
    } catch (e) {
        if (e instanceof StopError) {
            throw e;
        }

        return getBossData(params, retries - 1);
    }
}

export { requestCard, addBossToFriendList, customGreeting };

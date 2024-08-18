const axios = require('axios');

function xhrAdapter({
    url = '',
    method = 'GET',
    headers = {},
    data = {},
    onprogress = () => {},
    timeout = 1000,
    ontimeout = () => {},
} = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new window.XMLHttpRequest();
        Object.keys(headers).forEach(key => {
            xhr.setRequestHeader(key, headers[key]);
        });
        xhr.upload.onprogress = onprogress;
        xhr.timeout = timeout;
        xhr.ontimeout = ontimeout;

        let sendData = null;
        let dataKeys = Object.keys(data);
        if (method === 'GET') {
            if (dataKeys?.length) {
                url = `${url}?${dataKeys
                    .map(key => {
                        return `${key}=${data[key]}`;
                    })
                    .join('&')}`;
            }
        } else {
            sendData = new FormData();
            dataKeys.forEach(key => {
                sendData.append(key, data[key]);
            });
        }

        xhr.open(method, url);
        xhr.send(sendData);

        xhr.onload = () => {
            if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304) {
                return resolve(JSON.parse(xhr?.response || '{}'));
            } else {
                return reject(res);
            }
        };
        xhr.onerror = () => {
            reject(new Error('Network Error'));
        };
    });
}

const axiosIns = axios.create({
    adapter: xhrAdapter,
});

module.exports = axiosIns;

// const api = require('./api');
// const error = require('./error');
// const utils = require('./utils');

// module.exports = {
//     ...api,
//     ...error,
//     ...utils,
// };

import { addBossToFriendList, customGreeting } from './api';
import { StopError } from './error';
import { sleep, parseCookies } from './utils';

window.addBossToFriendList = addBossToFriendList;
window.customGreeting = customGreeting;
window.StopError = StopError;
window.sleep = sleep;
window.parseCookies = parseCookies;

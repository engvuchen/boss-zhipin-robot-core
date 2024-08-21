import { requestCard, addBossToFriendList, customGreeting } from './api';
import { StopError } from './error';
import { sleep, parseCookies, checkJobDetail } from './utils';

window.requestCard = requestCard;
window.addBossToFriendList = addBossToFriendList;
window.customGreeting = customGreeting;
window.StopError = StopError;
window.sleep = sleep;
window.parseCookies = parseCookies;
window.checkJobDetail = checkJobDetail;

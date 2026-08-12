const path = 'C:/Users/26335/Documents/GitHub/triangle-score-plugin/triangle-score-plugin.js';
const calls = [];
const replies = [];
const exts = {};
function makeExt(k, a, v) {
  const e = { name: k, version: v, configs: {}, storage: {}, cmdMap: {} };
  e.storageSet = function (key, val) { this.storage[key] = String(val); };
  e.storageGet = function (key) { return this.storage[key] !== undefined ? this.storage[key] : null; };
  return e;
}
global.seal = {
  ext: {
    find: (k) => exts[k] || null,
    new: (k, a, v) => makeExt(k, a, v),
    register: (e) => { exts[e.name] = e; },
    registerStringConfig: (e, k, d) => { e.configs[k] = { type: 'str', def: d, val: d }; },
    registerTemplateConfig: (e, k, d) => { e.configs[k] = { type: 'tpl', def: d, val: d }; },
    getStringConfig: (e, k) => { const c = e.configs[k]; return c ? (c.val !== undefined ? c.val : c.def) : ''; },
    getTemplateConfig: (e, k) => { const c = e.configs[k]; return c ? (c.val !== undefined ? c.val : c.def) : []; },
    newCmdItemInfo: () => ({}),
    newCmdExecuteResult: (ok) => ({ ok }),
    unregisterConfig: () => {}
  },
  replyToSender: (ctx, msg, text) => { replies.push(text); },
  // 第一个端点（Telegram）故意抛错：验证 sendToGroup 会遍历端点而不是只试 eps[0]
  replyGroup: (ctx, msg, text) => {
    if (ctx && ctx.endPoint && ctx.endPoint.platform === 'Telegram') throw new Error('mock: telegram send failed');
    replies.push(text);
  },
  newMessage: () => ({ sender: {} }),
  createTempCtx: (ep, m) => ({ player: { name: 'bot' }, endPoint: ep }),
  getEndPoints: () => [
    { userId: 'TG:1', platform: 'Telegram' },
    { userId: 'QQ:123', platform: 'QQ' }
  ],
  format: (ctx, t) => t,
  getCtxProxyFirst: (ctx) => ctx
};

// 比赛网站赛程 mock：两场待开始对局（id=1/2），双方 QQ 1001/1002、1003/1004
const SCHEDULE = {
  competition: { id: 1, name: '萌新杯测试赛', status: 'ongoing', tournament_format: 'swiss' },
  matches: [
    {
      id: 1,
      round_id: 1,
      status: 'pending',
      result_type: null,
      participant_a: { type: 'individual', name: '阿晴', qqs: ['1001'] },
      participant_b: { type: 'individual', name: '小澜', qqs: ['1002'] }
    },
    {
      id: 2,
      round_id: 1,
      status: 'pending',
      result_type: null,
      participant_a: { type: 'individual', name: '阿星', qqs: ['1003'] },
      participant_b: { type: 'individual', name: '柚子', qqs: ['1004'] }
    }
  ]
};

global.fetch = function (url, opts) {
  calls.push({ url: String(url), opts: opts || {} });
  const u = String(url);
  const bodyObj = opts && opts.body ? JSON.parse(opts.body) : null;
  if (u.includes('/api/init')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, tokens: { match: 'M', defender: 'D', attacker: 'A' }, state: {} }) });
  if (u.includes('/api/end')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  if (u.includes('/api/tick')) {
    if (global.__TICK_FAIL__) return Promise.reject(new Error('mock: controller unreachable'));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(global.__TICK_RECOVER__ ? { elapsed: 25, time_limit: 25, game_over: false } : { elapsed: 25, time_limit: 25, game_over: true }) });
  }
  if (u.includes('/api/state')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ started: true, game_over: true, winner: 'defender', win_type: 'timeout', elapsed: 5, time_limit: 25 }) });
  if (u.includes('/api/v1/results')) {
    if (global.__RESULTS_FAIL__) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'mock 上传失败' }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, code: 'RESULT_PROCESSED', outcome: 'occupied', data: { scores: { defender: 1, attacker: 2 }, event: 'occupy' } }) });
  }
  if (u.includes('/api/schedule/current') || u.includes('/api/competitions/1/schedule')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SCHEDULE) });
  }
  if (u.includes('/mcp')) {
    if (bodyObj && bodyObj.method === 'initialize') {
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'SID1' }, text: () => Promise.resolve('{}') });
    }
    if (bodyObj && bodyObj.method === 'notifications/initialized') {
      return Promise.resolve({ ok: true, status: 202, headers: { get: () => null }, text: () => Promise.resolve('') });
    }
    const shotB64 = global.__MCP_FAIL__ ? '网页截图失败: mock error' : 'QUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJD';
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"' + shotB64 + '"}]}}\n\n')
    });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
};
globalThis.imageRecognizerCy2API = { version: '1.2.4', recognize: () => Promise.resolve({ ok: true, data: { song: '99 Glooms', difficulty: 'CHAOS', difficultyLevel: '14', score: 900000, tp: 90, miss: 0, bad: 0, good: 3, rating: 'S' } }) };
const netMessages = [];
let msgIdCounter = 555;
globalThis.net = {
  callApi: (ep, action, params) => {
    if (action === 'send_group_msg') {
      netMessages.push(params.message);
      return Promise.resolve({ data: { message_id: msgIdCounter++ } });
    }
    if (action === 'get_msg') return Promise.resolve({ message: [{ type: 'image', data: { url: 'http://img/a.png' } }] });
    return Promise.resolve({});
  }
};

// 暴露插件内部函数供测试（插件在 __TS_TEST__ === true 时挂到 globalThis）
globalThis.__TS_TEST__ = true;
require(path);
const ext = exts['triangle_score_plugin'];
const internals = globalThis.__TS_TEST__;
// 配置：网站 + 控制器 + 截图后端
ext.configs.siteUrl.val = 'http://site:8000';
ext.configs.controllerUrl.val = 'http://ctrl:8001';
ext.configs.screenshotUrl.val = 'http://shot:46799';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, cond, detail) { results.push(cond); console.log((cond ? 'PASS' : 'FAIL'), name, detail || ''); }
function ctx(priv) { return { player: { name: 'x' }, endPoint: { userId: 'QQ:123' }, privilegeLevel: priv, isPrivate: false }; }
function msg(text, uid, nick) { return { sender: { userId: uid || 'QQ:1001', nickname: nick || '阿晴' }, message: text, messageType: 'group', groupId: 'QQ-Group:1051905353' }; }
function msgG(text, gid, uid, nick) { return { sender: { userId: uid || 'QQ:1001', nickname: nick || '阿晴' }, message: text, messageType: 'group', groupId: gid }; }
function args() { const a = Array.prototype.slice.call(arguments); return { getArgN: (n) => a[n - 1] }; }
const pendingOf = (k) => { const p = JSON.parse(ext.storageGet('ts_pending') || '{}'); return k ? p[k] : p; };

(async function main() {
  try {
    // ============ 0. 工具函数：QQ 号解析容错 ============
    check('qq parse QQ:xxx', internals.qqNumberFromUserId('QQ:3837233349') === '3837233349', internals.qqNumberFromUserId('QQ:3837233349'));
    check('qq parse bare number', internals.qqNumberFromUserId('3837233349') === '3837233349', internals.qqNumberFromUserId('3837233349'));
    check('qq parse QQ-Group', internals.qqNumberFromUserId('QQ-Group:1051905353:3837233349') === '3837233349', internals.qqNumberFromUserId('QQ-Group:1051905353:3837233349'));
    check('qq parse QQ-Guild', internals.qqNumberFromUserId('QQ-Guild:123:456') === '456', internals.qqNumberFromUserId('QQ-Guild:123:456'));
    check('qq parse empty', internals.qqNumberFromUserId('') === '', internals.qqNumberFromUserId(''));

    // ============ 1. 权限：非管理不能 start ============
    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(0), msg('.ts start'), args('start'));
    check('non-admin start denied', replies[0] === '仅群管理以上可开始比赛', replies[0]);

    // ============ 2. 管理 .ts start：拉赛程 → 候选列表 ============
    replies.length = 0; calls.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start'), args('start'));
    await sleep(150);
    check('start pulls schedule', !!calls.find(c => c.url.includes('/api/schedule/current')), calls.map(c => c.url).join(','));
    check('candidate list shown', !!replies.find(r => r.includes('对局ID 1') && r.includes('阿晴') && r.includes('小澜') && r.includes('QQ:1001')), replies.join(' | '));
    check('no select state stored (arg-based flow)', !ext.storageGet('ts_select'), '');

    // ============ 3. 纯数字消息不再触发选择（选择已改为 .ts start <ID>） ============
    replies.length = 0; calls.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('1'));
    await sleep(50);
    check('plain digit does nothing', replies.length === 0 && !calls.find(c => c.url.includes('/api/init')), replies.join(' | '));

    // ============ 4. 管理 .ts start 1：直接开局 ============
    ext.storageSet('ts_match_state', '');
    ext.storageSet('ts_match_token', '');
    ext.storageSet('ts_defender_token', '');
    ext.storageSet('ts_attacker_token', '');
    replies.length = 0; calls.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start 1'), args('start', '1'));
    await sleep(300);
    check('start announcement with @', !!replies.find(r => r.includes('[CQ:at,qq=1001]') && r.includes('[CQ:at,qq=1002]') && r.includes('正在开局…') && r.includes('对局ID 1')), replies.join(' | '));
    check('init called directly', !!calls.find(c => c.url.includes('/api/init')), '');
    check('match tokens stored', ext.storageGet('ts_match_token') === 'M' && ext.storageGet('ts_defender_token') === 'D' && ext.storageGet('ts_attacker_token') === 'A', '');
    const st = JSON.parse(ext.storageGet('ts_match_state'));
    check('match state stored (identity)', !!st && st.matchId === 1 && !st.bracketUrl && !!st.players['1001'], JSON.stringify(st));
    check('started reply + board shot', !!replies.find(r => r.includes('比赛已开始')) && !!replies.find(r => r.startsWith('[CQ:image,file=base64://')), '');
    check('no countdown storage', !ext.storageGet('ts_countdown'), '');

    // ============ 4b. 无效 ID：不开局，列出候选 ============
    ext.storageSet('ts_match_state', '');
    replies.length = 0; calls.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start 999'), args('start', '999'));
    await sleep(150);
    check('invalid id rejected with candidates', !!replies.find(r => r.includes('没有找到对局 ID=999') && r.includes('对局ID 1')), replies.join(' | '));
    check('invalid id does not start', !ext.storageGet('ts_match_state') && !calls.find(c => c.url.includes('/api/init')), '');
    ext.storageSet('ts_match_state', JSON.stringify(st)); // 恢复第 4 节的对局状态供后续测试

    // ============ 5. 跨群互斥：其他群已有对局 → 本群 start 被拒 ============
    replies.length = 0;
    ext.storageSet('ts_match_state', JSON.stringify({ group: 'QQ-Group:888', matchId: 9, roundId: 1 }));
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start'), args('start'));
    check('cross-group match blocks start', !!replies.find(r => r.includes('另一个群已有对局进行中')), replies.join(' | '));
    ext.storageSet('ts_match_state', JSON.stringify(st)); // 恢复本群对局

    // ============ 7. status：当前对局 ============
    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts status'), args('status'));
    check('status shows current match', replies[0].includes('当前对局') && replies[0].includes('第 1 轮'), replies[0].split('\n')[0]);

    // ============ 8. 非本局选手上传被拒 ============
    replies.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=1]上传成绩', 'QQ:9999', '路人'));
    await sleep(150);
    check('non-player upload denied', !!replies.find(r => r.includes('未匹配到本局选手身份')), replies.join(' | '));

    // ============ 9. 裸 QQ 号上传 → 待确认 → 修改无有效字段被拒 → 修改 → 确认 ============
    replies.length = 0; calls.length = 0; netMessages.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=2]上传成绩', '1001', '阿晴'));
    await sleep(150);
    const pkey = Object.keys(pendingOf())[0];
    check('confirmation keyed by message_id 555', pkey === '555', pkey);
    check('confirmation text sent', !!netMessages.find(t => t.includes('成绩待确认') && t.includes('修改')), netMessages[0] ? netMessages[0].slice(0, 40) : 'none');
    check('no direct upload yet', !calls.find(c => c.url.includes('/api/v1/results')), '');

    replies.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=555]确认'));
    check('non-admin review denied', replies[0] === '仅群管理以上可审核成绩', replies[0]);
    check('pending still there', !!pendingOf('555'), '');

    replies.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=555]修改 你好'));
    await sleep(150);
    check('modify with no valid fields rejected', !!replies.find(r => r.includes('未识别到有效修改字段')), replies.join(' | '));
    check('pending kept after invalid modify', !!pendingOf('555'), '');

    replies.length = 0; calls.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=555]修改 score 991420 tp 95.5 miss 0 bad 0 good 1'));
    await sleep(150);
    const up = calls.find(c => c.url.includes('/api/v1/results'));
    const res = up ? JSON.parse(up.opts.body).result : null;
    check('modified payload submitted', !!up && res.score === 991420 && res.tp === 95.5 && res.good === 1, res ? JSON.stringify(res) : 'none');
    check('pending cleared after review', !pendingOf('555'), '');
    check('result + screenshot sent', !!replies.find(r => r.includes('成绩上报完成')) && !!replies.find(r => r.startsWith('[CQ:image,file=base64://')), '');

    // ============ 10. 第二条上传 + 拒绝 ============
    replies.length = 0; calls.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=3]上传成绩'));
    await sleep(150);
    const k2 = Object.keys(pendingOf()).find(k => k !== '555');
    check('second pending created with new message_id 556', k2 === '556', k2 || Object.keys(pendingOf()).join(','));
    replies.length = 0;
    ext.onNotCommandReceived(ctx(50), msg('[CQ:reply,id=' + k2 + ']拒绝'));
    check('reject clears pending', !pendingOf(k2), '');
    check('no upload on reject', !calls.find(c => c.url.includes('/api/v1/results')), '');

    // ============ 11. 上传失败：待审成绩保留，可重试 ============
    replies.length = 0; calls.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=4]上传成绩'));
    await sleep(150);
    check('third pending keyed 557', !!pendingOf('557'), '');
    global.__RESULTS_FAIL__ = true;
    replies.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=557]确认'));
    await sleep(150);
    check('upload rejected reply', !!replies.find(r => r.includes('成绩上传被拒绝')), replies.join(' | '));
    check('pending retained after fail', !!pendingOf('557'), '');
    global.__RESULTS_FAIL__ = false;
    replies.length = 0; calls.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=557]确认'));
    await sleep(150);
    check('retry confirm succeeds', !!calls.find(c => c.url.includes('/api/v1/results')), '');
    check('pending cleared after success', !pendingOf('557'), '');

    // ============ 11.5. 热重载模拟：状态保留、循环不重复、onLoad 打恢复日志 ============
    const loopFlagBefore = globalThis.__tsLoopStarted;
    delete require.cache[require.resolve(path)];
    require(path);
    const ext2 = exts['triangle_score_plugin'];
    check('reload reuses same ext (storage kept)', ext2 === ext, '');
    const stAfterReload = JSON.parse(ext.storageGet('ts_match_state') || 'null');
    check('reload keeps match state', !!stAfterReload && stAfterReload.matchId === 1 && stAfterReload.group === 'QQ-Group:1051905353', JSON.stringify(stAfterReload));
    check('reload keeps tokens', ext.storageGet('ts_match_token') === 'M' && ext.storageGet('ts_attacker_token') === 'A', '');
    check('reload does not duplicate loop', globalThis.__tsLoopStarted === loopFlagBefore, String(loopFlagBefore));
    // 重新执行脚本会把 mock 配置重置为默认值，恢复测试用配置
    ext2.configs.siteUrl.val = 'http://site:8000';
    ext2.configs.controllerUrl.val = 'http://ctrl:8001';
    ext2.configs.screenshotUrl.val = 'http://shot:46799';
    let loadLog = '';
    const origLog = console.log;
    console.log = function (t) { loadLog += String(t); };
    ext2.onLoad();
    console.log = origLog;
    check('onLoad logs resume info', loadLog.includes('检测到进行中对局') && loadLog.includes('轮询窗口'), loadLog);

    // ============ 12. stop：权限 + /api/end + 清秘钥 + 展示接下来的比赛 ============
    replies.length = 0; calls.length = 0;
    ext.cmdMap['ts'].solve(ctx(0), msg('.ts stop'), args('stop'));
    check('non-admin stop denied', replies[0] === '仅群管理以上可结束比赛', replies[0]);
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts stop'), args('stop'));
    await sleep(150);
    check('admin stop calls /api/end', !!calls.find(c => c.url.includes('/api/end')), '');
    check('stop reply', !!replies.find(r => r.includes('比赛已结束')), replies.join(' | '));
    check('stop clears match state', !ext.storageGet('ts_match_state'), '');
    check('stop clears tokens', !ext.storageGet('ts_match_token') && !ext.storageGet('ts_defender_token') && !ext.storageGet('ts_attacker_token'), '');
    const noBracketShot = !calls.find(c => c.url.includes('/mcp') && c.opts.body && JSON.parse(c.opts.body).params && JSON.parse(c.opts.body).params.arguments && String(JSON.parse(c.opts.body).params.arguments.url).includes('/competitions/1/bracket'));
    check('stop sends no bracket screenshot', noBracketShot, calls.filter(c => c.url.includes('/mcp')).map(c => { try { return JSON.parse(c.opts.body).params.arguments.url; } catch (e) { return ''; } }).join(','));
    check('stop shows upcoming matches text', !!replies.find(r => r.includes('【接下来的比赛】') && r.includes('局2') && r.includes('阿星') && r.includes('柚子')), replies.join(' | '));

    // ============ 12.5. 自动轮询结束：纯文本结果 + 展示接下来的比赛 ============
    replies.length = 0; calls.length = 0;
    ext.storageSet('ts_match_state', JSON.stringify({
      group: 'QQ-Group:1051905353',
      competitionId: 1,
      matchId: 1,
      roundId: 1,
      startedAt: Date.now() - 25 * 60 * 1000,
      lastPollAt: 0,
      timeLimit: 25,
      attacker: { name: '阿晴', qqs: ['1001'] },
      defender: { name: '小澜', qqs: ['1002'] },
      players: {}
    }));
    await sleep(2000);
    check('auto end polls /api/tick', !!calls.find(c => c.url.includes('/api/tick')), calls.map(c => c.url).join(','));
    check('auto end sends result text', !!replies.find(r => r.includes('比赛已结束') && r.includes('守护者获胜')), replies.join(' | '));
    check('auto end shows upcoming matches text', !!replies.find(r => r.includes('【接下来的比赛】') && r.includes('局2') && r.includes('阿星')), replies.join(' | '));
    check('auto end clears match state', !ext.storageGet('ts_match_state'), '');

    // ============ 13. status：无对局 + 待审按群计数 ============
    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts status'), args('status'));
    check('status shows no match', replies[0].includes('无进行中对局'), replies[0].split('\n')[0]);
    ext.storageSet('ts_pending', JSON.stringify({
      aaa: { group: 'QQ-Group:999', ts: Date.now(), code: 'A' },
      bbb: { group: 'QQ-Group:1051905353', ts: Date.now(), code: 'B' }
    }));
    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts status'), args('status'));
    check('status pending count per group', replies[0].includes('待审核成绩：1 条'), replies[0].split('\n').find(l => l.includes('待审核成绩')));

    // ============ 14. .ts shot MCP + 失败兜底 ============
    replies.length = 0; calls.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts shot'), args('shot'));
    await sleep(150);
    const mcpCall = calls.find(c => c.url.includes('/mcp') && c.opts.body && JSON.parse(c.opts.body).method === 'tools/call');
    check('MCP screenshot_url called', !!mcpCall, '');
    check('no REST /screenshot call', !calls.find(c => c.url.includes('/screenshot')), '');
    check('MCP screenshot image reply', !!replies.find(r => r.startsWith('[CQ:image,file=base64://')), '');

  global.__MCP_FAIL__ = true;
  replies.length = 0; calls.length = 0;
  ext.cmdMap['ts'].solve(ctx(60), msg('.ts shot'), args('shot'));
  await sleep(150);
  check('both fail -> fallback text', !!replies.find(r => r.includes('网页截图失败')), replies.join(' | '));
  global.__MCP_FAIL__ = false;
  globalThis.__TS_TEST_SUSPEND__ = true; // 暂停常驻循环，避免后台 tick 干扰后续状态类用例

  // ============ 15. 开局前拦截：双方均未填 QQ 不得开局 ============
  const backupSchedule = JSON.parse(JSON.stringify(SCHEDULE));
  SCHEDULE.matches[0].participant_a.qqs = [];
  SCHEDULE.matches[0].participant_b.qqs = [];
  ext.storageSet('ts_match_state', '');
  ext.storageSet('ts_match_token', '');
  replies.length = 0; calls.length = 0;
  ext.cmdMap['ts'].solve(ctx(60), msg('.ts start 1'), args('start', '1'));
  await sleep(150);
  check('start blocked when both sides lack QQ', !!replies.find(r => r.includes('开局失败：双方选手均未在网站个人资料中填写 QQ')), replies.join(' | '));
  check('blocked start does not init', !calls.find(c => c.url.includes('/api/init')), '');
  // 仅一侧缺 QQ：警告但允许继续
  SCHEDULE.matches[0].participant_b.qqs = ['1002'];
  replies.length = 0; calls.length = 0;
  ext.cmdMap['ts'].solve(ctx(60), msg('.ts start 1'), args('start', '1'));
  await sleep(150);
  check('one-side missing QQ warns but continues', !!replies.find(r => r.includes('开局警告：掠夺者「阿晴」 未填写 QQ')), replies.join(' | '));
  check('warn path still calls init', !!calls.find(c => c.url.includes('/api/init')), '');
  SCHEDULE.matches = JSON.parse(JSON.stringify(backupSchedule.matches));
  ext.storageSet('ts_match_state', ''); // 清掉警告路径开的局
  ext.storageSet('ts_match_token', '');
  ext.storageSet('ts_defender_token', '');
  ext.storageSet('ts_attacker_token', '');

  // ============ 16. 同群不同选手各自待审 + 同选手重复上传被拒 + 跨群审核被拒 ============
  const st16 = {
    group: 'QQ-Group:1051905353', competitionId: 1, competitionName: '萌新杯测试赛',
    matchId: 1, roundId: 1, startedAt: Date.now(), lastPollAt: 0, timeLimit: 25,
    attacker: { name: '阿晴', qqs: ['1001'] }, defender: { name: '小澜', qqs: ['1002'] },
    players: {
      '1001': { id: '1001', name: '阿晴', team: 'attacker' },
      '1002': { id: '1002', name: '小澜', team: 'defender' }
    }
  };
  ext.storageSet('ts_match_state', JSON.stringify(st16));
  ext.storageSet('ts_match_token', 'M');
  ext.storageSet('ts_defender_token', 'D');
  ext.storageSet('ts_attacker_token', 'A');
  ext.storageSet('ts_pending', '{}');
  netMessages.length = 0; replies.length = 0;
  ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=10]上传成绩', '1001', '阿晴'));
  await sleep(150);
  ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=11]上传成绩', '1002', '小澜'));
  await sleep(150);
  const pendKeys = Object.keys(pendingOf());
  check('two players can pend simultaneously', pendKeys.length === 2, pendKeys.join(','));
  replies.length = 0;
  ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=12]上传成绩', '1001', '阿晴'));
  await sleep(150);
  check('same player duplicate upload blocked', !!replies.find(r => r.includes('你已有一条成绩待确认')), replies.join(' | '));
  // 跨群审核：B 群引用 A 群的确认消息 → 拒绝且 pending 保留
  replies.length = 0;
  ext.onNotCommandReceived(ctx(60), msgG('[CQ:reply,id=' + pendKeys[0] + ']确认', 'QQ-Group:888', 'QQ:9999', '路人'));
  await sleep(150);
  check('cross-group review denied', !!replies.find(r => r.includes('该待审成绩属于其他群，不能在本群审核')), replies.join(' | '));
  check('cross-group review keeps pending', pendingOf(pendKeys[0]) !== undefined, '');
  // 本群正常审核可继续
  replies.length = 0;
  ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=' + pendKeys[0] + ']确认'));
  await sleep(150);
  check('own-group review still works', !pendingOf(pendKeys[0]) && !!replies.find(r => r.includes('成绩上报完成')), replies.join(' | '));

  // ============ 17. 轮询失败告警：连续失败 3 次发提示，恢复后计数清零 ============
  ext.storageSet('ts_match_state', JSON.stringify(Object.assign({}, st16, { startedAt: Date.now() - 25 * 60 * 1000, lastPollAt: 0 })));
  ext.storageSet('ts_poll_fail', '');
  replies.length = 0; calls.length = 0;
  global.__TICK_FAIL__ = true;
  const forcePoll = function () {
    const m = JSON.parse(ext.storageGet('ts_match_state'));
    m.lastPollAt = 0;
    ext.storageSet('ts_match_state', JSON.stringify(m));
    internals.tickPoll();
  };
  forcePoll(); forcePoll(); forcePoll();
  await sleep(200); // 等异步 catch 完成
  check('poll fail count reaches threshold and alerts', !!replies.find(r => r.includes('控制器状态轮询已连续失败 3 次')), replies.join(' | '));
  const pf = JSON.parse(ext.storageGet('ts_poll_fail') || '{}');
  check('poll fail state persisted', pf.count === 3 && pf.alerted === true, JSON.stringify(pf));
  global.__TICK_FAIL__ = false;
  global.__TICK_RECOVER__ = true; // 恢复轮询返回未结束，避免自动结束清掉状态
  replies.length = 0;
  forcePoll();
  await sleep(200); // 等恢复轮询的 then 链执行完
  check('poll success clears fail state', !ext.storageGet('ts_poll_fail'), ext.storageGet('ts_poll_fail') || '');
  check('recovery does not re-alert', !replies.find(r => r.includes('控制器状态轮询已连续失败')), replies.join(' | '));

  // ============ 18. stop 跨群：其他群调用 stop 不清本群 token，status 提示对局在别群 ============
  ext.storageSet('ts_match_state', JSON.stringify(Object.assign({}, st16, { startedAt: Date.now() })));
  ext.storageSet('ts_match_token', 'M');
  ext.storageSet('ts_defender_token', 'D');
  ext.storageSet('ts_attacker_token', 'A');
  replies.length = 0;
  ext.cmdMap['ts'].solve(ctx(60), msgG('.ts stop', 'QQ-Group:888', 'QQ:9999', '路人'), args('stop'));
  await sleep(150);
  check('other-group stop keeps tokens', ext.storageGet('ts_match_token') === 'M', '');
  check('other-group stop keeps match state', !!ext.storageGet('ts_match_state'), '');
  replies.length = 0;
  ext.cmdMap['ts'].solve(ctx(60), msgG('.ts status', 'QQ-Group:888', 'QQ:9999', '路人'), args('status'));
  check('status shows match in other group', replies[0].includes('另一个群正在进行第 1 轮'), replies[0].split('\n')[0]);
  ext.storageSet('ts_match_state', '');
  ext.storageSet('ts_match_token', '');
  ext.storageSet('ts_defender_token', '');
  ext.storageSet('ts_attacker_token', '');
  global.__TICK_RECOVER__ = false;
  globalThis.__TS_TEST_SUSPEND__ = false;
  } finally {
    const passed = results.filter(Boolean).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
  }
})();

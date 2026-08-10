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

// 比赛网站赛程 mock：一场待开始对局（id=1），双方 QQ 1001/1002
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
    }
  ]
};

global.fetch = function (url, opts) {
  calls.push({ url: String(url), opts: opts || {} });
  const u = String(url);
  const bodyObj = opts && opts.body ? JSON.parse(opts.body) : null;
  if (u.includes('/api/init')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, tokens: { match: 'M', defender: 'D', attacker: 'A' }, state: {} }) });
  if (u.includes('/api/end')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
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
globalThis.imageRecognizerAPI = { version: '1.0.0', recognize: () => Promise.resolve({ ok: true, data: { song: '99 Glooms', difficulty: 'CHAOS', difficultyLevel: '14', score: 900000, tp: 90, miss: 0, bad: 0, good: 3, rating: 'S' } }) };
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
    check('selection stored', !!JSON.parse(ext.storageGet('ts_select')), '');

    // ============ 3. 非管理回复数字：不生效 ============
    ext.storageSet('ts_countdown', '');
    replies.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('1'));
    check('non-admin digit ignored', ext.storageGet('ts_countdown') === '', replies.join(' | '));

    // ============ 4. 管理回复对局 ID：开始倒计时 ============
    replies.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('1'));
    await sleep(150);
    const cd = JSON.parse(ext.storageGet('ts_countdown'));
    check('countdown task stored', !!cd && cd.matchId === 1 && cd.group === 'QQ-Group:1051905353', JSON.stringify(cd));
    check('countdown reply with @ + 2min', !!replies.find(r => r.includes('[CQ:at,qq=1001]') && r.includes('[CQ:at,qq=1002]') && r.includes('2 分钟后开局')), replies.join(' | '));
    check('selection cleared after pick', !ext.storageGet('ts_select'), '');

    // ============ 5. 跨群互斥：其他群已有倒计时 → 本群 start 被拒 ============
    replies.length = 0;
    ext.storageSet('ts_countdown', JSON.stringify({ group: 'QQ-Group:888', endAt: Date.now() + 600000, roundId: 1 }));
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start'), args('start'));
    check('cross-group countdown blocks start', !!replies.find(r => r.includes('另一个群已有倒计时')), replies.join(' | '));
    ext.storageSet('ts_countdown', JSON.stringify(cd)); // 恢复本群倒计时

    // ============ 6. 快进倒计时：3/2/1 → 开局 → 棋盘截图 ============
    cd.endAt = Date.now() + 3500;
    ext.storageSet('ts_countdown', JSON.stringify(cd));
    await sleep(6500);
    check('countdown 3,2,1 sent via endpoint iteration', !!replies.find(r => r === '3') && !!replies.find(r => r === '2') && !!replies.find(r => r === '1'), replies.filter(r => ['3', '2', '1'].includes(r)).join(','));
    check('init called after countdown', !!calls.find(c => c.url.includes('/api/init')), '');
    check('match tokens stored', ext.storageGet('ts_match_token') === 'M', '');
    const st = JSON.parse(ext.storageGet('ts_match_state'));
    check('match state stored (identity+url)', !!st && st.matchId === 1 && st.bracketUrl === 'http://site:8000/competitions/1/bracket' && !!st.players['1001'], JSON.stringify(st));
    check('started reply + board shot', !!replies.find(r => r.includes('比赛已开始')) && !!replies.find(r => r.startsWith('[CQ:image,file=base64://')), '');
    check('countdown cleared after start', !ext.storageGet('ts_countdown'), '');

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

    // ============ 12. stop：权限 + /api/end + 清秘钥 + 赛程图 ============
    replies.length = 0; calls.length = 0;
    ext.cmdMap['ts'].solve(ctx(0), msg('.ts stop'), args('stop'));
    check('non-admin stop denied', replies[0] === '仅群管理以上可结束比赛', replies[0]);
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts stop'), args('stop'));
    await sleep(150);
    check('admin stop calls /api/end', !!calls.find(c => c.url.includes('/api/end')), '');
    check('stop reply', !!replies.find(r => r.includes('比赛已结束')), replies.join(' | '));
    check('stop clears match state', !ext.storageGet('ts_match_state'), '');
    check('stop clears tokens', !ext.storageGet('ts_match_token') && !ext.storageGet('ts_defender_token') && !ext.storageGet('ts_attacker_token'), '');
    const bracketShot = calls.find(c => c.url.includes('/mcp') && c.opts.body && JSON.parse(c.opts.body).params && JSON.parse(c.opts.body).params.arguments && String(JSON.parse(c.opts.body).params.arguments.url).includes('/competitions/1/bracket'));
    check('stop sends bracket screenshot', !!bracketShot, calls.filter(c => c.url.includes('/mcp')).map(c => { try { return JSON.parse(c.opts.body).params.arguments.url; } catch (e) { return ''; } }).join(','));

    // ============ 13. status：无对局 + 待审按群计数 ============
    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts status'), args('status'));
    check('status shows no match', replies[0].includes('无倒计时/对局'), replies[0].split('\n')[0]);
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
  } finally {
    const passed = results.filter(Boolean).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
  }
})();

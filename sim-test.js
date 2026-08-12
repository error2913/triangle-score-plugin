// 本地端到端模拟测试：插件逻辑（Node 环境 + 模拟 seal/ext/识图/MCP）对接
// 【真实】demo 控制器后端（HTTP + WebSocket 全走 127.0.0.1）。
//
// 用法：
//   1. 先启动控制器（headless）：python demo/app/main/main.py --headless
//   2. 设置 TS_SIM_PORT（默认 8001），然后：node sim-test.js
//
// 覆盖链路：onLoad 即连 /ws → .ts start 拉赛程 → .ts start <ID> 真实 /api/init
// → 引用截图上传成绩（真实 /api/v1/results）→ 短时限触发真实超时 → WS 推送
// game_over → 插件自动结束 + 纯文本展示接下来的比赛。
const path = 'C:/Users/26335/Documents/GitHub/triangle-score-plugin/triangle-score-plugin.js';
const PORT = process.env.TS_SIM_PORT || '8001';
const BASE = 'http://127.0.0.1:' + PORT;
const realFetch = global.fetch;
const httpLog = [];
const replies = [];
const netMessages = [];
let msgIdCounter = 555;

// ---- seal/ext mock（与 mock-test.js 一致；HTTP/WS 走真实控制器） ----
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
  replyGroup: (ctx, msg, text) => { replies.push(text); },
  newMessage: () => ({ sender: {} }),
  createTempCtx: (ep, m) => ({ player: { name: 'bot' }, endPoint: ep }),
  getEndPoints: () => [{ userId: 'QQ:123', platform: 'QQ' }],
  format: (ctx, t) => t,
  getCtxProxyFirst: (ctx) => ctx
};

// 赛程 stub（网站侧不在本次模拟范围）
const SCHEDULE = {
  competition: { id: 1, name: '萌新杯测试赛', status: 'ongoing', tournament_format: 'swiss' },
  matches: [
    { id: 1, round_id: 1, status: 'pending', result_type: null,
      participant_a: { type: 'individual', name: '阿晴', qqs: ['1001'] },
      participant_b: { type: 'individual', name: '小澜', qqs: ['1002'] } },
    { id: 2, round_id: 1, status: 'pending', result_type: null,
      participant_a: { type: 'individual', name: '阿星', qqs: ['1003'] },
      participant_b: { type: 'individual', name: '柚子', qqs: ['1004'] } }
  ]
};

// fetch 路由：MCP 与赛程为 stub，其余（控制器）真走本地后端
global.fetch = function (url, opts) {
  const u = String(url);
  const bodyObj = opts && opts.body ? JSON.parse(opts.body) : null;
  if (u.includes('/mcp')) {
    if (bodyObj && bodyObj.method === 'initialize') {
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'SID1' }, text: () => Promise.resolve('{}') });
    }
    if (bodyObj && bodyObj.method === 'notifications/initialized') {
      return Promise.resolve({ ok: true, status: 202, headers: { get: () => null }, text: () => Promise.resolve('') });
    }
    // 模拟 web-read 返回的真实截图 base64（1x1 PNG 只有 74 字符，
    // 插件要求 base64 长度 >100 才判定为有效截图，所以生成一段更长的载荷）
    const shotB64 = Buffer.from('triangle-score-plugin sim screenshot payload '.repeat(30), 'utf8').toString('base64');
    return Promise.resolve({
      ok: true, status: 200, headers: { get: () => null },
      text: () => Promise.resolve('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"' + shotB64 + '"}]}}\n\n')
    });
  }
  if (u.includes('/api/schedule/current') || u.includes('/api/competitions/1/schedule')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SCHEDULE) });
  }
  return realFetch(url, opts).then(async (res) => {
    if (u.includes('/api/init') || u.includes('/api/v1/results')) {
      try { httpLog.push({ url: u, status: res.status, body: await res.clone().json() }); }
      catch (e) { httpLog.push({ url: u, status: res.status, body: null }); }
    }
    return res;
  });
};

// ob11 模拟：取被引用图片 + 发确认消息拿 message_id
globalThis.net = {
  callApi: (ep, action, params) => {
    if (action === 'send_group_msg') { netMessages.push(params.message); return Promise.resolve({ data: { message_id: msgIdCounter++ } }); }
    if (action === 'get_msg') return Promise.resolve({ message: [{ type: 'image', data: { url: 'http://img/a.png' } }] });
    return Promise.resolve({});
  }
};

// 识图 mock：值满足任意普通格任务（score=99.5w / tp=99.5 / mm / fc / 0 失误）
let recSong = { song: '占位', difficulty: 'Chaos', difficultyLevel: '14' };
globalThis.imageRecognizerCy2API = {
  version: '1.2.4',
  recognize: () => Promise.resolve({
    ok: true,
    data: Object.assign({}, recSong, { score: 995000, tp: 99.5, miss: 0, bad: 0, good: 0, rating: 'MM' })
  })
};

globalThis.__TS_TEST__ = true;
require(path);
const ext = exts['triangle_score_plugin'];
ext.configs.siteUrl.val = 'http://site:8000';
ext.configs.controllerUrl.val = BASE;
ext.configs.screenshotUrl.val = 'http://shot:46799';
ext.onLoad();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, cond, detail) { results.push(cond); console.log((cond ? 'PASS' : 'FAIL'), name, detail || ''); }
function ctx(priv) { return { player: { name: 'x' }, endPoint: { userId: 'QQ:123' }, privilegeLevel: priv, isPrivate: false }; }
function msg(text, uid, nick) { return { sender: { userId: uid || 'QQ:1001', nickname: nick || '阿晴' }, message: text, messageType: 'group', groupId: 'QQ-Group:1051905353' }; }
function args() { const a = Array.prototype.slice.call(arguments); return { getArgN: (n) => a[n - 1] }; }
const pendingOf = () => JSON.parse(ext.storageGet('ts_pending') || '{}');

async function httpJSON(method, pathname, body) {
  const res = await realFetch(BASE + pathname, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

(async function main() {
  try {
    for (let i = 0; i < 20; i++) {
      try { const r = await httpJSON('GET', '/api/state'); if (r.status === 200) break; } catch (e) {}
      await sleep(500);
    }
    await sleep(200);
    const ws = globalThis.__tsWsState && globalThis.__tsWsState.socket;
    check('onLoad 真连控制器 WS', !!ws && ws.readyState === 1, ws ? ws.url : '无连接');
    check('WS 地址正确', !!ws && ws.url === 'ws://127.0.0.1:' + PORT + '/ws', ws ? ws.url : '');

    // 清理控制器残留（上一轮可能留下短时限或未结束对局，测试间互相影响）
    try { await httpJSON('POST', '/api/end'); } catch (e) {}
    let r = await httpJSON('POST', '/api/time_limit', { minutes: 25 });
    check('复位时限（真实）', r.status === 200 && r.body.ok === true, '');

    const songs = { songs: [] };
    for (let i = 1; i <= 24; i++) songs.songs.push({ name: '测试曲目 ' + i, type: 'Chaos', level: '14' });
    songs.songs[0] = { name: '99 Glooms', type: 'Chaos', level: '14' };
    r = await httpJSON('POST', '/api/songs', songs);
    check('导入歌曲库（真实 /api/songs）', r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 60));

    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start'), args('start'));
    await sleep(200);
    check('拉取赛程并列出候选', !!replies.find(x => x.includes('对局ID 1') && x.includes('阿晴') && x.includes('QQ:1001')), replies.join(' | ').slice(0, 120));

    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts start 1'), args('start', '1'));
    await sleep(1000);
    const initLog = httpLog.find(x => x.url.includes('/api/init'));
    const tokens = initLog && initLog.body ? initLog.body.tokens : null;
    check('真实 /api/init 开局成功', !!initLog && initLog.status === 200 && !!tokens && !!tokens.match, initLog ? 'status=' + initLog.status : '无调用');
    check('秘钥与真实响应一致（不展示）',
      ext.storageGet('ts_match_token') === (tokens ? tokens.match : '') &&
      ext.storageGet('ts_defender_token') === (tokens ? tokens.defender : '') &&
      ext.storageGet('ts_attacker_token') === (tokens ? tokens.attacker : ''), '');
    check('开局回复 + 棋盘截图', !!replies.find(x => x.includes('比赛已开始')) && !!replies.find(x => x.startsWith('[CQ:image,file=base64://')), replies.join(' | ').slice(0, 80));

    r = await httpJSON('GET', '/api/state');
    const board = (r.body && r.body.board) || [];
    const pick = board.find(c => c && c.id > 0 && !c.is_energy && c.owner == null && c.song_name);
    check('从真实 board 挑可占领格子', !!pick, pick ? pick.song_name + ' cell#' + pick.id : JSON.stringify(board[0]).slice(0, 120));
    recSong = { song: pick.song_name, difficulty: pick.song_type || 'Chaos', difficultyLevel: pick.song_level || '14' };

    replies.length = 0; netMessages.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=2]上传成绩', '1001', '阿晴'));
    await sleep(300);
    const pkey = Object.keys(pendingOf())[0];
    check('生成待审成绩', !!pkey && !!netMessages.find(t => t.includes('成绩待确认')), pkey ? 'key=' + pkey : 'none');

    replies.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=' + pkey + ']确认'));
    await sleep(1000);
    const up = httpLog.find(x => x.url.includes('/api/v1/results'));
    check('真实 /api/v1/results 上传成功', !!up && up.status === 200 && up.body && up.body.ok === true && up.body.outcome === 'occupied',
      up ? 'status=' + up.status + ' outcome=' + (up.body && up.body.outcome) + ' msg=' + (up.body && up.body.message) : '无调用');
    check('确认后清理待审', !pendingOf()[pkey], '');
    check('上传完成回复', !!replies.find(x => x.includes('成绩上报完成')), replies.join(' | ').slice(0, 60));

    r = await httpJSON('POST', '/api/time_limit', { minutes: 0.02 });
    check('设置 0.02 分钟时限（真实）', r.status === 200 && r.body.ok === true, '');
    replies.length = 0;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(200);
      if (replies.find(x => x.includes('比赛已结束'))) break;
    }
    check('WS 推送 game_over → 插件自动结束', !!replies.find(x => x.includes('比赛已结束')), replies.join(' | ').slice(0, 120));
    check('结束文本含胜负/平局', !!replies.find(x => x.includes('获胜') || x.includes('平局')), replies.join(' | ').slice(0, 80));
    check('结束自动展示接下来的比赛（纯文本）', !!replies.find(x => x.includes('【接下来的比赛】') && x.includes('局2') && x.includes('阿星') && x.includes('柚子')), replies.join(' | ').slice(0, 120));
    check('结束自动清状态与秘钥', !ext.storageGet('ts_match_state') && !ext.storageGet('ts_match_token') && !ext.storageGet('ts_defender_token') && !ext.storageGet('ts_attacker_token'), '');

    replies.length = 0;
    ext.cmdMap['ts'].solve(ctx(60), msg('.ts status'), args('status'));
    check('status 无当前对局且 WS 仍连接', !!replies[0] && !replies[0].includes('当前对局') && replies[0].includes('控制器 WS：已连接'), replies[0] ? replies[0].split('\n').join(' | ') : '');

    replies.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=3]上传成绩', '1001', '阿晴'));
    await sleep(300);
    check('赛后上传被拒（无对局）', !!replies.find(x => x.includes('未匹配到本局选手身份') || x.includes('比赛尚未开局')), replies.join(' | ').slice(0, 60));

    const pass = results.filter(Boolean).length;
    console.log('\n=== 本地模拟 ' + pass + '/' + results.length + ' 通过 ===');
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    console.error('SIM CRASH:', e && e.stack ? e.stack : e);
    process.exit(2);
  }
})();

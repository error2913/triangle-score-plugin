// ==UserScript==
// @name         triangle-score-plugin
// @author       错误
// @version      2.0.0
// @description  对接「三角占领 · 赛时控制器」成绩上传协议：从比赛网站拉赛程 → 管理选对局 → @选手倒计时开局 → 引用结算截图 → image-recognizer 识别 → 人工审核 → 上传成绩 → 截图反馈
// @timestamp    2026-08-10
// @license      MIT
// @homepageURL  https://github.com/error2913/triangle-score-plugin
// @updateUrl    https://raw.githubusercontent.com/error2913/triangle-score-plugin/main/triangle-score-plugin.js
// @depends      错误:image-recognizer:>=1.0.0
// @sealVersion  1.4.5
// ==/UserScript==

// 依赖说明：image-recognizer（cy2 特化版）提供 globalThis.imageRecognizerCy2API.recognize(url)，
// 其内部依赖 ob11 网络连接依赖（globalThis.net 拉图）与 aiplugin4（图片模型识别）。
// 本插件不再重复依赖这两个插件，由 image-recognizer 的 @depends 传递保证。

// ============ 1. 创建 / 复用扩展 ============
let ext = seal.ext.find('triangle_score_plugin');
if (!ext) {
  ext = seal.ext.new('triangle_score_plugin', '错误', '2.0.0');
  seal.ext.register(ext);
}

// ============ 2. 配置项 ============
seal.ext.registerStringConfig(ext, 'controllerUrl', 'http://127.0.0.1:8001', '赛时控制器地址（协议 Base URL）');
seal.ext.registerStringConfig(ext, 'screenshotUrl', 'http://127.0.0.1:46799', '网页截图后端地址（aiplugin4-backends web-read）');
seal.ext.registerStringConfig(ext, 'screenshotToken', '', '网页截图后端访问令牌（aiplugin4-backends 配置了 token 时填写，请求头 X-Token）');
seal.ext.registerStringConfig(ext, 'siteUrl', 'http://127.0.0.1:8000', '比赛网站地址（拉取赛程 / 赛程图页面）');
seal.ext.registerStringConfig(ext, 'competitionId', '', '比赛 ID（留空自动使用当前进行中的比赛）');
seal.ext.registerTemplateConfig(ext, 'triggerText', ['上传成绩'], '触发文本模板：每行一个正则，作用于去掉引用前缀后的消息文本，任一命中即触发');

// 清理旧版配置项（秘钥已改为开局时自动获取并存储；bind 绑定已删除，身份改从赛程匹配；
// timeApiUrl 已移除，不做图片时间校验；renderUrl 已移除，改走网页截图）
try {
  seal.ext.unregisterConfig(ext, 'matchToken', 'defenderToken', 'attackerToken', 'renderUrl', 'timeApiUrl');
} catch (e) {
  // 接口不支持或已清理时忽略
}

// ============ 3. 持久化存储（ext.storage 只收字符串，复杂结构 JSON） ============
const K_MATCH = 'ts_match_token';
const K_DEF = 'ts_defender_token';
const K_ATK = 'ts_attacker_token';
const K_PENDING = 'ts_pending';
const K_COUNTDOWN = 'ts_countdown';       // 倒计时任务（0.5s 循环从存储读取，重载不丢）
const K_SELECT = 'ts_select';             // 等待管理回复对局 ID 的候选列表
const K_MATCH_STATE = 'ts_match_state';   // 当前进行中对局（身份/开局时间/赛程图 URL）

function getStoredToken(key) {
  return ext.storageGet(key) || '';
}

function loadJson(key, fallback) {
  try {
    const raw = ext.storageGet(key);
    if (!raw) return fallback;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJson(key, obj) {
  ext.storageSet(key, JSON.stringify(obj || {}));
}

function loadPending() { return loadJson(K_PENDING, {}); }
function savePending(p) { saveJson(K_PENDING, p); }
function loadCountdown() { return loadJson(K_COUNTDOWN, null); }
function saveCountdown(cd) { saveJson(K_COUNTDOWN, cd); }
function clearCountdown() { ext.storageSet(K_COUNTDOWN, ''); }
function loadSelect() { return loadJson(K_SELECT, null); }
function saveSelect(s) { saveJson(K_SELECT, s); }
function clearSelect() { ext.storageSet(K_SELECT, ''); }
function loadMatchState() { return loadJson(K_MATCH_STATE, null); }
function saveMatchState(st) { saveJson(K_MATCH_STATE, st); }
function clearMatchState() { ext.storageSet(K_MATCH_STATE, ''); }

// 清空本局秘钥（结束 / 停止时调用，避免残留秘钥影响下一局）
function clearTokens() {
  ext.storageSet(K_MATCH, '');
  ext.storageSet(K_DEF, '');
  ext.storageSet(K_ATK, '');
}

// 清理超过 15 分钟的待审成绩
function cleanupPending(now) {
  const p = loadPending();
  let changed = false;
  const keys = Object.keys(p);
  for (let i = 0; i < keys.length; i++) {
    if (now - (p[keys[i]].ts || 0) > 900000) {
      delete p[keys[i]];
      changed = true;
    }
  }
  if (changed) savePending(p);
  return p;
}

function genReviewCode() {
  return ('0000' + Math.floor(Math.random() * 0xffff).toString(16).toUpperCase()).slice(-4);
}

function isAdmin(ctx) {
  return (ctx.privilegeLevel || 0) >= 50; // 群管理/群主/信任/骰主
}

function getCfg(key) {
  return seal.ext.getStringConfig(ext, key) || '';
}

function gidOf(msg) {
  return String(msg.groupId || 'private:' + msg.sender.userId);
}

// 触发正则（模板逐行过滤后以 | 连接）
function getTriggerRegex() {
  const lines = (seal.ext.getTemplateConfig(ext, 'triggerText') || []).filter(function (x) {
    return x && String(x).trim();
  });
  const pattern = lines.join('|');
  if (pattern) {
    try {
      return new RegExp(pattern);
    } catch (e) {
      console.log('[' + ext.name + '] 触发正则错误：' + pattern + '，' + (e && e.message ? e.message : e));
      return /(?!)/;
    }
  }
  return /(?!)/;
}

// ============ 4. 通用工具 ============
function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error('请求超时（' + ms + 'ms）'));
    }, ms);
    promise.then(function (v) {
      clearTimeout(timer);
      resolve(v);
    }, function (e) {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function genMsgId() {
  return 'ts-' + Date.now() + '-' + Math.floor(Math.random() * 1e12).toString(36);
}

function getNet() {
  return globalThis.net || globalThis.http || null;
}

function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/,/g, '').replace(/%/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNum(v);
  if (n === null) return null;
  return Math.floor(n);
}

// 从 "QQ:3837233349" / "QQ-Group:群号:QQ号" / 裸 QQ 号 等 userId 里取出纯数字 QQ 号
function qqNumberFromUserId(userId) {
  const m = String(userId || '').trim().match(/(\d+)\D*$/);
  return m ? m[1] : '';
}

// ============ 5. 主动发群消息（倒计时/轮询回调里没有原始 ctx） ============
function sendToGroup(gid, text) {
  const eps = seal.getEndPoints();
  if (!eps || !eps.length) {
    console.log('[' + ext.name + '] 无可用通信端点，无法主动发消息：' + String(text).slice(0, 60));
    return false;
  }
  const m = seal.newMessage();
  m.messageType = 'group';
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    try {
      m.platform = ep.platform;
      m.groupId = gid;
      m.sender.userId = ep.userId;
      const tempCtx = seal.createTempCtx(ep, m);
      seal.replyGroup(tempCtx, m, text);
      return true;
    } catch (e) {
      console.log('[' + ext.name + '] 端点 ' + ep.platform + '/' + ep.userId + ' 发送失败：' + (e && e.message ? e.message : e));
    }
  }
  console.log('[' + ext.name + '] 所有通信端点均发送失败：' + String(text).slice(0, 60));
  return false;
}

// ============ 6. 图片获取（引用消息 → ob11 → 图片 URL） ============
const REPLY_PREFIX_RE = /^\[CQ:reply,id=(-?\d+)[^\]]*\]\s*(?:\[CQ:at,qq=\d+\])?/;

function parseReplyPrefix(text) {
  if (!text) return null;
  const m = text.match(REPLY_PREFIX_RE);
  if (!m) return null;
  return { replyId: m[1], rest: text.slice(m[0].length) };
}

function extractImageUrl(text) {
  if (!text) return null;
  const m = text.match(/\[CQ:image[^\]]*url=([^,\]\s]+)/i);
  if (m) return m[1];
  const f = text.match(/\[CQ:image[^\]]*file=([^,\]\s]+)/i);
  if (f && /^https?:\/\//i.test(f[1])) return f[1];
  const b = text.match(/https?:\/\/[^\s<>"\]]+/i);
  return b ? b[0] : null;
}

function extractImageFromSegments(message) {
  if (Array.isArray(message)) {
    for (let i = 0; i < message.length; i++) {
      const seg = message[i];
      if (seg && seg.type === 'image' && seg.data) {
        const u = seg.data.url || seg.data.file || '';
        if (u) return u;
      }
    }
    return null;
  }
  if (typeof message === 'string') return extractImageUrl(message);
  return null;
}

async function fetchQuotedImage(ctx, replyId) {
  const net = getNet();
  if (!net || typeof net.callApi !== 'function') {
    throw new Error('未找到 ob11 网络连接依赖（globalThis.net），无法拉取被引用消息');
  }
  const epId = ctx && ctx.endPoint ? ctx.endPoint.userId : '';
  const data = await withTimeout(net.callApi(epId, 'get_msg', { message_id: Number(replyId) }), 15000);
  if (!data) return null;
  const src = extractImageFromSegments(data.message);
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  try {
    const img = await withTimeout(net.callApi(epId, 'get_image', { file: src }), 15000);
    if (img && img.url) return img.url;
  } catch (e) {
    // 忽略，保留原值
  }
  return /^https?:\/\//i.test(src) ? src : null;
}

// ============ 7. 结果返回（aiplugin4-backends web-read MCP） ============
function parseMcpResult(text) {
  // MCP Streamable HTTP 响应可能是纯 JSON 或 SSE（event: message\ndata: {...}）
  let obj = null;
  const t = String(text || '').trim();
  if (t.startsWith('{')) {
    try {
      obj = JSON.parse(t);
    } catch (e) {
      obj = null;
    }
  } else {
    const lines = t.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('data:') === 0) {
        try {
          const parsed = JSON.parse(lines[i].slice(5).trim());
          if (parsed && parsed.result) obj = parsed;
        } catch (e) {
          // 忽略非 JSON 行
        }
      }
    }
  }
  if (!obj || !obj.result) return null;
  const res = obj.result;
  if (res && res.content && Array.isArray(res.content)) {
    return res.content.map(function (c) { return c.text || ''; }).join('\n');
  }
  return JSON.stringify(res);
}

// 通过 MCP（Streamable HTTP，JSON-RPC）调用 web-read 的 screenshot_url 工具
async function mcpScreenshot(base, targetUrl, token) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (token) headers['X-Token'] = token;
  const initResp = await withTimeout(fetch(base + '/mcp', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2026-03-26',
        capabilities: {},
        clientInfo: { name: 'triangle-score-plugin', version: '2.0.0' }
      }
    })
  }), 20000);
  const sid = initResp.headers.get('mcp-session-id') || '';
  await initResp.text();
  if (!sid) return null;
  const h2 = Object.assign({}, headers, { 'Mcp-Session-Id': sid });
  await withTimeout(fetch(base + '/mcp', {
    method: 'POST',
    headers: h2,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  }), 15000);
  const callResp = await withTimeout(fetch(base + '/mcp', {
    method: 'POST',
    headers: h2,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'screenshot_url',
        arguments: { url: targetUrl, width: 1680, height: 1000, fullPage: false, delay: 4500 }
      }
    })
  }), 90000);
  const text = await callResp.text();
  const resultText = parseMcpResult(text);
  // 工具返回的 base64 文本；失败时返回的是错误描述，不是 base64
  if (resultText && /^[A-Za-z0-9+/=]+$/.test(resultText) && resultText.length > 100) {
    return resultText;
  }
  console.log('[' + ext.name + '] MCP 截图返回异常：' + String(resultText || '').slice(0, 120));
  return null;
}

async function takeScreenshotFor(ctx, msg, url, fallbackText) {
  const base = getCfg('screenshotUrl').replace(/\/+$/, '');
  if (!base) return false;
  const token = getCfg('screenshotToken');
  let b64 = null;
  try {
    b64 = await mcpScreenshot(base, url, token);
  } catch (e) {
    console.log('[' + ext.name + '] MCP 截图失败：' + (e && e.message ? e.message : e));
  }
  if (b64) {
    seal.replyToSender(ctx, msg, '[CQ:image,file=base64://' + b64 + ']');
    return true;
  }
  if (fallbackText) seal.replyToSender(ctx, msg, fallbackText);
  return false;
}

async function takeBoardScreenshot(ctx, msg, fallbackText) {
  const ctrlBase = getCfg('controllerUrl').replace(/\/+$/, '');
  return takeScreenshotFor(ctx, msg, ctrlBase, fallbackText);
}

// 无原始 ctx（倒计时/轮询回调）时给群发截图
async function sendScreenshotToGroup(gid, url, fallbackText) {
  const base = getCfg('screenshotUrl').replace(/\/+$/, '');
  if (!base) {
    if (fallbackText) sendToGroup(gid, fallbackText);
    return false;
  }
  const token = getCfg('screenshotToken');
  let b64 = null;
  try {
    b64 = await mcpScreenshot(base, url, token);
  } catch (e) {
    console.log('[' + ext.name + '] MCP 截图失败：' + (e && e.message ? e.message : e));
  }
  if (b64) {
    sendToGroup(gid, '[CQ:image,file=base64://' + b64 + ']');
    return true;
  }
  if (fallbackText) sendToGroup(gid, fallbackText);
  return false;
}

// ============ 8. 赛程拉取（比赛网站只读接口） ============
function siteBase() {
  return getCfg('siteUrl').replace(/\/+$/, '');
}

function scheduleUrl() {
  const site = siteBase();
  if (!site) return '';
  const cid = String(getCfg('competitionId') || '').trim();
  return cid ? site + '/api/competitions/' + cid + '/schedule' : site + '/api/schedule/current';
}

async function fetchSchedule() {
  const url = scheduleUrl();
  if (!url) throw new Error('未配置 siteUrl（插件设置）');
  const resp = await withTimeout(fetch(url), 30000);
  let body = null;
  try {
    body = await resp.json();
  } catch (e) {
    body = null;
  }
  if (resp.status >= 400 || !body || !body.competition || !Array.isArray(body.matches)) {
    const message = body && body.detail ? body.detail : 'HTTP ' + resp.status;
    throw new Error(message);
  }
  return body;
}

function sideText(p) {
  if (!p) return '待定';
  const name = p.name || '待定';
  const qqs = p.qqs || [];
  return name + (qqs.length ? '（QQ:' + qqs.join('、') + '）' : '（未填QQ）');
}

function buildSides(match) {
  const a = match.participant_a || {};
  const b = match.participant_b || {};
  const attacker = { name: a.name || '待定', qqs: a.qqs || [] };
  const defender = { name: b.name || '待定', qqs: b.qqs || [] };
  const players = {};
  (attacker.qqs || []).forEach(function (q) { players[String(q)] = { id: String(q), name: attacker.name, team: 'attacker' }; });
  (defender.qqs || []).forEach(function (q) { players[String(q)] = { id: String(q), name: defender.name, team: 'defender' }; });
  return { attacker: attacker, defender: defender, players: players };
}

function bracketUrl(competitionId) {
  const site = siteBase();
  if (!site || !competitionId) return '';
  return site + '/competitions/' + competitionId + '/bracket';
}

// ============ 9. 倒计时 / 结束轮询（0.5s 循环，状态全在存储里，重载不丢） ============
const COUNTDOWN_MS = 120000;   // 固定 2 分钟
const POLL_START_MS = 24 * 60 * 1000;  // 第 24 分钟才开始轮询
const POLL_INTERVAL_MS = 30000;

function beginCountdown(ctx, msg, match, competition) {
  const gid = gidOf(msg);
  const sides = buildSides(match);
  const ats = sides.attacker.qqs.concat(sides.defender.qqs).map(function (q) {
    return '[CQ:at,qq=' + q + ']';
  }).join(' ');
  const text = ats +
    '\n【三角占领】第 ' + match.round_id + ' 轮：掠夺者「' + sides.attacker.name + '」 vs 守护者「' + sides.defender.name + '」' +
    '\n2 分钟后开局，请双方做好准备！';
  seal.replyToSender(ctx, msg, text);
  saveCountdown({
    group: gid,
    competitionId: competition.id,
    competitionName: competition.name,
    matchId: match.id,
    roundId: match.round_id,
    endAt: Date.now() + COUNTDOWN_MS,
    reminded60: false,
    lastNumber: -1,
    attacker: sides.attacker,
    defender: sides.defender,
    players: sides.players,
    ts: Date.now()
  });
}

function tickCountdown() {
  const cd = loadCountdown();
  if (!cd) return;
  const now = Date.now();
  const remain = cd.endAt - now;
  if (remain <= 0) {
    clearCountdown();
    startMatchFromCountdown(cd);
    return;
  }
  if (remain <= 60000 && !cd.reminded60) {
    cd.reminded60 = true;
    saveCountdown(cd);
    sendToGroup(cd.group, '距离开局还有 1 分钟！');
    return;
  }
  if (remain <= 3000) {
    const n = Math.ceil(remain / 1000); // 3 → 2 → 1
    if (n >= 1 && n <= 3 && n !== cd.lastNumber) {
      cd.lastNumber = n;
      saveCountdown(cd);
      sendToGroup(cd.group, String(n));
    }
  }
}

// 倒计时结束才开局：POST /api/init 拿秘钥，存对局身份，发棋盘截图
async function startMatchFromCountdown(cd) {
  const base = getCfg('controllerUrl').replace(/\/+$/, '');
  if (!base) {
    sendToGroup(cd.group, '开局失败：未配置 controllerUrl（插件设置）');
    return;
  }
  sendToGroup(cd.group, '倒计时结束，正在开局…');
  try {
    const resp = await withTimeout(fetch(base + '/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }), 30000);
    let body = null;
    try {
      body = await resp.json();
    } catch (e) {
      body = null;
    }
    if (resp.status >= 400 || !body || !body.ok) {
      const message = body && body.message ? body.message : 'HTTP ' + resp.status;
      sendToGroup(cd.group, '开局失败：' + message + '（若提示请先导入歌曲库，需由后端运行人先 POST /api/songs；可重新 .ts start）');
      return;
    }
    const t = body.tokens || {};
    if (!t.match || !t.defender || !t.attacker) {
      sendToGroup(cd.group, '开局成功但响应缺少 tokens，请确认控制器已包含成绩上传协议（/api/v1）');
      return;
    }
    ext.storageSet(K_MATCH, String(t.match));
    ext.storageSet(K_DEF, String(t.defender));
    ext.storageSet(K_ATK, String(t.attacker));
    saveMatchState({
      group: cd.group,
      competitionId: cd.competitionId,
      competitionName: cd.competitionName,
      matchId: cd.matchId,
      roundId: cd.roundId,
      startedAt: Date.now(),
      lastPollAt: 0,
      bracketUrl: bracketUrl(cd.competitionId),
      attacker: cd.attacker,
      defender: cd.defender,
      players: cd.players
    });
    sendToGroup(cd.group, '比赛已开始（第 ' + cd.roundId + ' 轮），秘钥已记录（不对外展示）。现在可以引用结算截图发送「上传成绩」。');
    await sendScreenshotToGroup(cd.group, base, '控制器截图失败，请检查 screenshotUrl 与 web-read 后端');
  } catch (e) {
    sendToGroup(cd.group, '开局失败（网络/接口）：' + (e && e.message ? e.message : e) + '（可重新 .ts start）');
  }
}

function winnerText(s) {
  if (!s) return '';
  if (s.winner === 'attacker') return '掠夺者获胜';
  if (s.winner === 'defender') return '守护者获胜';
  if (s.winner === 'draw' || s.win_type === 'draw') return '平局';
  return '已结束';
}

function tickPoll() {
  const st = loadMatchState();
  if (!st) return;
  const now = Date.now();
  if (now - (st.startedAt || 0) < POLL_START_MS) return;
  if (now - (st.lastPollAt || 0) < POLL_INTERVAL_MS) return;
  st.lastPollAt = now;
  saveMatchState(st);
  const base = getCfg('controllerUrl').replace(/\/+$/, '');
  if (!base) return;
  fetch(base + '/api/state').then(function (resp) {
    return resp.json();
  }).then(function (s) {
    if (!s || !s.game_over) return;
    clearMatchState();
    clearTokens();
    sendToGroup(st.group, '比赛已结束！' + winnerText(s));
    if (st.bracketUrl) {
      sendScreenshotToGroup(st.group, st.bracketUrl, '赛程图获取失败，请手动打开 ' + st.bracketUrl);
    }
  }).catch(function (e) {
    console.log('[' + ext.name + '] 轮询控制器状态失败：' + (e && e.message ? e.message : e));
  });
}

function tickCleanup() {
  const now = Date.now();
  const sel = loadSelect();
  if (sel && now - (sel.ts || 0) > 180000) clearSelect();
  cleanupPending(now);
}

function tickLoop() {
  try { tickCountdown(); } catch (e) { console.log('[' + ext.name + '] 倒计时循环错误：' + (e && e.message ? e.message : e)); }
  try { tickPoll(); } catch (e) { console.log('[' + ext.name + '] 轮询循环错误：' + (e && e.message ? e.message : e)); }
  try { tickCleanup(); } catch (e) { console.log('[' + ext.name + '] 清理循环错误：' + (e && e.message ? e.message : e)); }
}

// ============ 10. 控制器协议调用 ============
function teamName(team) {
  return team === 'attacker' ? '掠夺者' : '守护者';
}

function buildUploadPayload(player, recognized) {
  const result = {};
  const score = toInt(recognized.score);
  if (score !== null) result.score = score;
  const tp = toNum(recognized.tp);
  if (tp !== null) result.tp = tp;
  const miss = toInt(recognized.miss);
  const bad = toInt(recognized.bad);
  const good = toInt(recognized.good);
  if (miss !== null) result.miss = miss;
  if (bad !== null) result.bad = bad;
  if (good !== null) result.good = good;
  result.mm = String(recognized.rating || '').toUpperCase() === 'MM';
  result.full_combo = miss === 0;

  const payload = {
    api_version: '1',
    client_msg_id: genMsgId(),
    team: player.team,
    player: { id: player.id, name: player.name },
    song: { name: String(recognized.song || '').trim() },
    result: result
  };
  if (recognized.difficultyLevel != null) payload.song.level = String(recognized.difficultyLevel);
  if (recognized.difficulty != null) payload.song.type = String(recognized.difficulty);
  return payload;
}

async function submitPayload(payload) {
  const base = getCfg('controllerUrl').replace(/\/+$/, '');
  const matchToken = getStoredToken(K_MATCH);
  const teamToken = payload.team === 'attacker' ? getStoredToken(K_ATK) : getStoredToken(K_DEF);

  const resp = await withTimeout(fetch(base + '/api/v1/results', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Match-Token': matchToken,
      'X-Team-Token': teamToken
    },
    body: JSON.stringify(payload)
  }), 30000);

  let body = null;
  try {
    body = await resp.json();
  } catch (e) {
    body = null;
  }
  return { status: resp.status, body: body, payload: payload };
}

// 结束比赛：调用 /api/end，清空本群待审成绩与对局状态，发赛程图
async function stopMatchAsync(ctx, msg) {
  const base = getCfg('controllerUrl').replace(/\/+$/, '');
  if (!base) {
    seal.replyToSender(ctx, msg, '未配置 controllerUrl（插件设置）');
    return;
  }
  const gid = gidOf(msg);
  seal.replyToSender(ctx, msg, '正在结束比赛…');
  try {
    const resp = await withTimeout(fetch(base + '/api/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }), 20000);
    let body = null;
    try {
      body = await resp.json();
    } catch (e) {
      body = null;
    }
    if (resp.status >= 400 || !body || !body.ok) {
      const message = body && body.message ? body.message : 'HTTP ' + resp.status;
      seal.replyToSender(ctx, msg, '结束比赛失败：' + message);
      return;
    }
    const pendings = loadPending();
    const keys = Object.keys(pendings);
    let changed = false;
    for (let i = 0; i < keys.length; i++) {
      if (String(pendings[keys[i]].group || '') === gid) {
        delete pendings[keys[i]];
        changed = true;
      }
    }
    if (changed) savePending(pendings);
    const st = loadMatchState();
    if (st && String(st.group) === gid) clearMatchState();
    clearTokens();
    seal.replyToSender(ctx, msg, '比赛已结束，待审成绩已清空');
    const url = (st && st.bracketUrl) || bracketUrl(String(getCfg('competitionId') || '').trim());
    if (url) await takeScreenshotFor(ctx, msg, url, '赛程图获取失败，请手动打开 ' + url);
  } catch (e) {
    seal.replyToSender(ctx, msg, '结束比赛失败（网络/接口）：' + (e && e.message ? e.message : e));
  }
}

function outcomeText(body) {
  if (!body || !body.ok) return '';
  const map = {
    occupied: '占领成功',
    l1_holder: 'L1 挑战成功',
    l1_challenged_lost: 'L1 挑战未超过',
    already_occupied: '该歌曲所在格已被占领',
    duplicate: '重复上报'
  };
  return map[body.outcome] || body.outcome || '';
}

// 提交成绩并返回结果（确认审核通过后调用）
async function finalizeUpload(ctx, msg, payload, player, songName) {
  let res;
  try {
    res = await submitPayload(payload);
  } catch (e) {
    seal.replyToSender(ctx, msg, '成绩上传失败（网络/接口）：' + (e && e.message ? e.message : e));
    return false;
  }
  const body = res.body;
  if (res.status >= 400 || !body || !body.ok) {
    const code = body && body.code ? body.code : 'HTTP ' + res.status;
    const message = body && body.message ? body.message : '接口错误';
    seal.replyToSender(ctx, msg, '成绩上传被拒绝：' + code + ' ' + message);
    return false;
  }
  const outcome = outcomeText(body);
  const fallbackText = [
    '三角占领 · 成绩上报',
    '选手：' + player.name + '（' + teamName(player.team) + '）',
    '歌曲：' + songName,
    '结果：' + outcome,
    body.data && body.data.scores ? '比分：守护者 ' + body.data.scores.defender + ' : ' + body.data.scores.attacker + ' 掠夺者' : '',
    body.data && body.data.event ? body.data.event : ''
  ].filter(function (x) { return x; }).join('\n');

  seal.replyToSender(ctx, msg, '成绩上报完成：' + outcome);
  await takeBoardScreenshot(ctx, msg, fallbackText);
  return true;
}

// 群管理审核：引用确认消息回复 确认 / 修改 字段 值 / 拒绝
async function handleReview(ctx, msg, rest) {
  if (!isAdmin(ctx)) {
    seal.replyToSender(ctx, msg, '仅群管理以上可审核成绩');
    return;
  }
  cleanupPending(Date.now());
  const gid = gidOf(msg);
  const pendings = loadPending();
  const parsed = parseReplyPrefix(msg.message || '');
  const replyId = parsed ? String(parsed.replyId) : '';
  let pending = replyId ? pendings[replyId] : null;
  if (!pending) pending = pendings['group:' + gid] || null;
  if (!pending) {
    seal.replyToSender(ctx, msg, '没有找到对应的待审成绩（请引用 bot 发的确认消息回复）');
    return;
  }
  const pkey = replyId && pendings[replyId] ? replyId : 'group:' + gid;
  const text = String(rest || '').trim();
  if (/^拒绝/.test(text)) {
    delete pendings[pkey];
    savePending(pendings);
    seal.replyToSender(ctx, msg, '已拒绝该成绩（编号 ' + pending.code + '）');
    return;
  }
  if (/^确认/.test(text)) {
    // 先上传，成功后才删除待审；失败时保留，可修正后重试
    const ok = await finalizeUpload(ctx, msg, pending.payload, pending.player, pending.songName);
    if (ok) {
      delete pendings[pkey];
      savePending(pendings);
    }
    return;
  }
  if (/^修改/.test(text)) {
    const payload = pending.payload;
    const editText = text.replace(/^修改/, '').trim();
    const edits = {};
    const editRe = /(score|tp|miss|bad|good|mm|fc)\s*[:=]?\s*(-?\d+(?:\.\d+)?|true|false)/gi;
    let em = null;
    while ((em = editRe.exec(editText)) !== null) {
      const k = em[1].toLowerCase();
      let v = em[2];
      if (k === 'mm' || k === 'fc') {
        v = /^true$/i.test(v);
      } else {
        v = Number(v);
      }
      edits[k] = v;
    }
    const applied = [];
    if (Object.keys(edits).length > 0) {
      if (edits.score != null) { payload.result.score = Math.floor(edits.score); applied.push('score=' + payload.result.score); }
      if (edits.tp != null) { payload.result.tp = edits.tp; applied.push('tp=' + payload.result.tp); }
      if (edits.miss != null) { payload.result.miss = Math.floor(edits.miss); applied.push('miss=' + payload.result.miss); }
      if (edits.bad != null) { payload.result.bad = Math.floor(edits.bad); applied.push('bad=' + payload.result.bad); }
      if (edits.good != null) { payload.result.good = Math.floor(edits.good); applied.push('good=' + payload.result.good); }
      if (edits.mm != null) { payload.result.mm = edits.mm; applied.push('mm=' + edits.mm); }
      if (edits.fc != null) { payload.result.full_combo = edits.fc; applied.push('fc=' + edits.fc); }
    } else {
      // 兼容旧写法：修改 分数 TP
      const nums = editText.match(/-?\d+(?:\.\d+)?/g) || [];
      if (nums.length >= 1) { payload.result.score = Math.floor(Number(nums[0])); applied.push('score=' + payload.result.score); }
      if (nums.length >= 2) { payload.result.tp = Number(nums[1]); applied.push('tp=' + payload.result.tp); }
    }
    if (applied.length === 0) {
      seal.replyToSender(ctx, msg, '未识别到有效修改字段，请按「修改 <字段> <值>」回复，例：修改 score 991420 ｜ 修改 miss 0 bad 0 good 1（字段：score/tp/miss/bad/good/mm/fc）');
      return;
    }
    seal.replyToSender(ctx, msg, '已修改：' + applied.join('，') + '，正在上传…');
    // 先上传，成功后才删除待审；失败时保留已修改内容，可继续修正重试
    const ok = await finalizeUpload(ctx, msg, payload, pending.player, pending.songName);
    if (ok) {
      delete pendings[pkey];
      savePending(pendings);
    }
    return;
  }
  seal.replyToSender(ctx, msg, '未识别的审核指令：请回复「确认」「修改 <字段> <值>」「拒绝」');
}

// 通过 ob11 发送确认消息并拿回 message_id；失败时回退 replyToSender + 群级 key
async function sendConfirmation(ctx, msg, text) {
  const net = getNet();
  const epId = ctx && ctx.endPoint ? ctx.endPoint.userId : '';
  if (net && typeof net.callApi === 'function' && msg.messageType === 'group' && msg.groupId) {
    const gid = String(msg.groupId).replace(/^QQ-Group:/, '').trim();
    try {
      const r = await withTimeout(
        net.callApi(epId, 'send_group_msg', { group_id: Number(gid), message: text }),
        15000
      );
      const data = r && r.data ? r.data : r;
      if (data && data.message_id != null) {
        return { key: String(data.message_id), sent: true };
      }
    } catch (e) {
      console.log('[' + ext.name + '] ob11 发送确认消息失败：' + (e && e.message ? e.message : e));
    }
  }
  seal.replyToSender(ctx, msg, text);
  return { key: 'group:' + gidOf(msg), sent: false };
}

// ============ 11. 核心上传流程 ============
async function handleUpload(ctx, msg, replyId) {
  const st = loadMatchState();
  const gid = gidOf(msg);
  const uid = qqNumberFromUserId(msg.sender.userId);
  let player = null;
  if (st && String(st.group) === gid && st.players) {
    player = st.players[uid] || null;
  }
  if (!player) {
    seal.replyToSender(ctx, msg, '未匹配到本局选手身份：赛程名单中没找到 QQ=' + uid + '（选手需在网站个人资料里填写 QQ）');
    return;
  }

  let url = '';
  if (replyId) {
    try {
      url = await fetchQuotedImage(ctx, replyId);
    } catch (e) {
      seal.replyToSender(ctx, msg, '成绩上传失败：' + (e && e.message ? e.message : e));
      return;
    }
  }
  if (!url) url = extractImageUrl(msg.message || '');
  if (!url) {
    seal.replyToSender(ctx, msg, '被引用的消息里没有找到图片');
    return;
  }

  seal.replyToSender(ctx, msg, '正在识别结算截图，请稍候…（模型响应慢时可能需要几分钟）');

  const recApi = globalThis.imageRecognizerCy2API;
  if (!recApi || typeof recApi.recognize !== 'function') {
    seal.replyToSender(ctx, msg, '未找到 image-recognizer（cy2 特化版）识图接口（globalThis.imageRecognizerCy2API），请确认已加载该插件');
    return;
  }

  let rec;
  try {
    rec = await recApi.recognize(url, { timeoutMs: 420000 });
  } catch (e) {
    seal.replyToSender(ctx, msg, '截图识别失败：' + (e && e.message ? e.message : e));
    return;
  }
  if (!rec || !rec.ok || !rec.data) {
    seal.replyToSender(ctx, msg, '截图识别失败：' + (rec && rec.error ? rec.error : '未返回结构化数据'));
    return;
  }

  const d = rec.data;
  const songName = String(d.song || '').trim();
  if (!songName || songName === '曲目搜索失败') {
    seal.replyToSender(ctx, msg, '未识别到有效曲名' + (songName ? '：' + songName : ''));
    return;
  }
  if (!getStoredToken(K_MATCH)) {
    seal.replyToSender(ctx, msg, '比赛尚未开局，请先发送 .ts start 开局并记录秘钥');
    return;
  }
  const teamToken = player.team === 'attacker' ? getStoredToken(K_ATK) : getStoredToken(K_DEF);
  if (!teamToken) {
    seal.replyToSender(ctx, msg, '阵营秘钥缺失，请重新发送 .ts start 开局');
    return;
  }

  // 生成待审成绩，等群管理确认后才真正上传
  const payload = buildUploadPayload(player, d);
  cleanupPending(Date.now());
  const pendings = loadPending();
  const keys = Object.keys(pendings);
  let exists = false;
  for (let i = 0; i < keys.length; i++) {
    if (String(pendings[keys[i]].group || '') === gid) {
      exists = true;
      break;
    }
  }
  if (exists) {
    seal.replyToSender(ctx, msg, '已有成绩待确认，请群管理先处理（引用确认消息回复 确认/修改/拒绝）');
    return;
  }
  const code = genReviewCode();
  const r = payload.result;
  const lines = [
    '【成绩待确认 · 编号 ' + code + '】',
    '选手：' + player.name + '（' + teamName(player.team) + '）',
    '歌曲：' + songName + (payload.song.level ? ' 难度 ' + payload.song.level : ''),
    '得分：' + (r.score != null ? r.score : '-') + '　TP：' + (r.tp != null ? r.tp : '-') +
      (r.miss != null || r.bad != null || r.good != null
        ? '　miss/bad/good: ' + (r.miss != null ? r.miss : '?') + '/' + (r.bad != null ? r.bad : '?') + '/' + (r.good != null ? r.good : '?')
        : ''),
    '',
    '群管理请引用本消息回复：',
    '确认 —— 按以上成绩上传',
    '修改 <字段> <值> —— 可改 score/tp/miss/bad/good/mm/fc，例：修改 score 991420 / 修改 miss 0 bad 0 good 1',
    '拒绝 —— 作废'
  ];
  const sent = await sendConfirmation(ctx, msg, lines.join('\n'));
  pendings[sent.key] = { code: code, payload: payload, player: player, songName: songName, ts: Date.now(), group: gid };
  savePending(pendings);
}

// ============ 12. 指令 .ts ============
const cmd = seal.ext.newCmdItemInfo();
cmd.name = 'ts';
cmd.help = [
  '.ts help                    查看帮助',
  '.ts status                  查看配置 / 倒计时 / 当前对局状态',
  '.ts start                   拉取赛程 → 选择对局 → @选手倒计时开局（仅群管理以上）',
  '.ts stop                    结束比赛并发送赛程图（仅群管理以上）',
  '.ts board                   查看控制器当前比分/占领情况',
  '.ts tasks                   查看本局 21 个任务格的歌曲列表',
  '.ts shot                    截取控制器网页当前画面',
  '',
  '【开局流程】',
  '1. 群管理发送 .ts start，bot 列出候选对局（含双方与 QQ）；',
  '2. 群管理回复对局 ID（纯数字）确认；',
  '3. bot @ 全体选手并开始 2 分钟倒计时（剩余 1 分钟时提醒一次，最后 3 秒读秒）；',
  '4. 倒计时结束自动开局并记录秘钥，发棋盘截图。',
  '',
  '【上传成绩流程】',
  '1. 引用（回复）一张结算截图，消息文本填「上传成绩」；',
  '2. bot 发出一条【成绩待确认】消息；',
  '3. 群管理引用该消息回复：',
  '   · 确认 —— 按识别成绩上传',
  '   · 修改 <字段> <值> —— 修改后再上传，字段：score/tp/miss/bad/good/mm/fc',
  '     例：修改 score 991420 ｜ 修改 miss 0 bad 0 good 1',
  '   · 拒绝 —— 作废该成绩',
  '',
  '说明：.ts start / .ts stop 需要群管理以上权限；审核确认同样仅限群管理。',
  '',
  '限制：同一时刻只支持一个群跑一局（倒计时 / 对局 / 秘钥为全局单实例）。'
].join('\n');
cmd.allowDelegate = false;
cmd.disabledInPrivate = false;

cmd.solve = function (ctx, msg, cmdArgs) {
  const ret = seal.ext.newCmdExecuteResult(true);
  const sub = cmdArgs.getArgN(1);

  if (sub === 'help' || sub === undefined || sub === '') {
    ret.showHelp = true;
    return ret;
  }

  if (sub === 'status') {
    const gid = gidOf(msg);
    const cd = loadCountdown();
    const st = loadMatchState();
    const pendings = loadPending();
    const pendingCount = Object.keys(pendings).filter(function (k) {
      return String(pendings[k].group || '') === gid;
    }).length;
    const lines = [
      '网站：' + (siteBase() ? '已配置' : '未配置') + (String(getCfg('competitionId') || '').trim() ? '（比赛ID ' + getCfg('competitionId') + '）' : '（自动当前比赛）'),
      '控制器：' + (getCfg('controllerUrl') ? '已配置' : '未配置'),
      '截图后端：' + (getCfg('screenshotUrl') ? '已配置' : '未配置'),
      '识图接口：' + (globalThis.imageRecognizerCy2API ? '可用 v' + (globalThis.imageRecognizerCy2API.version || '?') : '缺失（需安装 image-recognizer cy2 特化版）'),
      'ob11 依赖：' + (getNet() ? '可用' : '缺失'),
      '待审核成绩：' + pendingCount + ' 条'
    ];
    if (cd && String(cd.group) === gid) {
      const remain = Math.max(0, Math.ceil((cd.endAt - Date.now()) / 1000));
      lines.unshift('倒计时：第 ' + cd.roundId + ' 轮对局，剩余 ' + remain + ' 秒');
    } else if (st && String(st.group) === gid) {
      lines.unshift('当前对局：第 ' + st.roundId + ' 轮（掠夺者「' + st.attacker.name + '」 vs 守护者「' + st.defender.name + '」）已进行 ' + Math.floor((Date.now() - st.startedAt) / 60000) + ' 分钟');
    } else {
      lines.unshift('当前状态：本群无倒计时/对局（发送 .ts start 开始）');
    }
    seal.replyToSender(ctx, msg, lines.join('\n'));
    return ret;
  }

  if (sub === 'start') {
    if (!isAdmin(ctx)) {
      seal.replyToSender(ctx, msg, '仅群管理以上可开始比赛');
      return ret;
    }
    const gid = gidOf(msg);
    const cd = loadCountdown();
    if (cd) {
      if (String(cd.group) === gid) {
        seal.replyToSender(ctx, msg, '本群已有倒计时进行中（剩余 ' + Math.max(0, Math.ceil((cd.endAt - Date.now()) / 1000)) + ' 秒），请稍候');
      } else {
        seal.replyToSender(ctx, msg, '另一个群已有倒计时进行中（当前版本同一时刻只支持一个群跑一局），请稍候');
      }
      return ret;
    }
    const st = loadMatchState();
    if (st) {
      if (String(st.group) === gid) {
        seal.replyToSender(ctx, msg, '本群已有对局进行中，请先 .ts stop 结束再开新局');
      } else {
        seal.replyToSender(ctx, msg, '另一个群已有对局进行中（当前版本同一时刻只支持一个群跑一局），请先结束该群对局');
      }
      return ret;
    }
    if (!siteBase()) {
      seal.replyToSender(ctx, msg, '未配置 siteUrl（插件设置），无法拉取赛程');
      return ret;
    }
    seal.replyToSender(ctx, msg, '正在拉取赛程…');
    fetchSchedule().then(function (s) {
      const candidates = (s.matches || []).filter(function (m) {
        return m.status === 'pending' && m.participant_a && m.participant_b;
      });
      if (candidates.length === 0) {
        seal.replyToSender(ctx, msg, '当前没有双方已确定的待开始对局（单败淘汰后续轮次需上一轮结束后才能排定）');
        return;
      }
      const lines = candidates.map(function (m) {
        return '对局ID ' + m.id + ' ｜ 第' + m.round_id + '轮：掠夺者 ' + sideText(m.participant_a) + ' vs 守护者 ' + sideText(m.participant_b);
      });
      saveSelect({ group: gid, competition: s.competition, candidates: candidates, ts: Date.now() });
      seal.replyToSender(ctx, msg, '请群管理回复对局 ID（纯数字）确认要开始的比赛（120 秒内有效）：\n' + lines.join('\n'));
    }).catch(function (e) {
      seal.replyToSender(ctx, msg, '拉取赛程失败：' + (e && e.message ? e.message : e) + '（请确认 siteUrl 与比赛网站状态）');
    });
    return ret;
  }

  if (sub === 'stop') {
    if (!isAdmin(ctx)) {
      seal.replyToSender(ctx, msg, '仅群管理以上可结束比赛');
      return ret;
    }
    stopMatchAsync(ctx, msg);
    return ret;
  }

  if (sub === 'board') {
    const base = getCfg('controllerUrl').replace(/\/+$/, '');
    fetch(base + '/api/state').then(function (resp) {
      return resp.json();
    }).then(function (state) {
      const scores = state.scores || {};
      const l1 = state.l1 || {};
      let occupiedDef = 0;
      let occupiedAtk = 0;
      const cells = state.board || [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].owner === 'defender') occupiedDef++;
        if (cells[i].owner === 'attacker') occupiedAtk++;
      }
      const lines = [
        '三角占领 · 当前状态',
        '比分：守护者 ' + scores.defender + ' : ' + scores.attacker + ' 掠夺者',
        '占领：守护者 ' + occupiedDef + ' 格 / 掠夺者 ' + occupiedAtk + ' 格',
        'L1 持有：' + (l1.holder ? (l1.holder === 'attacker' ? '掠夺者' : '守护者') : '无') + (l1.high_score != null ? '（score=' + l1.high_score + '）' : ''),
        '已用时：' + (state.elapsed != null ? state.elapsed : '-') + ' 分钟 / 限时 ' + (state.time_limit != null ? state.time_limit : '-') + ' 分钟'
      ];
      seal.replyToSender(ctx, msg, lines.join('\n'));
    }).catch(function (e) {
      seal.replyToSender(ctx, msg, '获取控制器状态失败：' + (e && e.message ? e.message : e));
    });
    return ret;
  }

  if (sub === 'tasks') {
    const base = getCfg('controllerUrl').replace(/\/+$/, '');
    const mt = getStoredToken(K_MATCH);
    const tt = getStoredToken(K_ATK) || getStoredToken(K_DEF);
    if (!mt || !tt) {
      seal.replyToSender(ctx, msg, '尚未开局，请先发送 .ts start');
      return ret;
    }
    fetch(base + '/api/v1/tasks', {
      headers: { 'X-Match-Token': mt, 'X-Team-Token': tt }
    }).then(function (resp) {
      return resp.json();
    }).then(function (d) {
      if (!d || !d.tasks || !d.ok) {
        seal.replyToSender(ctx, msg, '获取任务列表失败：' + (d && d.message ? d.message : '接口错误'));
        return;
      }
      const lines = d.tasks.map(function (t) {
        const lv = t.song_level ? ' ' + t.song_level : '';
        const mark = t.is_l1 ? ' [L1源头]' : (t.occupied_by ? ' [已被' + teamName(t.occupied_by) + '占]' : '');
        return t.song_name + lv + mark;
      });
      seal.replyToSender(ctx, msg, '本局 21 个任务格：\n' + lines.join('\n'));
    }).catch(function (e) {
      seal.replyToSender(ctx, msg, '获取任务列表失败：' + (e && e.message ? e.message : e));
    });
    return ret;
  }

  if (sub === 'shot' || sub === 'screenshot') {
    if (!getCfg('screenshotUrl')) {
      seal.replyToSender(ctx, msg, '未配置 screenshotUrl（插件设置），请填写 aiplugin4-backends web-read 地址');
      return ret;
    }
    seal.replyToSender(ctx, msg, '正在截取控制器页面…');
    takeBoardScreenshot(ctx, msg, '网页截图失败，请检查 screenshotUrl 配置与 web-read 后端状态');
    return ret;
  }

  if (sub === 'upload') {
    const parsed = parseReplyPrefix(msg.message || '');
    handleUpload(ctx, msg, parsed ? parsed.replyId : null);
    return ret;
  }

  ret.showHelp = true;
  return ret;
};

ext.cmdMap['ts'] = cmd;
ext.cmdMap['三角'] = cmd;

// ============ 13. 事件钩子 ============
ext.onLoad = function () {
  const cd = loadCountdown();
  if (cd) {
    const remain = Math.max(0, Math.ceil((cd.endAt - Date.now()) / 1000));
    console.log('[' + ext.name + '] v' + ext.version + ' 已加载，恢复倒计时任务：第 ' + cd.roundId + ' 轮，剩余 ' + remain + ' 秒');
  } else {
    console.log('[' + ext.name + '] v' + ext.version + ' 已加载');
  }
};

// 引用截图 + 触发文本（[CQ:reply] 前缀的消息不视为指令，走非指令钩子）；
// 另外处理 .ts start 之后管理回复「对局 ID」的选择。
ext.onNotCommandReceived = function (ctx, msg) {
  const gid = gidOf(msg);
  const raw = String(msg.message || '');
  const parsed = parseReplyPrefix(raw);

  if (parsed) {
    const rest = String(parsed.rest || '').trim();
    // 群管理审核：引用确认消息回复 确认 / 修改 / 拒绝
    if (/^(确认|修改|拒绝)/.test(rest)) {
      handleReview(ctx, msg, rest);
      return;
    }
    // 引用截图 + 触发文本：上传成绩
    const regex = getTriggerRegex();
    if (!regex || !regex.test(rest)) return;
    handleUpload(ctx, msg, parsed.replyId);
    return;
  }

  // .ts start 后等待管理回复对局 ID（纯数字）
  const sel = loadSelect();
  const trimmed = raw.trim();
  if (sel && String(sel.group) === gid && isAdmin(ctx) && /^\d+$/.test(trimmed)) {
    const match = (sel.candidates || []).find(function (c) {
      return String(c.id) === trimmed;
    });
    if (match) {
      clearSelect();
      beginCountdown(ctx, msg, match, sel.competition);
      return;
    }
    seal.replyToSender(ctx, msg, '没有找到对局 ID=' + trimmed + ' 的候选对局（可重新 .ts start 查看最新赛程）');
  }
};

// 0.5s 常驻循环：倒计时 / 结束轮询 / 清理。状态全部在存储里，插件重载后继续跑；
// 用全局标记防止热重载重复启动循环。
if (!globalThis.__tsCountdownLoopStarted) {
  globalThis.__tsCountdownLoopStarted = true;
  setInterval(tickLoop, 500);
  console.log('[' + ext.name + '] 0.5s 常驻循环已启动（倒计时/轮询/清理）');
}

// mock-test.js 专用测试钩子（仅在测试环境暴露内部函数，不影响海豹运行）
if (globalThis.__TS_TEST__ === true) {
  globalThis.__TS_TEST__ = {
    qqNumberFromUserId: qqNumberFromUserId
  };
}

// ==UserScript==
// @name         triangle-score-plugin
// @author       错误
// @version      1.0.0
// @description  对接「三角占领 · 赛时控制器」成绩上传协议：引用结算截图 → image-recognizer 识别 → 上传成绩 → 截取控制器网页返回
// @timestamp    2026-08-09
// @license      MIT
// @homepageURL  https://github.com/error2913/triangle-score-plugin
// @updateUrl    https://raw.githubusercontent.com/error2913/triangle-score-plugin/main/triangle-score-plugin.js
// @depends      错误:image-recognizer:>=1.0.0
// @sealVersion  1.4.5
// ==/UserScript==

// 依赖说明：image-recognizer 提供 globalThis.imageRecognizerAPI.recognize(url)，
// 其内部依赖 ob11 网络连接依赖（globalThis.net 拉图）与 aiplugin4（图片模型识别）。
// 本插件不再重复依赖这两个插件，由 image-recognizer 的 @depends 传递保证。

// ============ 1. 创建 / 复用扩展 ============
let ext = seal.ext.find('triangle_score_plugin');
if (!ext) {
  ext = seal.ext.new('triangle_score_plugin', '错误', '1.0.0');
  seal.ext.register(ext);
}

// ============ 2. 配置项 ============
seal.ext.registerStringConfig(ext, 'controllerUrl', 'http://127.0.0.1:8000', '赛时控制器地址（协议 Base URL）');
seal.ext.registerStringConfig(ext, 'screenshotUrl', 'http://127.0.0.1:46799', '网页截图后端地址（aiplugin4-backends web-read）');
seal.ext.registerStringConfig(ext, 'screenshotToken', '', '网页截图后端访问令牌（aiplugin4-backends 配置了 token 时填写，请求头 X-Token）');
seal.ext.registerTemplateConfig(ext, 'triggerText', ['上传成绩'], '触发文本模板：每行一个正则，作用于去掉引用前缀后的消息文本，任一命中即触发');

// 清理旧版配置项（秘钥已改为开局时由 .ts start 自动获取并存储；renderUrl 已移除，改走网页截图）
try {
  seal.ext.unregisterConfig(ext, 'matchToken', 'defenderToken', 'attackerToken', 'renderUrl');
} catch (e) {
  // 接口不支持或已清理时忽略
}

// 秘钥存储 key（只写不展示）
const K_MATCH = 'ts_match_token';
const K_DEF = 'ts_defender_token';
const K_ATK = 'ts_attacker_token';
const K_PENDING = 'ts_pending';

function getStoredToken(key) {
  return ext.storageGet(key) || '';
}

function loadPending() {
  try {
    const o = JSON.parse(ext.storageGet(K_PENDING) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

function savePending(p) {
  ext.storageSet(K_PENDING, JSON.stringify(p));
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

// ============ 3. 通用工具 ============
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

// ============ 4. 选手身份（持久化：ext.storage 存 JSON） ============
function loadPlayers() {
  try {
    const raw = ext.storageGet('players') || '{}';
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function savePlayers(players) {
  ext.storageSet('players', JSON.stringify(players));
}

function bindPlayer(userId, team, name) {
  const players = loadPlayers();
  const key = String(userId);
  const prev = players[key] || {};
  players[key] = {
    id: prev.id || key,
    name: name || prev.name || key,
    team: team
  };
  savePlayers(players);
  return players[key];
}

function unbindPlayer(userId) {
  const players = loadPlayers();
  const key = String(userId);
  const existed = !!players[key];
  delete players[key];
  savePlayers(players);
  return existed;
}

// 从 "QQ:3837233349" 这类 userId 里取出纯数字 QQ 号
function qqNumberFromUserId(userId) {
  const m = String(userId || '').match(/^QQ:(\d+)$/);
  return m ? m[1] : '';
}

// 通过 ob11 接口获取真实 QQ 昵称（群聊 get_group_member_info，私聊 get_stranger_info）
async function fetchNickname(ctx, msg) {
  const net = getNet();
  const uid = qqNumberFromUserId(msg.sender.userId);
  if (!uid || !net || typeof net.callApi !== 'function') {
    return String(msg.sender.nickname || '').trim() || ctx.player.name || String(msg.sender.userId);
  }
  const epId = ctx && ctx.endPoint ? ctx.endPoint.userId : '';
  const isGroup = msg.messageType === 'group' && msg.groupId;
  try {
    let data = null;
    if (isGroup) {
      const gid = String(msg.groupId).replace(/^QQ-Group:/, '').trim();
      const r = await withTimeout(
        net.callApi(epId, 'get_group_member_info', { group_id: Number(gid), user_id: Number(uid) }),
        10000
      );
      data = r && r.data ? r.data : r;
    } else {
      const r = await withTimeout(
        net.callApi(epId, 'get_stranger_info', { user_id: Number(uid) }),
        10000
      );
      data = r && r.data ? r.data : r;
    }
    if (data && data.nickname) {
      const nick = String(data.nickname).trim();
      if (nick) return nick;
    }
  } catch (e) {
    console.log('[' + ext.name + '] 获取 QQ 昵称失败：' + (e && e.message ? e.message : e));
  }
  return String(msg.sender.nickname || '').trim() || ctx.player.name || uid;
}

// ============ 5. 图片获取（引用消息 → ob11 → 图片 URL） ============
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

// ============ 6. 控制器协议调用 ============
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

// 开局：调用 /api/init，把返回的三把秘钥存入插件存储（不展示）
async function startMatchAsync(ctx, msg) {
  const base = getCfg('controllerUrl').replace(/\/+$/, '');
  if (!base) {
    seal.replyToSender(ctx, msg, '未配置 controllerUrl（插件设置）');
    return;
  }
  seal.replyToSender(ctx, msg, '正在开局，请稍候…');
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
      seal.replyToSender(ctx, msg, '开局失败：' + message + '（若提示请先导入歌曲库，需由后端运行人先 POST /api/songs）');
      return;
    }
    const t = body.tokens || {};
    if (t.match && t.defender && t.attacker) {
      ext.storageSet(K_MATCH, String(t.match));
      ext.storageSet(K_DEF, String(t.defender));
      ext.storageSet(K_ATK, String(t.attacker));
      seal.replyToSender(ctx, msg, '比赛已开始，秘钥已记录（不对外展示）。现在可以引用截图发送「上传成绩」了。');
      // 开局后也截一张控制器网页图（等待几秒让页面更新）
      await takeBoardScreenshot(ctx, msg, '控制器截图失败，请检查 screenshotUrl 与 web-read 后端');
    } else {
      seal.replyToSender(ctx, msg, '开局成功但响应缺少 tokens，请确认控制器已包含成绩上传协议（/api/v1）');
    }
  } catch (e) {
    seal.replyToSender(ctx, msg, '开局失败（网络/接口）：' + (e && e.message ? e.message : e));
  }
}

// 结束比赛：调用 /api/end，并清空本群待审成绩
async function stopMatchAsync(ctx, msg) {
  const base = getCfg('controllerUrl').replace(/\/+$/, '');
  if (!base) {
    seal.replyToSender(ctx, msg, '未配置 controllerUrl（插件设置）');
    return;
  }
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
    const gid = String(msg.groupId || 'private:' + msg.sender.userId);
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
    seal.replyToSender(ctx, msg, '比赛已结束，待审成绩已清空');
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
    return;
  }
  const body = res.body;
  if (res.status >= 400 || !body || !body.ok) {
    const code = body && body.code ? body.code : 'HTTP ' + res.status;
    const message = body && body.message ? body.message : '接口错误';
    seal.replyToSender(ctx, msg, '成绩上传被拒绝：' + code + ' ' + message);
    return;
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
}

// 群管理审核：引用确认消息回复 确认 / 修改 分数 TP / 拒绝
async function handleReview(ctx, msg, rest) {
  if (!isAdmin(ctx)) {
    seal.replyToSender(ctx, msg, '仅群管理以上可审核成绩');
    return;
  }
  cleanupPending(Date.now());
  const gid = String(msg.groupId || 'private:' + msg.sender.userId);
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
    delete pendings[pkey];
    savePending(pendings);
    await finalizeUpload(ctx, msg, pending.payload, pending.player, pending.songName);
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
    delete pendings[pkey];
    savePending(pendings);
    if (applied.length > 0) {
      seal.replyToSender(ctx, msg, '已修改：' + applied.join('，') + '，正在上传…');
    }
    await finalizeUpload(ctx, msg, payload, pending.player, pending.songName);
    return;
  }
  seal.replyToSender(ctx, msg, '未识别的审核指令：请回复「确认」「修改 分数 TP」「拒绝」');
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
  return { key: 'group:' + String(msg.groupId || 'private:' + msg.sender.userId), sent: false };
}

async function bindAsync(ctx, msg, team) {
  const userId = String(msg.sender.userId);
  const name = await fetchNickname(ctx, msg);
  const p = bindPlayer(userId, team, name);
  seal.replyToSender(ctx, msg, '已绑定：' + p.name + '（' + teamName(team) + '）');
}

// ============ 7. 结果返回（aiplugin4-backends web-read MCP） ============
// 对控制器网页本身截图；通过 MCP /mcp 的 screenshot_url 工具调用，失败时回退纯文本
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
async function mcpScreenshot(base, ctrlBase, token) {
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
        clientInfo: { name: 'triangle-score-plugin', version: '1.0.0' }
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
        arguments: { url: ctrlBase, width: 1680, height: 1000, fullPage: false, delay: 4500 }
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

async function takeBoardScreenshot(ctx, msg, fallbackText) {
  const base = getCfg('screenshotUrl').replace(/\/+$/, '');
  const ctrlBase = getCfg('controllerUrl').replace(/\/+$/, '');
  if (!base) return false;
  const token = getCfg('screenshotToken');
  let b64 = null;
  try {
    b64 = await mcpScreenshot(base, ctrlBase, token);
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

// ============ 8. 核心上传流程 ============
async function handleUpload(ctx, msg, replyId) {
  const players = loadPlayers();
  const player = players[String(msg.sender.userId)];
  if (!player) {
    seal.replyToSender(ctx, msg, '尚未绑定阵营，请先发送：.ts bind attacker 或 .ts bind defender');
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

  const recApi = globalThis.imageRecognizerAPI;
  if (!recApi || typeof recApi.recognize !== 'function') {
    seal.replyToSender(ctx, msg, '未找到 image-recognizer 识图接口（globalThis.imageRecognizerAPI），请确认已加载该插件');
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
  const gid = String(msg.groupId || 'private:' + msg.sender.userId);
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

// ============ 9. 指令 .ts ============
const cmd = seal.ext.newCmdItemInfo();
cmd.name = 'ts';
cmd.help = [
  '.ts help                    查看帮助',
  '.ts status                  查看配置与依赖状态',
  '.ts start                   开局并自动记录秘钥（仅群管理以上）',
  '.ts stop                    结束比赛（仅群管理以上）',
  '.ts bind <attacker|defender>   绑定本人阵营（昵称自动读取 QQ 昵称）',
  '.ts unbind                  解除本人绑定',
  '.ts me                      查看本人绑定',
  '.ts list                    查看已绑定选手',
  '.ts board                   查看控制器当前比分/占领情况',
  '.ts tasks                   查看本局 21 个任务格的歌曲列表',
  '.ts shot                    截取控制器网页当前画面',
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
  '说明：.ts start / .ts stop 需要群管理以上权限；审核确认同样仅限群管理。'
].join('\n');
cmd.allowDelegate = false;
cmd.disabledInPrivate = false;

cmd.solve = function (ctx, msg, cmdArgs) {
  const ret = seal.ext.newCmdExecuteResult(true);
  const sub = cmdArgs.getArgN(1);
  const userId = String(msg.sender.userId);

  if (sub === 'help' || sub === undefined || sub === '') {
    ret.showHelp = true;
    return ret;
  }

  if (sub === 'status') {
    const baseLines = [
      '控制器：' + (getCfg('controllerUrl') ? '已配置' : '未配置'),
      '截图后端：' + (getCfg('screenshotUrl') ? '已配置' : '未配置'),
      '识图接口：' + (globalThis.imageRecognizerAPI ? '可用 v' + (globalThis.imageRecognizerAPI.version || '?') : '缺失（需安装 image-recognizer）'),
      'ob11 依赖：' + (getNet() ? '可用' : '缺失'),
      '已绑定选手：' + Object.keys(loadPlayers()).length + ' 人',
      '待审核成绩：' + Object.keys(loadPending()).length + ' 条'
    ];
    const base = getCfg('controllerUrl').replace(/\/+$/, '');
    const reply = function (stateLine) {
      seal.replyToSender(ctx, msg, stateLine + '\n' + baseLines.join('\n'));
    };
    if (!base || !getStoredToken(K_MATCH)) {
      reply('比赛状态：未开局（发送 .ts start 开局）');
      return ret;
    }
    fetch(base + '/api/state').then(function (resp) {
      return resp.json();
    }).then(function (s) {
      if (!s || !s.started) {
        reply('比赛状态：未开局（发送 .ts start 开局）');
        return;
      }
      if (s.game_over) {
        let winner = '已结束';
        if (s.winner === 'attacker') winner = '已结束（掠夺者获胜）';
        else if (s.winner === 'defender') winner = '已结束（守护者获胜）';
        else if (s.winner === 'draw' || s.win_type === 'draw') winner = '已结束（平局）';
        reply('比赛状态：' + winner);
        return;
      }
      reply('比赛状态：进行中（已用时 ' + Math.floor(s.elapsed || 0) + ' / ' + (s.time_limit != null ? s.time_limit : '?') + ' 分钟）');
    }).catch(function (e) {
      reply('比赛状态：未知（控制器不可达）');
    });
    return ret;
  }

  if (sub === 'start') {
    if (!isAdmin(ctx)) {
      seal.replyToSender(ctx, msg, '仅群管理以上可开始比赛');
      return ret;
    }
    startMatchAsync(ctx, msg);
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

  if (sub === 'bind') {
    const teamArg = String(cmdArgs.getArgN(2) || '').toLowerCase();
    let team = null;
    if (teamArg === 'attacker' || teamArg === '掠夺者' || teamArg === '红') team = 'attacker';
    if (teamArg === 'defender' || teamArg === '守护者' || teamArg === '蓝') team = 'defender';
    if (!team) {
      seal.replyToSender(ctx, msg, '用法：.ts bind <attacker|defender>（attacker=掠夺者/红方，defender=守护者/蓝方）');
      return ret;
    }
    bindAsync(ctx, msg, team);
    return ret;
  }

  if (sub === 'unbind') {
    const existed = unbindPlayer(userId);
    seal.replyToSender(ctx, msg, existed ? '已解除绑定' : '你尚未绑定');
    return ret;
  }

  if (sub === 'me') {
    const p = loadPlayers()[userId];
    seal.replyToSender(ctx, msg, p ? '选手：' + p.name + '（' + teamName(p.team) + '）' : '尚未绑定，请先 .ts bind <attacker|defender>');
    return ret;
  }

  if (sub === 'list') {
    const players = loadPlayers();
    const keys = Object.keys(players);
    if (keys.length === 0) {
      seal.replyToSender(ctx, msg, '暂无绑定选手');
      return ret;
    }
    const lines = keys.map(function (k) {
      const p = players[k];
      return p.name + '（' + teamName(p.team) + '）';
    });
    seal.replyToSender(ctx, msg, '已绑定选手（' + keys.length + '）：\n' + lines.join('\n'));
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

// ============ 10. 事件钩子 ============
ext.onLoad = function () {
  console.log('[' + ext.name + '] v' + ext.version + ' 已加载');
};

// 引用截图 + 触发文本（[CQ:reply] 前缀的消息不视为指令，走非指令钩子）
ext.onNotCommandReceived = function (ctx, msg) {
  const parsed = parseReplyPrefix(msg.message || '');
  if (!parsed) return;
  const rest = String(parsed.rest || '').trim();
  // 群管理审核：引用确认消息回复 确认 / 修改 / 拒绝
  if (/^(确认|修改|拒绝)/.test(rest)) {
    handleReview(ctx, msg, rest);
    return;
  }
  const regex = getTriggerRegex();
  if (!regex || !regex.test(rest)) return;
  handleUpload(ctx, msg, parsed.replyId);
};

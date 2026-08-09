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
  format: (ctx, t) => t,
  getCtxProxyFirst: (ctx) => ctx
};
global.fetch = function (url, opts) {
  calls.push({ url: String(url), opts: opts || {} });
  const u = String(url);
  if (u.includes('/api/init')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, tokens: { match: 'M', defender: 'D', attacker: 'A' }, state: {} }) });
  if (u.includes('/api/end')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  if (u.includes('/api/v1/results')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, code: 'RESULT_PROCESSED', outcome: 'occupied', data: { scores: { defender: 1, attacker: 2 }, event: 'occupy' } }) });
  if (u.includes('/screenshot')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'success', base64: 'QUJD' }) });
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

require(path);
const ext = exts['triangle_score_plugin'];
const results = [];
function check(name, cond, detail) { results.push(cond); console.log((cond ? 'PASS' : 'FAIL'), name, detail || ''); }
function ctx(priv) { return { player: { name: 'x' }, endPoint: { userId: 'QQ:123' }, privilegeLevel: priv, isPrivate: false }; }
function msg(text, uid, nick) { return { sender: { userId: uid || 'QQ:1001', nickname: nick || '阿晴' }, message: text, messageType: 'group', groupId: 'QQ-Group:1051905353' }; }
function args() { const a = Array.prototype.slice.call(arguments); return { getArgN: (n) => a[n - 1] }; }

replies.length = 0;
ext.cmdMap['ts'].solve(ctx(0), msg('.ts start'), args('start'));
check('non-admin start denied', replies[0] === '仅群管理以上可开始比赛', replies[0]);

replies.length = 0;
ext.cmdMap['ts'].solve(ctx(50), msg('.ts start'), args('start'));
setTimeout(() => {
  check('admin start ok', !!replies.find(r => r.includes('比赛已开始')), replies.join(' | '));
  check('start stores keys', ext.storageGet('ts_match_token') === 'M', '');

  replies.length = 0; calls.length = 0;
  ext.storageSet('players', JSON.stringify({ 'QQ:1001': { id: 'QQ:1001', name: '阿晴', team: 'attacker' } }));
  ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=1]上传成绩'));
  setTimeout(() => {
    const pending = JSON.parse(ext.storageGet('ts_pending'));
    const pkey = Object.keys(pending)[0];
    check('confirmation keyed by message_id 555', pkey === '555', pkey);
    check('confirmation text sent', !!netMessages.find(t => t.includes('成绩待确认') && t.includes('修改')), netMessages[0] ? netMessages[0].slice(0, 40) : 'none');
    check('no direct upload yet', !calls.find(c => c.url.includes('/api/v1/results')), '');

    replies.length = 0;
    ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=555]确认'));
    check('non-admin review denied', replies[0] === '仅群管理以上可审核成绩', replies[0]);
    check('pending still there', !!JSON.parse(ext.storageGet('ts_pending'))['555'], '');

    replies.length = 0; calls.length = 0;
    ext.onNotCommandReceived(ctx(60), msg('[CQ:reply,id=555]修改 score 991420 tp 95.5 miss 0 bad 0 good 1'));
    setTimeout(() => {
      const up = calls.find(c => c.url.includes('/api/v1/results'));
      const res = up ? JSON.parse(up.opts.body).result : null;
      check('modified payload submitted', !!up && res.score === 991420 && res.tp === 95.5 && res.good === 1, res ? JSON.stringify(res) : 'none');
      check('pending cleared after review', !JSON.parse(ext.storageGet('ts_pending'))['555'], '');
      check('result + screenshot sent', !!replies.find(r => r.includes('成绩上报完成')) && !!replies.find(r => r.startsWith('[CQ:image,file=base64://')), '');

      replies.length = 0; calls.length = 0;
      ext.onNotCommandReceived(ctx(0), msg('[CQ:reply,id=2]上传成绩'));
      setTimeout(() => {
        const pending2 = JSON.parse(ext.storageGet('ts_pending'));
        const k2 = Object.keys(pending2).find(k => k !== '555');
        check('second pending created with new message_id 556', k2 === '556', k2 || Object.keys(pending2).join(','));
        replies.length = 0;
        ext.onNotCommandReceived(ctx(50), msg('[CQ:reply,id=' + k2 + ']拒绝'));
        check('reject clears pending', !JSON.parse(ext.storageGet('ts_pending'))[k2], '');
        check('no upload on reject', !calls.find(c => c.url.includes('/api/v1/results')), '');

        replies.length = 0; calls.length = 0;
        ext.cmdMap['ts'].solve(ctx(0), msg('.ts stop'), args('stop'));
        check('non-admin stop denied', replies[0] === '仅群管理以上可结束比赛', replies[0]);
        ext.cmdMap['ts'].solve(ctx(60), msg('.ts stop'), args('stop'));
        setTimeout(() => {
          check('admin stop calls /api/end', !!calls.find(c => c.url.includes('/api/end')), '');
          check('stop reply', !!replies.find(r => r.includes('比赛已结束')), replies.join(' | '));
          const passed = results.filter(Boolean).length;
          console.log('\n' + passed + '/' + results.length + ' passed');
          process.exit(passed === results.length ? 0 : 1);
        }, 80);
      }, 80);
    }, 80);
  }, 80);
}, 80);

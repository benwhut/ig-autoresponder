/**
 * Self-contained admin UI. No CDNs, no external fonts, no build step:
 * one HTML document with inline CSS and vanilla JS.
 */

const BASE_CSS = `
:root{
  --bg:#f5f6f8;--panel:#ffffff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;
  --accent:#4f46e5;--accent-dark:#4338ca;--accent-soft:#eef2ff;
  --ok:#047857;--ok-soft:#d1fae5;--warn:#b45309;--warn-soft:#fef3c7;
  --bad:#b91c1c;--bad-soft:#fee2e2;--info:#1d4ed8;--info-soft:#dbeafe;
  --radius:14px;--shadow:0 1px 2px rgba(15,23,42,.05),0 12px 32px -20px rgba(15,23,42,.35);
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.02em}
h2{font-size:18px;margin:0;letter-spacing:-.01em}
h3{font-size:15px;margin:0}
p{margin:0}
.muted{color:var(--muted)}
.small{font-size:12.5px}
.hint{color:var(--muted);font-size:12.5px;margin-top:6px}
.wrap{max-width:1180px;margin:0 auto;padding:26px 20px 80px}
.btn{
  appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);
  padding:8px 14px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s,opacity .15s;
}
.btn:hover{background:#f8fafc;text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-dark);border-color:var(--accent-dark)}
.btn.ghost{background:transparent}
.btn.danger{color:var(--bad);border-color:#fecaca}
.btn.danger:hover{background:var(--bad-soft)}
.btn.tiny{padding:5px 9px;font-size:12px;border-radius:8px}
.btn:disabled{opacity:.55;cursor:not-allowed}
.pill{
  display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;
  font-size:11.5px;font-weight:700;letter-spacing:.01em;background:#f1f5f9;color:var(--muted);
  white-space:nowrap;
}
.pill.ok{background:var(--ok-soft);color:var(--ok)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.bad{background:var(--bad-soft);color:var(--bad)}
.pill.info{background:var(--info-soft);color:var(--info)}
.pill.muted{background:#f1f5f9;color:var(--muted)}
.pill.tiny-pill{padding:1px 7px;font-size:10.5px;background:var(--ok-soft);color:var(--ok)}
.dot{width:9px;height:9px;border-radius:50%;background:#cbd5e1;flex:0 0 auto}
.dot.ok{background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.18)}
.dot.off{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18)}
input,textarea,select{
  font:inherit;color:inherit;background:#fff;border:1px solid var(--line);border-radius:10px;
  padding:9px 11px;width:100%;outline:none;transition:border-color .15s,box-shadow .15s;
}
input:focus,textarea:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(79,70,229,.12)}
textarea{resize:vertical;min-height:70px;line-height:1.5}
label{font-weight:600}
.field{display:flex;flex-direction:column;gap:7px;margin-bottom:18px}
.field:last-child{margin-bottom:0}
.field-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.field.inline{flex-direction:row;align-items:center}
.label{font-weight:600}
.counter{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.counter.over{color:var(--bad);font-weight:700}
.check{display:inline-flex;align-items:center;gap:8px;font-weight:500;cursor:pointer}
.check input{width:16px;height:16px;accent-color:var(--accent)}
.grid.two{display:grid;grid-template-columns:1fr 140px;gap:14px}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.seg.stack{grid-template-columns:1fr}
.seg-opt{position:relative;display:block;cursor:pointer}
.seg-opt input{position:absolute;opacity:0;width:0;height:0}
.seg-opt > span{
  display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1.5px solid var(--line);
  border-radius:12px;background:#fff;height:100%;transition:border-color .15s,background .15s;
}
.seg-opt small{color:var(--muted);font-weight:400;font-size:12.5px;line-height:1.4}
.seg-opt input:checked + span{border-color:var(--accent);background:var(--accent-soft)}
.seg-opt input:focus-visible + span{box-shadow:0 0 0 3px rgba(79,70,229,.18)}
.chips{display:flex;flex-wrap:wrap;gap:6px;min-height:0}
.chip{
  display:inline-flex;align-items:center;gap:6px;background:#eef2ff;color:#3730a3;
  border-radius:8px;padding:3px 8px;font-size:12px;font-weight:600;max-width:100%;
}
.chip.static{background:#f1f5f9;color:#475569}
.chip button{border:0;background:none;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0;opacity:.7}
.chip button:hover{opacity:1}
.chip-input{border:1px solid var(--line);border-radius:10px;background:#fff;padding:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip-input:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.chip-input input{border:0;box-shadow:none;padding:4px 6px;flex:1;min-width:140px;background:transparent}
.chip-input input:focus{box-shadow:none}
`;

const LOGIN_CSS = `
body{display:grid;place-items:center;min-height:100vh;background:
  radial-gradient(900px 500px at 15% 0%,#e0e7ff 0%,rgba(224,231,255,0) 60%),
  radial-gradient(800px 500px at 100% 100%,#fce7f3 0%,rgba(252,231,243,0) 55%),var(--bg);padding:24px}
.login-card{width:100%;max-width:390px;background:#fff;border:1px solid var(--line);border-radius:20px;
  box-shadow:var(--shadow);padding:34px 30px 26px}
.login-brand{display:flex;align-items:center;gap:11px;margin-bottom:22px}
.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;color:#fff;
  font-size:17px;background:linear-gradient(135deg,#4f46e5,#db2777);box-shadow:0 6px 16px -8px rgba(79,70,229,.8)}
.login-card h1{font-size:21px}
.login-card form{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.login-card label{font-size:12.5px;color:var(--muted);font-weight:600}
.login-card .btn{width:100%;margin-top:6px;padding:11px}
.login-foot{margin-top:18px;font-size:12px;color:var(--muted);text-align:center}
.alert{border-radius:10px;padding:10px 12px;font-size:13px;font-weight:600;margin-top:16px}
.alert.bad{background:var(--bad-soft);color:var(--bad)}
`;

const DASH_CSS = `
.topbar{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.94);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:1180px;margin:0 auto;padding:11px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.01em}
.logo{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:#fff;
  font-size:15px;background:linear-gradient(135deg,#4f46e5,#db2777)}
.conn{display:flex;align-items:center;gap:9px;margin-left:auto;flex-wrap:wrap}
.conn-text{display:flex;flex-direction:column;line-height:1.2;margin-right:2px}
.conn-text strong{font-size:13px}
.conn-text span{font-size:11.5px;color:var(--muted)}
.tabs{max-width:1180px;margin:0 auto;padding:0 20px;display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto}
.tab{appearance:none;border:0;background:none;padding:13px 14px 11px;font:inherit;font-weight:600;
  color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.tab:hover{color:var(--ink)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-panel{display:none}
.tab-panel.active{display:block;animation:fade .18s ease}
@keyframes fade{from{opacity:.4}to{opacity:1}}
.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:4px 0 20px;flex-wrap:wrap}
.section-head p{max-width:620px;margin-top:4px}
.rules-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.rule-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:12px;transition:opacity .2s}
.rule-card.is-off{opacity:.62}
.rule-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.rule-title h3{font-size:16px;letter-spacing:-.01em;word-break:break-word}
.rule-sub{color:var(--muted);font-size:12.5px;margin-top:3px}
.rule-chips{display:flex;flex-wrap:wrap;gap:6px}
.rule-meta{display:flex;flex-wrap:wrap;gap:6px}
.rule-actions{display:flex;gap:7px;margin-top:auto;padding-top:4px}
.switch{position:relative;display:inline-block;width:40px;height:22px;flex:0 0 auto;margin-top:2px}
.switch input{position:absolute;opacity:0;width:0;height:0}
.switch span{position:absolute;inset:0;background:#cbd5e1;border-radius:999px;transition:.18s;cursor:pointer}
.switch span:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;
  border-radius:50%;transition:.18s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.switch input:checked + span{background:var(--accent)}
.switch input:checked + span:before{transform:translateX(18px)}
.switch input:focus-visible + span{box-shadow:0 0 0 3px rgba(79,70,229,.25)}
.posts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.post-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  box-shadow:var(--shadow);display:flex;flex-direction:column}
.thumb{background:#e2e8f0;position:relative;overflow:hidden;display:grid;place-items:center}
.thumb.lg{aspect-ratio:1/1;width:100%}
.thumb.sm{width:42px;height:42px;border-radius:8px;flex:0 0 auto}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb.placeholder{background:linear-gradient(135deg,#e0e7ff,#fce7f3)}
.thumb.placeholder span{font-size:11px;font-weight:800;color:#4f46e5;text-transform:uppercase;letter-spacing:.08em}
.thumb.sm.placeholder span{font-size:9px}
.post-body{padding:12px 13px 13px;display:flex;flex-direction:column;gap:9px;flex:1}
.post-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.post-caption{font-size:12.5px;color:#334155;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;
  -webkit-box-orient:vertical;overflow:hidden;min-height:18px;word-break:break-word}
.post-actions{display:flex;gap:6px;margin-top:auto;flex-wrap:wrap}
.filters{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.filters input[type=search]{max-width:320px}
.filters select{width:auto;min-width:160px}
.filters .check{font-size:13px;white-space:nowrap}
.table-wrap{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);overflow-x:auto}
table.logs{width:100%;border-collapse:collapse;font-size:12.5px;min-width:880px}
table.logs th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  padding:11px 12px;border-bottom:1px solid var(--line);background:#fafbfc;white-space:nowrap}
table.logs td{padding:11px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
table.logs tr:last-child td{border-bottom:0}
table.logs tr:hover td{background:#fafbff}
.comment-cell{max-width:250px;word-break:break-word}
.error-cell{max-width:200px;color:var(--bad);word-break:break-word}
.nowrap{white-space:nowrap}
.empty-cell{text-align:center;color:var(--muted);padding:34px 12px !important}
.empty{background:var(--panel);border:1.5px dashed #cbd5e1;border-radius:var(--radius);padding:44px 24px;
  text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}
.empty.wide{grid-column:1/-1}
.empty-icon{width:44px;height:44px;border-radius:13px;background:var(--accent-soft);color:var(--accent);
  display:grid;place-items:center;font-size:20px;margin-bottom:4px}
.empty h3{font-size:15px}
.empty p{color:var(--muted);max-width:380px;margin-bottom:8px}
.modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 14px;border-bottom:1px solid var(--line)}
.modal-head p{margin-top:3px}
.modal-body{padding:18px 22px 4px;overflow-y:auto}
.modal-foot{display:flex;justify-content:flex-end;gap:9px;padding:14px 22px 18px;border-top:1px solid var(--line);
  position:sticky;bottom:0;background:#fff}
.icon-btn{appearance:none;border:0;background:#f1f5f9;color:var(--muted);width:30px;height:30px;border-radius:8px;
  cursor:pointer;font-size:14px;display:grid;place-items:center;flex:0 0 auto}
.icon-btn:hover{background:#e2e8f0;color:var(--ink)}
.overlay{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.5);display:none;
  align-items:flex-start;justify-content:center;padding:26px 16px;overflow-y:auto}
#modal-root.open .overlay{display:flex}
.modal{background:#fff;border-radius:18px;width:100%;max-width:660px;box-shadow:0 30px 70px -20px rgba(15,23,42,.55);
  display:flex;flex-direction:column;max-height:calc(100vh - 52px);animation:pop .16s ease}
@keyframes pop{from{transform:translateY(8px);opacity:.6}to{transform:none;opacity:1}}
body.no-scroll{overflow:hidden}
.media-picker-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.media-picker-tools input[type=search]{flex:1;min-width:150px}
.add-media{display:flex;gap:6px;flex:1;min-width:200px}
.add-media input{flex:1}
.media-picker{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;
  max-height:250px;overflow-y:auto;padding:2px;margin-top:10px}
.media-opt{display:flex;align-items:center;gap:9px;border:1.5px solid var(--line);border-radius:10px;
  padding:7px;cursor:pointer;background:#fff;transition:border-color .15s,background .15s}
.media-opt:hover{border-color:#c7d2fe}
.media-opt.selected{border-color:var(--accent);background:var(--accent-soft)}
.media-opt input{width:15px;height:15px;flex:0 0 auto;accent-color:var(--accent)}
.media-opt-meta{display:flex;flex-direction:column;min-width:0;line-height:1.3}
.media-opt-meta strong{font-size:10.5px;letter-spacing:.05em;color:var(--muted)}
.media-opt-meta span{font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155}
.reply-list{display:flex;flex-direction:column;gap:7px}
.reply-row{display:flex;gap:7px;align-items:flex-start}
.reply-row textarea{min-height:44px}
.toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);z-index:200;opacity:0;pointer-events:none;
  background:#0f172a;color:#fff;padding:10px 16px;border-radius:11px;font-weight:600;font-size:13px;
  box-shadow:0 16px 40px -12px rgba(15,23,42,.6);transition:opacity .2s,transform .2s;max-width:calc(100vw - 40px)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.toast.bad{background:#991b1b}
.toast.ok{background:#065f46}
@media (max-width:720px){
  .wrap{padding:20px 14px 70px}
  .topbar-inner{padding:10px 14px;gap:9px}
  .conn{width:100%;margin-left:0;justify-content:space-between}
  .conn-text{flex:1}
  .rules-list{grid-template-columns:1fr}
  .grid.two{grid-template-columns:1fr}
  .seg{grid-template-columns:1fr}
  .section-head{align-items:flex-start}
  .filters input[type=search]{max-width:none;flex:1;min-width:180px}
}
`;

export function loginPage(options: { error?: boolean } = {}): string {
  const errorHtml = options.error
    ? '<div class="alert bad">Incorrect password. Try again.</div>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in · Comment → DM</title>
<style>${BASE_CSS}${LOGIN_CSS}</style>
</head>
<body>
<main class="login-card">
  <div class="login-brand">
    <span class="logo">◆</span>
    <div>
      <h1>Comment → DM</h1>
      <p class="muted small">Instagram comment autoresponder</p>
    </div>
  </div>
  ${errorHtml}
  <form method="post" action="/admin/login">
    <label for="password">Admin password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="btn primary" type="submit">Sign in</button>
  </form>
  <p class="login-foot">Protected area · sessions last 7 days</p>
</main>
</body>
</html>`;
}

export function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Comment → DM · Admin</title>
<style>${BASE_CSS}${DASH_CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand"><span class="logo">◆</span><span>Comment → DM</span></div>
    <div class="conn">
      <span class="dot" id="conn-dot"></span>
      <div class="conn-text">
        <strong id="conn-name">Loading…</strong>
        <span id="conn-id"></span>
      </div>
      <span class="pill" id="token-label">—</span>
      <button class="btn tiny" id="btn-refresh-token" title="Ask Meta for a fresh 60-day token">Refresh token</button>
      <button class="btn tiny" id="btn-rotate-token">Set token</button>
      <button class="btn tiny ghost" id="btn-logout">Sign out</button>
    </div>
  </div>
</header>

<nav class="tabs" role="tablist">
  <button class="tab active" data-tab="rules" role="tab" aria-selected="true">Rules</button>
  <button class="tab" data-tab="posts" role="tab" aria-selected="false">Posts</button>
  <button class="tab" data-tab="activity" role="tab" aria-selected="false">Activity</button>
</nav>

<main class="wrap">
  <section id="tab-rules" class="tab-panel active">
    <div class="section-head">
      <div>
        <h1>Automation rules</h1>
        <p class="muted">Match a comment, send a private reply, then deliver the link once the user opts in.</p>
      </div>
      <button class="btn primary" id="btn-new-rule">New rule</button>
    </div>
    <div id="rules-list" class="rules-list"></div>
  </section>

  <section id="tab-posts" class="tab-panel">
    <div class="section-head">
      <div>
        <h1>Recent posts</h1>
        <p class="muted">Sync the latest 25 posts and reels, then target rules at specific media without copying raw IDs.</p>
      </div>
      <button class="btn primary" id="btn-sync-posts">Sync recent posts</button>
    </div>
    <div id="posts-grid" class="posts-grid"></div>
  </section>

  <section id="tab-activity" class="tab-panel">
    <div class="section-head">
      <div>
        <h1>Activity</h1>
        <p class="muted">Every comment the webhook has seen, the matched rule, delivery state and Meta errors.</p>
      </div>
      <button class="btn" id="btn-refresh-logs">Refresh</button>
    </div>
    <div class="filters">
      <input id="log-search" type="search" placeholder="Search comment, username or ID…">
      <select id="log-state">
        <option value="">All states</option>
        <option value="awaiting_opt_in">Awaiting opt-in</option>
        <option value="completed">Completed</option>
        <option value="matched_queued">Queued</option>
        <option value="private_reply_sent">DM sent</option>
        <option value="failed">Failed</option>
        <option value="ignored">Ignored</option>
      </select>
      <label class="check"><input type="checkbox" id="log-ignored"> Show ignored</label>
    </div>
    <div class="table-wrap">
      <table class="logs">
        <thead>
          <tr>
            <th>When</th><th>Commenter</th><th>Comment</th><th>Rule</th>
            <th>State</th><th>Public reply</th><th>Error</th><th></th>
          </tr>
        </thead>
        <tbody id="logs-body"></tbody>
      </table>
    </div>
  </section>
</main>

<div id="modal-root"></div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script>
(function () {
  'use strict';

  var state = {
    account: null,
    token: null,
    stats: {},
    queue: {},
    rules: [],
    media: [],
    logs: [],
    tab: 'rules',
    filters: { state: '', q: '', include_ignored: false }
  };
  var draft = null;
  var toastTimer = null;
  var logTimer = null;

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function safeUrl(value) {
    var text = String(value || '');
    var lower = text.toLowerCase();
    return lower.indexOf('https://') === 0 || lower.indexOf('http://') === 0 ? text : '';
  }
  function parseDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }  function fmtDate(iso) {
    var d = parseDate(iso);
    if (!d) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function timeAgo(iso) {
    var d = parseDate(iso);
    if (!d) return '—';
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    var days = Math.round(h / 24);
    if (days < 30) return days + 'd ago';
    return fmtDate(iso);
  }
  function shortText(text, max) {
    var value = String(text == null ? '' : text).replace(/\\s+/g, ' ').trim();
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  }
  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function api(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' }
    };
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(function (response) {
      if (response.status === 401) {
        window.location.href = '/admin';
        throw new Error('Session expired');
      }
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || ('Request failed (' + response.status + ')'));
        return data;
      });
    });
  }

  function toast(message, kind) {
    var el = $('#toast');
    el.textContent = message;
    el.className = 'toast show ' + (kind || 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3600);
  }

  /* ---------------------------------------------------------------- */
  /* Data loading                                                      */
  /* ---------------------------------------------------------------- */

  function loadState() {
    return api('/admin/api/state').then(function (data) {
      state.account = data.account || null;
      state.token = data.token || {};
      state.stats = data.stats || {};
      state.queue = data.queue || {};
      renderHeader();
    }).catch(function (error) { toast(error.message, 'bad'); });
  }

  function loadRules() {
    return api('/admin/api/rules').then(function (data) {
      state.rules = data.rules || [];
      renderRules();
    }).catch(function (error) { toast(error.message, 'bad'); });
  }

  function loadMedia() {
    return api('/admin/api/media').then(function (data) {
      state.media = data.media || [];
      renderPosts();
    }).catch(function (error) { toast(error.message, 'bad'); });
  }

  function loadLogs() {
    var params = [];
    if (state.filters.state) params.push('state=' + encodeURIComponent(state.filters.state));
    if (state.filters.q) params.push('q=' + encodeURIComponent(state.filters.q));
    if (state.filters.include_ignored) params.push('include_ignored=1');
    params.push('limit=150');
    return api('/admin/api/logs?' + params.join('&')).then(function (data) {
      state.logs = data.logs || [];
      renderLogs();
    }).catch(function (error) { toast(error.message, 'bad'); });
  }

  function loadAll() {
    loadState();
    loadRules();
    loadMedia();
    loadLogs();
  }

  /* ---------------------------------------------------------------- */
  /* Header                                                            */
  /* ---------------------------------------------------------------- */

  function renderHeader() {
    var account = state.account;
    var token = state.token || {};
    var dot = $('#conn-dot');

    if (account) {
      $('#conn-name').textContent = '@' + account.username;
      $('#conn-id').textContent = 'ID ' + account.user_id;
      dot.className = 'dot ok';
    } else {
      $('#conn-name').textContent = 'Not connected';
      $('#conn-id').textContent = 'Add a long-lived Instagram token to start';
      dot.className = 'dot off';
    }

    var label = $('#token-label');
    var text = 'No token';
    var kind = 'bad';
    if (token.state === 'ok') {
      text = 'Expires in ' + Math.max(0, Math.floor(token.days_left || 0)) + 'd';
      kind = 'ok';
    } else if (token.state === 'expiring') {
      text = 'Expires in ' + Math.max(0, Math.floor(token.days_left || 0)) + 'd';
      kind = 'warn';
    } else if (token.state === 'expired') {
      text = 'Token expired';
      kind = 'bad';
    }
    label.textContent = text;
    label.className = 'pill ' + kind;
    if (token.expires_at) label.title = 'Expires ' + fmtDate(token.expires_at);
  }

  /* ---------------------------------------------------------------- */
  /* Tabs                                                              */
  /* ---------------------------------------------------------------- */

  function setTab(name) {
    state.tab = name;
    $all('.tab').forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $all('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'tab-' + name);
    });
    if (name === 'activity') loadLogs();
    if (name === 'posts') loadMedia();
  }

  /* ---------------------------------------------------------------- */
  /* Rules                                                             */
  /* ---------------------------------------------------------------- */

  function targetSummary(rule) {
    if (rule.target_mode === 'all_posts') return 'All posts';
    var count = rule.media_ids.length;
    return count === 1 ? '1 selected post' : count + ' selected posts';
  }

  function matchSummary(rule) {
    if (rule.match_mode === 'any_comment') return 'Any comment';
    return rule.keywords.length + (rule.keywords.length === 1 ? ' keyword' : ' keywords');
  }

  function renderRules() {
    var wrap = $('#rules-list');
    if (!state.rules.length) {
      wrap.innerHTML = ''
        + '<div class="empty wide">'
        + '<div class="empty-icon">⚡</div>'
        + '<h3>No rules yet</h3>'
        + '<p>Create a rule to watch comments and send a DM automatically. Start with a keyword like “link” on all posts.</p>'
        + '<button class="btn primary" data-action="new">Create your first rule</button>'
        + '</div>';
      return;
    }

    wrap.innerHTML = state.rules.map(function (rule) {
      var keywordChips = rule.match_mode === 'any_comment'
        ? '<span class="chip static">Any comment</span>'
        : rule.keywords.map(function (keyword) {
            return '<span class="chip static">' + esc(keyword) + '</span>';
          }).join('');

      var publicCount = rule.public_replies.length;
      var optIn = rule.opt_in_keywords.length
        ? '<span class="pill muted">Opt-in: ' + esc(rule.opt_in_keywords.join(', ')) + '</span>'
        : '<span class="pill muted">Any reply opts in</span>';

      return ''
        + '<article class="rule-card' + (rule.enabled ? '' : ' is-off') + '" data-id="' + esc(rule.id) + '">'
        + '<div class="rule-top">'
        + '<div class="rule-title">'
        + '<h3>' + esc(rule.name) + '</h3>'
        + '<div class="rule-sub">' + esc(targetSummary(rule)) + ' · ' + esc(matchSummary(rule)) + ' · priority ' + esc(rule.priority) + '</div>'
        + '</div>'
        + '<label class="switch" title="Enable or pause this rule">'
        + '<input type="checkbox" data-action="toggle" ' + (rule.enabled ? 'checked' : '') + '>'
        + '<span></span></label>'
        + '</div>'
        + '<div class="rule-chips">' + keywordChips + '</div>'
        + '<div class="rule-meta">'
        + '<span class="pill ' + (rule.delivery_mode === 'two_step_opt_in' ? 'info' : 'ok') + '">'
        + (rule.delivery_mode === 'two_step_opt_in' ? 'Two-step opt-in' : 'Direct link')
        + '</span>'
        + (publicCount ? '<span class="pill muted">' + publicCount + ' public ' + (publicCount === 1 ? 'reply' : 'replies') + '</span>' : '')
        + optIn
        + '</div>'
        + '<div class="rule-actions">'
        + '<button class="btn tiny" data-action="edit">Edit</button>'
        + '<button class="btn tiny ghost" data-action="duplicate">Duplicate</button>'
        + '<button class="btn tiny danger" data-action="delete">Delete</button>'
        + '</div>'
        + '</article>';
    }).join('');
  }

  function deleteRule(rule) {
    if (!window.confirm('Delete the rule “' + rule.name + '”? This does not affect already-sent DMs.')) return;
    api('/admin/api/rules/' + encodeURIComponent(rule.id), { method: 'DELETE' })
      .then(function () { toast('Rule deleted'); loadRules(); })
      .catch(function (error) { toast(error.message, 'bad'); });
  }

  function toggleRule(rule, enabled) {
    api('/admin/api/rules/' + encodeURIComponent(rule.id) + '/toggle', {
      method: 'POST',
      body: { enabled: enabled }
    }).then(function () {
      toast(enabled ? 'Rule enabled' : 'Rule paused');
      loadRules();
    }).catch(function (error) {
      toast(error.message, 'bad');
      loadRules();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Modal                                                             */
  /* ---------------------------------------------------------------- */

  function openModal(html) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="overlay" data-overlay="1"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    root.classList.add('open');
    document.body.classList.add('no-scroll');
    root.querySelector('.overlay').addEventListener('click', function (event) {
      if (event.target === event.currentTarget) closeModal();
    });
    root.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', closeModal);
    });
  }

  function closeModal() {
    var root = $('#modal-root');
    root.classList.remove('open');
    root.innerHTML = '';
    document.body.classList.remove('no-scroll');
    draft = null;
  }

  /* ---------------------------------------------------------------- */
  /* Rule form                                                         */
  /* ---------------------------------------------------------------- */

  function openRuleModal(rule, presetMediaIds, duplicateOf) {
    var source = rule || duplicateOf || null;
    draft = {
      id: rule ? rule.id : null,
      name: source ? (rule ? source.name : source.name + ' (copy)') : '',
      enabled: source ? !!source.enabled : true,
      target_mode: presetMediaIds && presetMediaIds.length ? 'specific_posts' : (source ? source.target_mode : 'all_posts'),
      media_ids: presetMediaIds && presetMediaIds.length ? presetMediaIds.slice() : (source ? source.media_ids.slice() : []),
      match_mode: source ? source.match_mode : 'any_keyword',
      keywords: source ? source.keywords.slice() : [],
      delivery_mode: source ? source.delivery_mode : 'two_step_opt_in',
      initial_dm_text: source ? source.initial_dm_text : 'Hey! Want the link? Just reply YES below and I’ll send it right over 👇',
      opt_in_keywords: source ? source.opt_in_keywords.slice() : [],
      followup_dm_text: source ? source.followup_dm_text : 'Here you go! 🎉\\nhttps://example.com/your-link',
      public_replies: source ? source.public_replies.slice() : ['Just sent you a DM! 📩'],
      priority: source ? source.priority : 0
    };

    openModal(ruleFormHtml());
    bindRuleForm();
    renderTargetPanels();
    renderMediaPicker();
    renderSelectedMedia();
    renderChips('keywords');
    renderChips('opt_in_keywords');
    renderPublicReplies();
    updateCounters();
    setTimeout(function () { var input = $('#rule-name'); if (input) input.focus(); }, 30);
  }

  function ruleFormHtml() {
    return ''
      + '<div class="modal-head">'
      + '<div><h2>' + (draft.id ? 'Edit rule' : 'New rule') + '</h2>'
      + '<p class="muted small">The webhook matches comments in real time and queues the DMs.</p></div>'
      + '<button type="button" class="icon-btn" data-close="1" aria-label="Close">✕</button>'
      + '</div>'
      + '<form id="rule-form" class="modal-body" novalidate>'
      + '<div class="grid two">'
      + '<div class="field"><label for="rule-name">Rule name</label>'
      + '<input id="rule-name" maxlength="80" placeholder="e.g. Free guide — reel"></div>'
      + '<div class="field"><label for="rule-priority">Priority</label>'
      + '<input id="rule-priority" type="number" min="-1000" max="1000" step="1" title="Higher wins when several rules match. Post-specific rules always beat global rules."></div>'
      + '</div>'

      + '<div class="field"><span class="label">Target</span><div class="seg">'
      + '<label class="seg-opt"><input type="radio" name="target_mode" value="all_posts">'
      + '<span><strong>All posts</strong><small>Every post and reel</small></span></label>'
      + '<label class="seg-opt"><input type="radio" name="target_mode" value="specific_posts">'
      + '<span><strong>Selected posts</strong><small>Only the posts you pick</small></span></label>'
      + '</div></div>'

      + '<div id="target-specific" class="field">'
      + '<div class="field-head"><span class="label">Posts</span>'
      + '<button type="button" class="btn tiny ghost" id="btn-goto-sync">Sync posts</button></div>'
      + '<div id="selected-media" class="chips"></div>'
      + '<div class="media-picker-tools">'
      + '<input id="media-search" type="search" placeholder="Search synced posts…">'
      + '<div class="add-media"><input id="media-id-input" placeholder="Paste a media ID">'
      + '<button type="button" class="btn tiny" id="btn-add-media-id">Add</button></div>'
      + '</div>'
      + '<div id="media-picker" class="media-picker"></div>'
      + '</div>'

      + '<div class="field"><span class="label">Trigger</span><div class="seg">'
      + '<label class="seg-opt"><input type="radio" name="match_mode" value="any_keyword">'
      + '<span><strong>Specific keywords</strong><small>Whole words or phrases</small></span></label>'
      + '<label class="seg-opt"><input type="radio" name="match_mode" value="any_comment">'
      + '<span><strong>Any comment</strong><small>Every top-level comment</small></span></label>'
      + '</div></div>'

      + '<div id="keyword-field" class="field">'
      + '<label for="keyword-input">Keywords</label>'
      + '<div class="chip-input"><div id="chips-keywords" class="chips"></div>'
      + '<input id="keyword-input" placeholder="Type a keyword and press Enter"></div>'
      + '<p class="hint">Case-insensitive. “link” matches “send the link!” but not “blinking”.</p>'
      + '</div>'

      + '<div class="field"><span class="label">Delivery</span><div class="seg stack">'
      + '<label class="seg-opt"><input type="radio" name="delivery_mode" value="two_step_opt_in">'
      + '<span><strong>Two-step opt-in <span class="pill tiny-pill">Recommended</span></strong>'
      + '<small>First DM asks the user to reply. The link is sent after they reply, so it stays clickable even if the first DM lands in Message Requests.</small></span></label>'
      + '<label class="seg-opt"><input type="radio" name="delivery_mode" value="direct_link">'
      + '<span><strong>Direct link in first DM</strong>'
      + '<small>One private reply containing the link. Links may not be clickable for non-followers.</small></span></label>'
      + '</div></div>'

      + '<div class="field">'
      + '<div class="field-head"><label for="initial-dm">Step 1 · Private reply</label>'
      + '<span class="counter" id="initial-count">0 / 1000</span></div>'
      + '<textarea id="initial-dm" rows="3" maxlength="1000"></textarea>'
      + '<p class="hint">Sent as a reply to the comment. Keep links out of this message — just ask for the opt-in.</p>'
      + '</div>'

      + '<div id="followup-section">'
      + '<div class="field">'
      + '<div class="field-head"><label for="followup-dm">Step 2 · Follow-up link message</label>'
      + '<span class="counter" id="followup-count">0 / 1000</span></div>'
      + '<textarea id="followup-dm" rows="3" maxlength="1000"></textarea>'
      + '<p class="hint">Sent inside the open 24-hour messaging window. Put the clean https:// link here.</p>'
      + '</div>'
      + '<div class="field"><label for="optin-input">Opt-in keywords <span class="muted">(optional)</span></label>'
      + '<div class="chip-input"><div id="chips-opt_in_keywords" class="chips"></div>'
      + '<input id="optin-input" placeholder="Leave empty to accept any reply"></div>'
      + '<p class="hint">If empty, any DM from the user completes the opt-in. Add words like yes, link, send to require one.</p>'
      + '</div>'
      + '</div>'

      + '<div class="field">'
      + '<div class="field-head"><span class="label">Public comment reply <span class="muted">(optional)</span></span>'
      + '<button type="button" class="btn tiny ghost" id="btn-add-reply">Add variation</button></div>'
      + '<div id="public-replies" class="reply-list"></div>'
      + '<p class="hint">One variant is picked at random and posted under the comment. Keep them short and human.</p>'
      + '</div>'

      + '<div class="field inline"><label class="check"><input type="checkbox" id="rule-enabled"> Rule enabled</label></div>'

      + '<div class="modal-foot">'
      + '<button type="button" class="btn ghost" data-close="1">Cancel</button>'
      + '<button type="submit" class="btn primary" id="btn-save-rule">Save rule</button>'
      + '</div>'
      + '</form>';
  }

  function bindRuleForm() {
    $('#rule-name').value = draft.name;
    $('#rule-priority').value = String(draft.priority);
    $('#rule-enabled').checked = draft.enabled;
    $('#initial-dm').value = draft.initial_dm_text;
    $('#followup-dm').value = draft.followup_dm_text;

    $all('input[name="target_mode"]').forEach(function (input) {
      input.checked = input.value === draft.target_mode;
      input.addEventListener('change', function () {
        draft.target_mode = input.value;
        renderTargetPanels();
      });
    });

    $all('input[name="match_mode"]').forEach(function (input) {
      input.checked = input.value === draft.match_mode;
      input.addEventListener('change', function () {
        draft.match_mode = input.value;
        renderTargetPanels();
      });
    });

    $all('input[name="delivery_mode"]').forEach(function (input) {
      input.checked = input.value === draft.delivery_mode;
      input.addEventListener('change', function () {
        draft.delivery_mode = input.value;
        renderTargetPanels();
      });
    });

    $('#initial-dm').addEventListener('input', function (event) {
      draft.initial_dm_text = event.target.value;
      updateCounters();
    });
    $('#followup-dm').addEventListener('input', function (event) {
      draft.followup_dm_text = event.target.value;
      updateCounters();
    });

    bindChipInput('keywords', '#keyword-input', '#chips-keywords');
    bindChipInput('opt_in_keywords', '#optin-input', '#chips-opt_in_keywords');

    $('#media-search').addEventListener('input', renderMediaPicker);

    $('#btn-add-media-id').addEventListener('click', function () {
      var input = $('#media-id-input');
      var id = input.value.trim();
      if (!id) return;
      if (draft.media_ids.indexOf(id) === -1) draft.media_ids.push(id);
      input.value = '';
      renderSelectedMedia();
      renderMediaPicker();
    });

    $('#media-picker').addEventListener('change', function (event) {
      var checkbox = event.target.closest('input[type="checkbox"]');
      if (!checkbox) return;
      var id = checkbox.value;
      var index = draft.media_ids.indexOf(id);
      if (checkbox.checked && index === -1) draft.media_ids.push(id);
      if (!checkbox.checked && index !== -1) draft.media_ids.splice(index, 1);
      renderSelectedMedia();
      var card = checkbox.closest('.media-opt');
      if (card) card.classList.toggle('selected', checkbox.checked);
    });

    $('#selected-media').addEventListener('click', function (event) {
      var button = event.target.closest('[data-remove-media]');
      if (!button) return;
      var id = button.getAttribute('data-remove-media');
      draft.media_ids = draft.media_ids.filter(function (value) { return value !== id; });
      renderSelectedMedia();
      renderMediaPicker();
    });

    $('#btn-goto-sync').addEventListener('click', function () {
      closeModal();
      setTab('posts');
    });

    $('#btn-add-reply').addEventListener('click', function () {
      if (draft.public_replies.length >= 10) {
        toast('Up to 10 public reply variants', 'bad');
        return;
      }
      draft.public_replies.push('');
      renderPublicReplies();
      var inputs = $all('#public-replies textarea');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    $('#public-replies').addEventListener('input', function (event) {
      var input = event.target.closest('[data-reply-index]');
      if (!input) return;
      draft.public_replies[Number(input.getAttribute('data-reply-index'))] = input.value;
    });

    $('#public-replies').addEventListener('click', function (event) {
      var button = event.target.closest('[data-remove-reply]');
      if (!button) return;
      draft.public_replies.splice(Number(button.getAttribute('data-remove-reply')), 1);
      renderPublicReplies();
    });

    $('#rule-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveRule();
    });
  }

  function bindChipInput(field, inputSelector, chipsSelector) {
    var input = $(inputSelector);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addChips(field, input.value);
        input.value = '';
      } else if (event.key === 'Backspace' && !input.value && draft[field].length) {
        draft[field].pop();
        renderChips(field);
      }
    });
    input.addEventListener('blur', function () {
      if (!input.value.trim()) return;
      addChips(field, input.value);
      input.value = '';
    });
    $(chipsSelector).addEventListener('click', function (event) {
      var button = event.target.closest('[data-chip-index]');
      if (!button) return;
      draft[field].splice(Number(button.getAttribute('data-chip-index')), 1);
      renderChips(field);
    });
  }

  function addChips(field, raw) {
    String(raw).split(',').forEach(function (part) {
      var value = part.trim();
      if (!value) return;
      if (draft[field].length >= 50) return;
      var exists = draft[field].some(function (existing) {
        return existing.toLowerCase() === value.toLowerCase();
      });
      if (!exists) draft[field].push(value);
    });
    renderChips(field);
  }

  function renderChips(field) {
    var wrap = $('#chips-' + field);
    if (!wrap) return;
    wrap.innerHTML = draft[field].map(function (value, index) {
      return '<span class="chip">' + esc(value)
        + '<button type="button" data-chip-index="' + index + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  function renderPublicReplies() {
    var wrap = $('#public-replies');
    if (!wrap) return;
    if (!draft.public_replies.length) {
      wrap.innerHTML = '<p class="muted small">No public reply. Leave empty to only send DMs.</p>';
      return;
    }
    wrap.innerHTML = draft.public_replies.map(function (value, index) {
      return '<div class="reply-row">'
        + '<textarea rows="2" maxlength="500" data-reply-index="' + index + '" placeholder="e.g. Just sent you a DM! 📩">' + esc(value) + '</textarea>'
        + '<button type="button" class="icon-btn" data-remove-reply="' + index + '" aria-label="Remove variation">✕</button>'
        + '</div>';
    }).join('');
  }

  function renderTargetPanels() {
    var specific = draft.target_mode === 'specific_posts';
    var keywords = draft.match_mode === 'any_keyword';
    var followup = draft.delivery_mode === 'two_step_opt_in';

    var targetPanel = $('#target-specific');
    if (targetPanel) targetPanel.style.display = specific ? '' : 'none';
    var keywordPanel = $('#keyword-field');
    if (keywordPanel) keywordPanel.style.display = keywords ? '' : 'none';
    var followupPanel = $('#followup-section');
    if (followupPanel) followupPanel.style.display = followup ? '' : 'none';
  }

  function renderMediaPicker() {
    var wrap = $('#media-picker');
    if (!wrap) return;
    var search = ($('#media-search') && $('#media-search').value || '').trim().toLowerCase();
    var items = state.media.filter(function (media) {
      if (!search) return true;
      return media.media_id.toLowerCase().indexOf(search) !== -1
        || String(media.caption || '').toLowerCase().indexOf(search) !== -1;
    });

    if (!items.length) {
      wrap.innerHTML = '<p class="muted small">'
        + (state.media.length ? 'No posts match that search.' : 'No synced posts yet. Go to the Posts tab and hit “Sync recent posts”.')
        + '</p>';
      return;
    }

    wrap.innerHTML = items.map(function (media) {
      var checked = draft.media_ids.indexOf(media.media_id) !== -1;
      return '<label class="media-opt' + (checked ? ' selected' : '') + '">'
        + '<input type="checkbox" value="' + esc(media.media_id) + '" ' + (checked ? 'checked' : '') + '>'
        + thumbHtml(media, 'sm')
        + '<span class="media-opt-meta"><strong>' + esc(media.media_type) + '</strong>'
        + '<span>' + esc(shortText(media.caption || 'No caption', 48)) + '</span></span>'
        + '</label>';
    }).join('');
  }

  function renderSelectedMedia() {
    var wrap = $('#selected-media');
    if (!wrap) return;
    if (!draft.media_ids.length) {
      wrap.innerHTML = '<span class="muted small">No posts selected yet.</span>';
      return;
    }
    wrap.innerHTML = draft.media_ids.map(function (id) {
      var media = state.media.filter(function (item) { return item.media_id === id; })[0];
      var label = media ? media.media_type + ' · ' + shortText(media.caption || 'No caption', 32) : 'ID ' + id;
      return '<span class="chip">' + esc(label)
        + '<button type="button" data-remove-media="' + esc(id) + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  function updateCounters() {
    var initial = $('#initial-dm');
    var followup = $('#followup-dm');
    var initialCount = $('#initial-count');
    var followupCount = $('#followup-count');
    if (initial && initialCount) {
      initialCount.textContent = initial.value.length + ' / 1000';
      initialCount.className = 'counter' + (initial.value.length > 1000 ? ' over' : '');
    }
    if (followup && followupCount) {
      followupCount.textContent = followup.value.length + ' / 1000';
      followupCount.className = 'counter' + (followup.value.length > 1000 ? ' over' : '');
    }
  }

  function saveRule() {
    var payload = {
      name: ($('#rule-name').value || '').trim(),
      enabled: $('#rule-enabled').checked,
      target_mode: draft.target_mode,
      media_ids: draft.media_ids.slice(),
      match_mode: draft.match_mode,
      keywords: draft.keywords.slice(),
      delivery_mode: draft.delivery_mode,
      initial_dm_text: ($('#initial-dm').value || '').trim(),
      opt_in_keywords: draft.opt_in_keywords.slice(),
      followup_dm_text: ($('#followup-dm').value || '').trim(),
      public_replies: draft.public_replies.map(function (value) { return value.trim(); }).filter(Boolean),
      priority: Number($('#rule-priority').value || 0)
    };

    if (!payload.name) return toast('Give the rule a name', 'bad');
    if (!payload.initial_dm_text) return toast('Step 1 message is required', 'bad');
    if (payload.target_mode === 'specific_posts' && !payload.media_ids.length) {
      return toast('Select at least one post', 'bad');
    }
    if (payload.match_mode === 'any_keyword' && !payload.keywords.length) {
      return toast('Add at least one keyword', 'bad');
    }
    if (payload.delivery_mode === 'two_step_opt_in' && !payload.followup_dm_text) {
      return toast('Step 2 message is required for two-step opt-in', 'bad');
    }

    var isEdit = !!draft.id;
    var path = isEdit ? '/admin/api/rules/' + encodeURIComponent(draft.id) : '/admin/api/rules';
    var button = $('#btn-save-rule');
    button.disabled = true;
    button.textContent = 'Saving…';

    api(path, { method: isEdit ? 'PUT' : 'POST', body: payload })
      .then(function () {
        closeModal();
        toast(isEdit ? 'Rule updated' : 'Rule created');
        loadRules();
      })
      .catch(function (error) {
        toast(error.message, 'bad');
        button.disabled = false;
        button.textContent = 'Save rule';
      });
  }

  /* ---------------------------------------------------------------- */
  /* Posts                                                             */
  /* ---------------------------------------------------------------- */

  function thumbHtml(media, size) {
    var thumb = safeUrl(media.thumbnail_url);
    if (thumb) {
      return '<div class="thumb ' + size + '"><img src="' + esc(thumb)
        + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>';
    }
    var label = media.media_type === 'REELS' ? 'Reel'
      : media.media_type === 'VIDEO' ? 'Video'
      : media.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Post';
    return '<div class="thumb ' + size + ' placeholder"><span>' + esc(label) + '</span></div>';
  }

  function renderPosts() {
    var grid = $('#posts-grid');
    if (!state.media.length) {
      grid.innerHTML = '<div class="empty wide">'
        + '<div class="empty-icon">▦</div>'
        + '<h3>No posts synced</h3>'
        + '<p>Pull the latest 25 posts and reels from Instagram so you can pick them visually in a rule.</p>'
        + '<button class="btn primary" id="btn-sync-empty">Sync recent posts</button>'
        + '</div>';
      var emptyButton = $('#btn-sync-empty');
      if (emptyButton) emptyButton.addEventListener('click', syncPosts);
      return;
    }

    grid.innerHTML = state.media.map(function (media) {
      var permalink = safeUrl(media.permalink);
      return '<article class="post-card">'
        + thumbHtml(media, 'lg')
        + '<div class="post-body">'
        + '<div class="post-top"><span class="pill muted">' + esc(media.media_type) + '</span>'
        + '<span class="muted small">' + esc(fmtDate(media.timestamp)) + '</span></div>'
        + '<p class="post-caption">' + esc(media.caption || 'No caption') + '</p>'
        + '<div class="post-actions">'
        + '<button class="btn tiny" data-post-rule="' + esc(media.media_id) + '">Use in rule</button>'
        + '<button class="btn tiny ghost" data-copy="' + esc(media.media_id) + '">Copy ID</button>'
        + (permalink ? '<a class="btn tiny ghost" href="' + esc(permalink) + '" target="_blank" rel="noopener">View</a>' : '')
        + '</div></div></article>';
    }).join('');
  }

  function syncPosts() {
    var buttons = [$('#btn-sync-posts'), $('#btn-sync-empty')].filter(Boolean);
    buttons.forEach(function (button) { button.disabled = true; button.textContent = 'Syncing…'; });
    api('/admin/api/media/sync', { method: 'POST', body: {} })
      .then(function (data) {
        toast('Synced ' + (data.synced || 0) + ' posts');
        return loadMedia();
      })
      .catch(function (error) { toast(error.message, 'bad'); })
      .then(function () {
        buttons.forEach(function (button) {
          button.disabled = false;
          button.textContent = button.id === 'btn-sync-empty' ? 'Sync recent posts' : 'Sync recent posts';
        });
      });
  }

  /* ---------------------------------------------------------------- */
  /* Activity                                                          */
  /* ---------------------------------------------------------------- */

  var STATE_META = {
    matched_queued: ['Queued', 'info'],
    private_reply_sent: ['DM sent', 'info'],
    awaiting_opt_in: ['Awaiting reply', 'warn'],
    completed: ['Completed', 'ok'],
    ignored: ['Ignored', 'muted'],
    failed: ['Failed', 'bad']
  };

  function stateBadge(value) {
    var meta = STATE_META[value] || [value, 'muted'];
    return '<span class="pill ' + meta[1] + '">' + esc(meta[0]) + '</span>';
  }

  function publicBadge(value) {
    if (!value || value === 'none') return '<span class="muted">—</span>';
    var map = { queued: ['Queued', 'info'], sent: ['Sent', 'ok'], failed: ['Failed', 'bad'] };
    var meta = map[value] || [value, 'muted'];
    return '<span class="pill ' + meta[1] + '">' + esc(meta[0]) + '</span>';
  }

  function renderLogs() {
    var body = $('#logs-body');
    if (!state.logs.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty-cell">No activity yet. Comments will appear here as soon as Instagram delivers them.</td></tr>';
      return;
    }

    body.innerHTML = state.logs.map(function (row) {
      var canRetry = row.state === 'failed' || row.job_status === 'failed';
      var user = row.commenter_username
        ? '<a href="https://instagram.com/' + encodeURIComponent(row.commenter_username) + '" target="_blank" rel="noopener">@' + esc(row.commenter_username) + '</a>'
        : '<span class="muted">' + esc(row.commenter_igsid) + '</span>';

      return '<tr>'
        + '<td class="nowrap" title="' + esc(row.created_at) + '">' + esc(timeAgo(row.created_at)) + '</td>'
        + '<td>' + user + '</td>'
        + '<td class="comment-cell" title="' + esc(row.comment_text) + '">' + esc(shortText(row.comment_text, 90)) + '</td>'
        + '<td>' + (row.rule_name ? esc(row.rule_name) : '<span class="muted">—</span>') + '</td>'
        + '<td>' + stateBadge(row.state) + '</td>'
        + '<td>' + publicBadge(row.public_reply_status) + '</td>'
        + '<td class="error-cell" title="' + esc(row.last_error || '') + '">'
        + (row.last_error ? esc(shortText(row.last_error, 60)) : '<span class="muted">—</span>') + '</td>'
        + '<td>' + (canRetry ? '<button class="btn tiny" data-retry="' + esc(row.comment_id) + '">Retry</button>' : '') + '</td>'
        + '</tr>';
    }).join('');
  }

  function retryComment(commentId, button) {
    button.disabled = true;
    button.textContent = 'Retrying…';
    api('/admin/api/comments/' + encodeURIComponent(commentId) + '/retry', { method: 'POST', body: {} })
      .then(function (data) {
        toast(data.requeued ? 'Requeued ' + data.requeued + ' job(s)' : 'Nothing to retry');
        loadLogs();
        loadState();
      })
      .catch(function (error) {
        toast(error.message, 'bad');
        button.disabled = false;
        button.textContent = 'Retry';
      });
  }

  /* ---------------------------------------------------------------- */
  /* Token                                                             */
  /* ---------------------------------------------------------------- */

  function openTokenModal() {
    openModal(''
      + '<div class="modal-head">'
      + '<div><h2>Set Instagram token</h2>'
      + '<p class="muted small">Paste a long-lived Instagram User Access Token.</p></div>'
      + '<button type="button" class="icon-btn" data-close="1" aria-label="Close">✕</button>'
      + '</div>'
      + '<div class="modal-body">'
      + '<div class="field"><label for="token-input">Access token</label>'
      + '<textarea id="token-input" rows="4" placeholder="IGQVJ…"></textarea>'
      + '<p class="hint">Meta App Dashboard → Instagram → API setup with Instagram business login → Generate token. '
      + 'It is validated with GET /me, then encrypted with AES-256-GCM before it touches the database.</p></div>'
      + '<div class="modal-foot">'
      + '<button type="button" class="btn ghost" data-close="1">Cancel</button>'
      + '<button type="button" class="btn primary" id="btn-save-token">Validate &amp; save</button>'
      + '</div></div>');
    $('#btn-save-token').addEventListener('click', saveToken);
    setTimeout(function () { var input = $('#token-input'); if (input) input.focus(); }, 30);
  }

  function saveToken() {
    var input = $('#token-input');
    var value = (input.value || '').trim();
    if (!value) return toast('Paste a token first', 'bad');
    var button = $('#btn-save-token');
    button.disabled = true;
    button.textContent = 'Validating…';
    api('/admin/api/token', { method: 'POST', body: { token: value } })
      .then(function (data) {
        closeModal();
        toast('Connected as @' + (data.account && data.account.username || 'unknown'));
        loadAll();
      })
      .catch(function (error) {
        toast(error.message, 'bad');
        button.disabled = false;
        button.textContent = 'Validate & save';
      });
  }

  function refreshTokenNow() {
    var button = $('#btn-refresh-token');
    button.disabled = true;
    button.textContent = 'Refreshing…';
    api('/admin/api/token/refresh', { method: 'POST', body: {} })
      .then(function (data) {
        toast(data.refreshed ? 'Token refreshed for another 60 days' : (data.reason || 'Token is still fresh'));
        loadState();
      })
      .catch(function (error) { toast(error.message, 'bad'); })
      .then(function () {
        button.disabled = false;
        button.textContent = 'Refresh token';
      });
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  $all('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setTab(tab.getAttribute('data-tab')); });
  });

  $('#btn-new-rule').addEventListener('click', function () { openRuleModal(null); });
  $('#btn-rotate-token').addEventListener('click', openTokenModal);
  $('#btn-refresh-token').addEventListener('click', refreshTokenNow);
  $('#btn-sync-posts').addEventListener('click', syncPosts);
  $('#btn-refresh-logs').addEventListener('click', loadLogs);

  $('#btn-logout').addEventListener('click', function () {
    fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () { window.location.href = '/admin'; });
  });

  $('#rules-list').addEventListener('click', function (event) {
    var button = event.target.closest('[data-action]');
    if (!button) return;
    var action = button.getAttribute('data-action');
    if (action === 'new') { openRuleModal(null); return; }
    var card = button.closest('[data-id]');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var rule = state.rules.filter(function (item) { return item.id === id; })[0];
    if (!rule) return;
    if (action === 'edit') openRuleModal(rule);
    if (action === 'duplicate') openRuleModal(null, null, rule);
    if (action === 'delete') deleteRule(rule);
  });

  $('#rules-list').addEventListener('change', function (event) {
    var input = event.target.closest('[data-action="toggle"]');
    if (!input) return;
    var card = input.closest('[data-id]');
    var rule = state.rules.filter(function (item) { return item.id === card.getAttribute('data-id'); })[0];
    if (rule) toggleRule(rule, input.checked);
  });

  $('#posts-grid').addEventListener('click', function (event) {
    var ruleButton = event.target.closest('[data-post-rule]');
    if (ruleButton) {
      openRuleModal(null, [ruleButton.getAttribute('data-post-rule')]);
      return;
    }
    var copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      var value = copyButton.getAttribute('data-copy');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () { toast('Media ID copied'); });
      } else {
        toast(value);
      }
    }
  });

  $('#logs-body').addEventListener('click', function (event) {
    var button = event.target.closest('[data-retry]');
    if (!button) return;
    retryComment(button.getAttribute('data-retry'), button);
  });

  $('#log-state').addEventListener('change', function (event) {
    state.filters.state = event.target.value;
    loadLogs();
  });

  $('#log-ignored').addEventListener('change', function (event) {
    state.filters.include_ignored = event.target.checked;
    loadLogs();
  });

  $('#log-search').addEventListener('input', debounce(function (event) {
    state.filters.q = event.target.value.trim();
    loadLogs();
  }, 300));

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && $('#modal-root').classList.contains('open')) closeModal();
  });

  logTimer = setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (state.tab === 'activity') loadLogs();
  }, 30000);

  loadAll();
})();
</script>
</body>
</html>`;
}

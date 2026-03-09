/**
 * COURSES — University course shortcuts, organized by quarter sections
 * Route: 111iridescence.org/courses*
 */

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const method = req.method;

        // Normalize path: strip /courses prefix
        let path = url.pathname;
        if (path.startsWith('/courses')) {
            path = path.substring(8) || '/';
        }
        if (path === '') path = '/';

        // SESSION MANAGEMENT — use global-auth DB
        const cookie = req.headers.get('Cookie') || '';
        const sessionId = cookie.split(';').find(c => c.trim().startsWith('sess='))?.split('=')[1];
        let user = null;
        if (sessionId) {
            user = await env.AUTH_DB.prepare('SELECT * FROM sessions WHERE id = ? AND expires > ?')
                .bind(sessionId, Date.now()).first();
        }

        // PROTECTED — redirect to central auth if not logged in
        if (!user) {
            return new Response(null, {
                status: 302,
                headers: { 'Location': `/auth/login?redirect=${encodeURIComponent(url.pathname)}` }
            });
        }

        // ── API: SECTIONS ────────────────────────────────────────────────────────

        if (path === '/api/section/create' && method === 'POST') {
            const fd = await req.formData();
            const { results } = await env.DB.prepare(
                'SELECT COUNT(*) as c FROM sections WHERE username = ?'
            ).bind(user.username).all();
            const pos = results[0]?.c ?? 0;
            await env.DB.prepare(
                'INSERT INTO sections (id, username, name, position, hidden, created_at) VALUES (?, ?, ?, ?, 0, ?)'
            ).bind(crypto.randomUUID(), user.username, fd.get('name'), pos, Date.now()).run();
            return new Response('OK');
        }

        if (path === '/api/section/rename' && method === 'POST') {
            const fd = await req.formData();
            await env.DB.prepare('UPDATE sections SET name = ? WHERE id = ? AND username = ?')
                .bind(fd.get('name'), fd.get('id'), user.username).run();
            return new Response('OK');
        }

        if (path === '/api/section/delete' && method === 'POST') {
            const fd = await req.formData();
            const sid = fd.get('id');
            await env.DB.prepare('DELETE FROM tiles WHERE section_id = ? AND username = ?').bind(sid, user.username).run();
            await env.DB.prepare('DELETE FROM sections WHERE id = ? AND username = ?').bind(sid, user.username).run();
            return new Response('OK');
        }

        if (path === '/api/section/toggle' && method === 'POST') {
            const fd = await req.formData();
            await env.DB.prepare(
                'UPDATE sections SET hidden = CASE WHEN hidden = 1 THEN 0 ELSE 1 END WHERE id = ? AND username = ?'
            ).bind(fd.get('id'), user.username).run();
            return new Response('OK');
        }

        if (path === '/api/section/reorder' && method === 'POST') {
            const fd = await req.formData();
            const sid = fd.get('id');
            const dir = fd.get('dir'); // 'up' or 'down'
            const sec = await env.DB.prepare('SELECT * FROM sections WHERE id = ? AND username = ?')
                .bind(sid, user.username).first();
            if (!sec) return new Response('Not found', { status: 404 });
            const newPos = dir === 'up' ? sec.position - 1 : sec.position + 1;
            // Swap with neighbor
            await env.DB.prepare(
                'UPDATE sections SET position = ? WHERE username = ? AND position = ?'
            ).bind(sec.position, user.username, newPos).run();
            await env.DB.prepare('UPDATE sections SET position = ? WHERE id = ?')
                .bind(newPos, sid).run();
            return new Response('OK');
        }

        // ── API: TILES ───────────────────────────────────────────────────────────

        if (path === '/api/tile/create' && method === 'POST') {
            const fd = await req.formData();
            const sid = fd.get('section_id');
            const { results } = await env.DB.prepare(
                'SELECT COUNT(*) as c FROM tiles WHERE section_id = ? AND username = ?'
            ).bind(sid, user.username).all();
            const pos = results[0]?.c ?? 0;
            await env.DB.prepare(
                'INSERT INTO tiles (id, section_id, username, name, url, emoji, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(
                crypto.randomUUID(), sid, user.username,
                fd.get('name'), fd.get('url'),
                fd.get('emoji') || '📚', pos, Date.now()
            ).run();
            return new Response('OK');
        }

        if (path === '/api/tile/edit' && method === 'POST') {
            const fd = await req.formData();
            await env.DB.prepare(
                'UPDATE tiles SET name = ?, url = ?, emoji = ? WHERE id = ? AND username = ?'
            ).bind(fd.get('name'), fd.get('url'), fd.get('emoji') || '📚', fd.get('id'), user.username).run();
            return new Response('OK');
        }

        if (path === '/api/tile/delete' && method === 'POST') {
            const fd = await req.formData();
            await env.DB.prepare('DELETE FROM tiles WHERE id = ? AND username = ?')
                .bind(fd.get('id'), user.username).run();
            return new Response('OK');
        }

        // ── PAGE: DASHBOARD ──────────────────────────────────────────────────────

        if (path === '/' || path === '') {
            const { results: sections } = await env.DB.prepare(
                'SELECT * FROM sections WHERE username = ? ORDER BY position ASC'
            ).bind(user.username).all();

            const { results: tiles } = await env.DB.prepare(
                'SELECT * FROM tiles WHERE username = ? ORDER BY position ASC'
            ).bind(user.username).all();

            return new Response(renderDash(user, sections, tiles), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        return new Response('404', { status: 404 });
    }
};

// ── STYLES ────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root{
  --bg:#0f1117;--card:#161b22;--card2:#1c2130;--txt:#f8fafc;--muted:#94a3b8;
  --dim:#475569;--p:#6366f1;--ph:#4f46e5;--s:#0ea5e9;--err:#f43f5e;
  --good:#10b981;--warn:#f59e0b;--border:rgba(255,255,255,0.07);--ring:rgba(99,102,241,0.4)
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;line-height:1.5}
a{color:var(--p);text-decoration:none}
a:hover{color:#818cf8}

/* HEADER */
header{display:flex;justify-content:space-between;align-items:center;height:64px;padding:0 24px;
  background:var(--card);border-bottom:1px solid var(--border);
  box-shadow:0 4px 20px rgba(0,0,0,0.25);position:sticky;top:0;z-index:50}

/* USER DROPDOWN */
.user-wrap{position:relative}
.user-btn{display:flex;align-items:center;gap:8px;color:var(--txt);font-size:0.9em;font-weight:500;
  padding:8px 13px;border-radius:9px;background:rgba(255,255,255,0.05);
  border:1px solid var(--border);cursor:pointer;transition:background .2s;font-family:inherit}
.user-btn:hover{background:rgba(255,255,255,0.09)}
.caret{opacity:.5;transition:transform .2s;margin-left:2px}
.user-wrap.open .caret{transform:rotate(180deg)}
.dd{display:none;position:absolute;right:0;top:calc(100% + 10px);
  background:#151c28;border:1px solid var(--border);border-radius:14px;
  min-width:200px;box-shadow:0 20px 56px rgba(0,0,0,.6);z-index:999;overflow:hidden}
.user-wrap.open .dd{display:block;animation:dd .15s ease-out}
@keyframes dd{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
.dd-hdr{padding:14px 16px 10px;border-bottom:1px solid var(--border)}
.dd-name{font-weight:700;font-size:.95em;margin-bottom:2px}
.dd-sub{font-size:.75em;color:var(--muted)}
.ddl{display:flex;align-items:center;gap:10px;padding:11px 16px;color:var(--txt);
  text-decoration:none;font-size:.9em;font-weight:500;transition:background .15s}
.ddl:hover{background:rgba(255,255,255,.05);color:var(--txt)}
.dd-sep{height:1px;background:var(--border);margin:4px 0}
.ddl.out{color:var(--err)!important}
.ddl.out:hover{background:rgba(244,63,94,.08)!important}

/* MAIN */
main{padding:32px 24px 80px;max-width:1100px;margin:0 auto}
.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;flex-wrap:wrap;gap:12px}
.page-title{font-size:2em;font-weight:800;color:#fff;letter-spacing:-.03em}
.page-sub{font-size:.95em;color:var(--muted);margin-top:4px}

/* BUTTONS */
button,input[type=submit]{cursor:pointer;font-family:inherit}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:10px;
  font-size:.88em;font-weight:600;border:none;transition:all .2s;cursor:pointer}
.btn-primary{background:var(--p);color:#fff}
.btn-primary:hover{background:var(--ph);transform:translateY(-1px);box-shadow:0 4px 14px rgba(99,102,241,.35)}
.btn-ghost{background:rgba(255,255,255,.05);color:var(--muted);border:1px solid var(--border)}
.btn-ghost:hover{background:rgba(255,255,255,.09);color:var(--txt)}
.btn-danger{background:rgba(244,63,94,.1);color:var(--err);border:1px solid rgba(244,63,94,.2)}
.btn-danger:hover{background:rgba(244,63,94,.2)}
.btn-sm{padding:5px 10px;font-size:.78em;border-radius:7px}
.btn-icon{padding:5px 8px;background:rgba(255,255,255,.05);border:1px solid var(--border);
  border-radius:7px;color:var(--muted);font-size:.82em;transition:all .15s}
.btn-icon:hover{background:rgba(255,255,255,.1);color:var(--txt)}
.btn-icon.red:hover{background:rgba(244,63,94,.1);color:var(--err);border-color:rgba(244,63,94,.25)}

/* SECTION */
.section-block{background:var(--card);border:1px solid var(--border);border-radius:18px;
  margin-bottom:20px;overflow:hidden;transition:box-shadow .2s}
.section-block:hover{box-shadow:0 8px 28px rgba(0,0,0,.25)}
.section-header{display:flex;align-items:center;gap:10px;padding:16px 20px;
  border-bottom:1px solid var(--border);cursor:pointer;user-select:none}
.section-header.collapsed{border-bottom:none}
.section-chevron{color:var(--muted);transition:transform .25s;flex-shrink:0;font-size:.9em}
.section-header.collapsed .section-chevron{transform:rotate(-90deg)}
.section-name{font-weight:700;font-size:1.05em;color:var(--txt);flex:1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.section-meta{font-size:.75em;color:var(--dim);white-space:nowrap}
.section-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.hidden-badge{font-size:.7em;font-weight:600;padding:2px 8px;border-radius:20px;
  background:rgba(148,163,184,.1);color:var(--muted);border:1px solid var(--border)}

/* TILE GRID */
.tile-area{padding:20px}
.tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:16px}
.tile-card{background:var(--card2);border:1px solid var(--border);border-radius:14px;
  padding:18px 16px;cursor:pointer;transition:all .2s;position:relative;
  display:flex;flex-direction:column;align-items:flex-start;gap:8px;
  text-decoration:none;color:var(--txt)}
.tile-card:hover{border-color:rgba(99,102,241,.4);background:#212840;
  transform:translateY(-3px);box-shadow:0 10px 28px rgba(0,0,0,.35)}
.tile-emoji{font-size:2em;line-height:1;margin-bottom:2px}
.tile-name{font-weight:600;font-size:.9em;color:var(--txt);line-height:1.3;word-break:break-word}
.tile-url{font-size:.72em;color:var(--dim);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;width:100%;max-width:100%}
.tile-actions{display:flex;gap:5px;position:absolute;top:8px;right:8px;
  opacity:0;transition:opacity .15s;pointer-events:none}
.tile-card:hover .tile-actions{opacity:1;pointer-events:all}

/* ADD TILE */
.add-tile-btn{display:flex;align-items:center;gap:8px;padding:14px 16px;
  border:2px dashed var(--border);border-radius:14px;color:var(--dim);
  font-size:.87em;font-weight:500;background:transparent;width:100%;
  cursor:pointer;transition:all .2s;justify-content:center}
.add-tile-btn:hover{border-color:var(--p);color:var(--p);background:rgba(99,102,241,.05)}

/* FORM INPUTS */
input[type=text],input[type=url],select{
  background:rgba(0,0,0,.25);border:1px solid var(--border);color:var(--txt);
  padding:10px 14px;border-radius:10px;font-family:inherit;font-size:.92em;
  transition:border-color .2s,box-shadow .2s;width:100%}
input:focus,select:focus{outline:none;border-color:var(--p);box-shadow:0 0 0 3px var(--ring)}

/* MODAL */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);
  z-index:1000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
.modal-bg.open{display:flex;animation:fadeIn .2s ease-out}
@keyframes fadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.modal-box{background:#161b22;border:1px solid rgba(255,255,255,.1);border-radius:20px;
  padding:28px;width:100%;max-width:480px;box-shadow:0 28px 72px rgba(0,0,0,.7)}
.modal-title{font-size:1.25em;font-weight:700;margin-bottom:22px}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:.82em;font-weight:600;color:var(--muted);
  margin-bottom:6px;letter-spacing:.03em;text-transform:uppercase}
.btn-row{display:flex;gap:10px;margin-top:24px}
.btn-row .btn{flex:1;justify-content:center}

/* EMOJI PICKER */
.emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;
  max-height:160px;overflow-y:auto;margin-top:8px;padding:4px}
.emoji-opt{font-size:1.4em;padding:6px;border-radius:8px;cursor:pointer;text-align:center;
  background:transparent;border:2px solid transparent;transition:all .15s;line-height:1}
.emoji-opt:hover{background:rgba(255,255,255,.06)}
.emoji-opt.selected{background:rgba(99,102,241,.15);border-color:var(--p)}

/* EMPTY STATE */
.empty-state{text-align:center;padding:60px 20px;color:var(--muted)}
.empty-icon{font-size:3em;margin-bottom:12px}
.empty-title{font-size:1.2em;font-weight:700;color:var(--txt);margin-bottom:6px}
.empty-sub{font-size:.9em}

/* ANIMATION */
main{animation:slideUp .35s ease-out}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
`;

const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%236366f1'/%3E%3Cstop offset='1' stop-color='%23f43f5e'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Ctext x='16' y='21' font-family='Arial,sans-serif' font-weight='900' font-size='12' fill='white' text-anchor='middle'%3E111%3C/text%3E%3C/svg%3E`;

function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderHeader(username) {
    const id = 'cuw';
    return `
  <a href="/" style="text-decoration:none;display:flex;align-items:center;gap:10px;flex-shrink:0">
    <span style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#f43f5e);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9em;color:#fff;flex-shrink:0;box-shadow:0 0 18px rgba(99,102,241,.5)">111</span>
    <div style="display:flex;flex-direction:column;line-height:1.25">
      <span style="font-weight:700;font-size:1.1em;color:#fff;letter-spacing:-.02em">111<span style="color:#6366f1;text-shadow:0 0 20px rgba(99,102,241,.6)">iridescence</span></span>
      <span style="font-size:.72em;color:#94a3b8;font-weight:500;letter-spacing:.03em">Courses</span>
    </div>
  </a>
  <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
    <div class="user-wrap" id="${id}">
      <button class="user-btn" onclick="document.getElementById('${id}').classList.toggle('open')">
        ${esc(username)}
        <svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="dd">
        <div class="dd-hdr">
          <div class="dd-name">${esc(username)}</div>
          <div class="dd-sub">Courses</div>
        </div>
        <a href="/auth/account" class="ddl">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
          Account Preferences
        </a>
        <div class="dd-sep"></div>
        <a href="/auth/logout" class="ddl out">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </a>
      </div>
    </div>
    <script>document.addEventListener('click',e=>{const w=document.getElementById('${id}');if(w&&!w.contains(e.target))w.classList.remove('open');});<\/script>
  </div>`;
}

const EMOJIS = ['📚', '🎓', '📖', '📝', '✏️', '🖊️', '🔬', '🧪', '🧬', '⚗️', '🔭', '💡', '🧠', '🏛️', '📐', '📏', '🖥️', '💻', '📊', '📈', '📉', '🗺️', '🌐', '📡', '🎨', '🎭', '🎵', '🎤', '🏋️', '⚽', '🏀', '🎾', '🌱', '🌿', '🍀', '🦁', '🦊', '🐝', '☀️', '🌙', '⭐', '🔥', '❄️', '🌊', '🏔️', '🏙️', '🚀', '✈️'];

const EMOJI_GRID = EMOJIS.map(e =>
    `<button type="button" class="emoji-opt" onclick="selectEmoji('${e}')" title="${e}">${e}</button>`
).join('');

function renderDash(user, sections, tiles) {
    const tilesBySection = {};
    tiles.forEach(t => {
        if (!tilesBySection[t.section_id]) tilesBySection[t.section_id] = [];
        tilesBySection[t.section_id].push(t);
    });

    const sectionCount = sections.length;

    const sectionsHtml = sections.length === 0 ? `
    <div class="empty-state">
      <div class="empty-icon">🎓</div>
      <div class="empty-title">No sections yet</div>
      <div class="empty-sub">Create your first section (e.g. "Fall 2025") to get started.</div>
    </div>` :
        sections.map((sec, idx) => {
            const secTiles = tilesBySection[sec.id] || [];
            const isHidden = sec.hidden === 1;
            const isFirst = idx === 0;
            const isLast = idx === sectionCount - 1;

            const tilesHtml = secTiles.length === 0
                ? `<p style="color:var(--dim);font-size:.87em;margin-bottom:14px">No courses yet — add one below.</p>`
                : `<div class="tile-grid">
          ${secTiles.map(t => `
            <a class="tile-card" href="${esc(t.url)}" target="_blank" rel="noopener">
              <div class="tile-actions">
                <button class="btn-icon" onclick="event.preventDefault();openEditTile('${esc(t.id)}','${esc(t.name)}','${esc(t.url)}','${esc(t.emoji)}')" title="Edit">✏️</button>
                <button class="btn-icon red" onclick="event.preventDefault();deleteTile('${esc(t.id)}')" title="Delete">✕</button>
              </div>
              <div class="tile-emoji">${t.emoji}</div>
              <div class="tile-name">${esc(t.name)}</div>
              <div class="tile-url">${esc(t.url.replace(/^https?:\/\//, ''))}</div>
            </a>`).join('')}
          </div>`;

            return `
      <div class="section-block" id="sec-${sec.id}">
        <div class="section-header ${isHidden ? 'collapsed' : ''}" onclick="toggleSection('${sec.id}')">
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="section-name">${esc(sec.name)}</span>
          ${isHidden ? '<span class="hidden-badge">hidden</span>' : ''}
          <span class="section-meta">${secTiles.length} course${secTiles.length !== 1 ? 's' : ''}</span>
          <div class="section-actions" onclick="event.stopPropagation()">
            ${!isFirst ? `<button class="btn-icon" onclick="moveSection('${sec.id}','up')" title="Move up">▲</button>` : ''}
            ${!isLast ? `<button class="btn-icon" onclick="moveSection('${sec.id}','down')" title="Move down">▼</button>` : ''}
            <button class="btn-icon" onclick="toggleHide('${sec.id}')" title="${isHidden ? 'Show' : 'Hide'}">${isHidden ? '👁' : '🙈'}</button>
            <button class="btn-icon" onclick="openRename('${esc(sec.id)}','${esc(sec.name)}')" title="Rename">✏️</button>
            <button class="btn-icon red" onclick="deleteSection('${esc(sec.id)}','${esc(sec.name)}')" title="Delete">✕</button>
          </div>
        </div>
        <div class="tile-area" id="area-${sec.id}" style="${isHidden ? 'display:none' : ''}">
          ${tilesHtml}
          <button class="add-tile-btn" onclick="openAddTile('${esc(sec.id)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Course
          </button>
        </div>
      </div>`;
        }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Courses — 111iridescence</title>
  <meta name="description" content="Your university courses, organized by quarter.">
  <link rel="icon" type="image/svg+xml" href="${FAVICON}">
  <style>${CSS}</style>
</head>
<body>
  <header>${renderHeader(user.username)}</header>

  <main>
    <div class="top-bar">
      <div>
        <div class="page-title">📚 My Courses</div>
        <div class="page-sub">Shortcuts to all your university courses, organized by quarter.</div>
      </div>
      <button class="btn btn-primary" onclick="openAddSection()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Section
      </button>
    </div>

    <div id="sections-container">${sectionsHtml}</div>
  </main>

  <!-- ADD SECTION MODAL -->
  <div class="modal-bg" id="add-section-modal" onclick="if(event.target===this)closeModals()">
    <div class="modal-box">
      <div class="modal-title">➕ New Section</div>
      <form onsubmit="event.preventDefault();addSection(this)">
        <div class="form-group">
          <label>Section Name</label>
          <input type="text" name="name" placeholder="e.g. Fall 2025" required autofocus>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">Create</button>
          <button type="button" class="btn btn-ghost" onclick="closeModals()">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- RENAME SECTION MODAL -->
  <div class="modal-bg" id="rename-section-modal" onclick="if(event.target===this)closeModals()">
    <div class="modal-box">
      <div class="modal-title">✏️ Rename Section</div>
      <form onsubmit="event.preventDefault();renameSection(this)">
        <input type="hidden" name="id" id="rename-id">
        <div class="form-group">
          <label>Section Name</label>
          <input type="text" name="name" id="rename-name" required>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-ghost" onclick="closeModals()">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ADD / EDIT TILE MODAL -->
  <div class="modal-bg" id="tile-modal" onclick="if(event.target===this)closeModals()">
    <div class="modal-box">
      <div class="modal-title" id="tile-modal-title">📚 Add Course</div>
      <form onsubmit="event.preventDefault();submitTile(this)">
        <input type="hidden" name="section_id" id="tile-section-id">
        <input type="hidden" name="id" id="tile-id">
        <div class="form-group">
          <label>Course Name</label>
          <input type="text" name="name" id="tile-name" placeholder="e.g. Introduction to Biology" required>
        </div>
        <div class="form-group">
          <label>Course URL</label>
          <input type="url" name="url" id="tile-url" placeholder="https://moodle.university.edu/course/123" required>
        </div>
        <div class="form-group">
          <label>Icon</label>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div id="emoji-preview" style="font-size:2em;min-width:40px;text-align:center">📚</div>
            <input type="text" name="emoji" id="tile-emoji" value="📚" placeholder="📚" maxlength="4" style="width:80px;text-align:center;font-size:1.3em" oninput="document.getElementById('emoji-preview').textContent=this.value||'📚'">
          </div>
          <div class="emoji-grid">${EMOJI_GRID}</div>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary" id="tile-submit-btn">Add Course</button>
          <button type="button" class="btn btn-ghost" onclick="closeModals()">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- CONFIRM MODAL -->
  <div class="modal-bg" id="confirm-modal" onclick="if(event.target===this)closeModals()">
    <div class="modal-box" style="max-width:380px">
      <div class="modal-title">⚠️ Confirm</div>
      <p id="confirm-msg" style="color:var(--muted);margin-bottom:24px;font-size:.95em"></p>
      <div class="btn-row">
        <button class="btn btn-danger" id="confirm-yes">Delete</button>
        <button class="btn btn-ghost" onclick="closeModals()">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    const BASE = '/courses';
    let _confirmCb = null;

    // ── MODALS ────────────────────────────────────────────────────────────────
    function closeModals() {
      document.querySelectorAll('.modal-bg').forEach(m => m.classList.remove('open'));
    }

    function showConfirm(msg, cb) {
      document.getElementById('confirm-msg').textContent = msg;
      _confirmCb = cb;
      document.getElementById('confirm-modal').classList.add('open');
    }
    document.getElementById('confirm-yes').onclick = () => { if (_confirmCb) _confirmCb(); closeModals(); };

    // ── SECTION: ADD ──────────────────────────────────────────────────────────
    function openAddSection() {
      document.getElementById('add-section-modal').classList.add('open');
      setTimeout(() => document.querySelector('#add-section-modal input[name=name]')?.focus(), 50);
    }

    async function addSection(form) {
      const fd = new FormData(form);
      const r = await fetch(BASE + '/api/section/create', { method: 'POST', body: fd });
      if (r.ok) location.reload(); else alert(await r.text());
    }

    // ── SECTION: RENAME ───────────────────────────────────────────────────────
    function openRename(id, name) {
      document.getElementById('rename-id').value = id;
      document.getElementById('rename-name').value = name;
      document.getElementById('rename-section-modal').classList.add('open');
      setTimeout(() => document.getElementById('rename-name')?.focus(), 50);
    }

    async function renameSection(form) {
      const fd = new FormData(form);
      const r = await fetch(BASE + '/api/section/rename', { method: 'POST', body: fd });
      if (r.ok) location.reload(); else alert(await r.text());
    }

    // ── SECTION: DELETE ───────────────────────────────────────────────────────
    function deleteSection(id, name) {
      showConfirm('Delete section "' + name + '" and ALL its courses?', async () => {
        const fd = new FormData(); fd.append('id', id);
        const r = await fetch(BASE + '/api/section/delete', { method: 'POST', body: fd });
        if (r.ok) location.reload(); else alert(await r.text());
      });
    }

    // ── SECTION: TOGGLE HIDE ──────────────────────────────────────────────────
    async function toggleHide(id) {
      const fd = new FormData(); fd.append('id', id);
      const r = await fetch(BASE + '/api/section/toggle', { method: 'POST', body: fd });
      if (r.ok) location.reload();
    }

    // ── SECTION: REORDER ──────────────────────────────────────────────────────
    async function moveSection(id, dir) {
      const fd = new FormData(); fd.append('id', id); fd.append('dir', dir);
      const r = await fetch(BASE + '/api/section/reorder', { method: 'POST', body: fd });
      if (r.ok) location.reload();
    }

    // ── SECTION: COLLAPSE TOGGLE (client-side instant) ────────────────────────
    function toggleSection(id) {
      const header = document.querySelector('#sec-' + id + ' .section-header');
      const area = document.getElementById('area-' + id);
      if (!header || !area) return;
      const collapsed = header.classList.contains('collapsed');
      header.classList.toggle('collapsed', !collapsed);
      area.style.display = collapsed ? '' : 'none';
    }

    // ── TILE: ADD ─────────────────────────────────────────────────────────────
    function openAddTile(sectionId) {
      document.getElementById('tile-section-id').value = sectionId;
      document.getElementById('tile-id').value = '';
      document.getElementById('tile-name').value = '';
      document.getElementById('tile-url').value = '';
      document.getElementById('tile-emoji').value = '📚';
      document.getElementById('emoji-preview').textContent = '📚';
      document.getElementById('tile-modal-title').textContent = '📚 Add Course';
      document.getElementById('tile-submit-btn').textContent = 'Add Course';
      selectEmoji('📚');
      document.getElementById('tile-modal').classList.add('open');
      setTimeout(() => document.getElementById('tile-name')?.focus(), 50);
    }

    // ── TILE: EDIT ────────────────────────────────────────────────────────────
    function openEditTile(id, name, url, emoji) {
      document.getElementById('tile-section-id').value = '';
      document.getElementById('tile-id').value = id;
      document.getElementById('tile-name').value = name;
      document.getElementById('tile-url').value = url;
      document.getElementById('tile-emoji').value = emoji;
      document.getElementById('emoji-preview').textContent = emoji;
      document.getElementById('tile-modal-title').textContent = '✏️ Edit Course';
      document.getElementById('tile-submit-btn').textContent = 'Save Changes';
      selectEmoji(emoji);
      document.getElementById('tile-modal').classList.add('open');
      setTimeout(() => document.getElementById('tile-name')?.focus(), 50);
    }

    async function submitTile(form) {
      const fd = new FormData(form);
      const id = fd.get('id');
      const endpoint = id ? '/api/tile/edit' : '/api/tile/create';
      const r = await fetch(BASE + endpoint, { method: 'POST', body: fd });
      if (r.ok) location.reload(); else alert(await r.text());
    }

    // ── TILE: DELETE ──────────────────────────────────────────────────────────
    function deleteTile(id) {
      showConfirm('Delete this course shortcut?', async () => {
        const fd = new FormData(); fd.append('id', id);
        const r = await fetch(BASE + '/api/tile/delete', { method: 'POST', body: fd });
        if (r.ok) location.reload(); else alert(await r.text());
      });
    }

    // ── EMOJI PICKER ──────────────────────────────────────────────────────────
    function selectEmoji(e) {
      document.getElementById('tile-emoji').value = e;
      document.getElementById('emoji-preview').textContent = e;
      document.querySelectorAll('.emoji-opt').forEach(btn => {
        btn.classList.toggle('selected', btn.textContent === e);
      });
    }

    // Close modals on Escape
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
  </script>
</body>
</html>`;
}

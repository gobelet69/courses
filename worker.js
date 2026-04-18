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
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=JetBrains+Mono:wght@400;500&display=swap');
:root{
  --bg:#0F1115;--surface:#1A1D24;--surface-hover:#20242C;--surface-soft:#151820;
  --text:#F1F5F9;--text-secondary:#94A3B8;--text-muted:#64748B;--border:#262A33;
  --accent:#A855F7;--accent-pink:#EC4899;
  --accent-soft:rgba(168,85,247,0.10);--accent-glow:rgba(168,85,247,0.20);
  --danger:#F43F5E;--danger-soft:rgba(244,63,94,0.12);
  --good:#10B981;--warn:#F59E0B;
  --radius-sm:6px;--radius:8px;--radius-md:10px;--radius-lg:12px;--radius-xl:16px;
  --transition:150ms ease-out;
  --shadow-sm:0 1px 3px rgba(0,0,0,0.25);--shadow:0 4px 16px rgba(0,0,0,0.30);--shadow-lg:0 16px 48px rgba(0,0,0,0.40);
  --gradient:linear-gradient(135deg,#A855F7,#EC4899);
  --gradient-subtle:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(236,72,153,0.10));
  --font:"DM Sans",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  /* legacy aliases used by inline styles */
  --card:var(--surface);--card2:var(--surface-soft);--txt:var(--text);
  --muted:var(--text-secondary);--dim:var(--text-muted);
  --p:var(--accent);--ph:var(--accent-pink);--err:var(--danger);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5;font-size:14px;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none;transition:color var(--transition)}
a:hover{color:var(--accent-pink)}
::selection{background:rgba(168,85,247,0.30)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* HEADER */
header{display:flex;justify-content:space-between;align-items:center;height:64px;padding:0 24px;
  background:var(--surface);border-bottom:1px solid var(--border);
  box-shadow:var(--shadow-sm);position:sticky;top:0;z-index:50;backdrop-filter:blur(8px)}

/* USER DROPDOWN */
.user-wrap{position:relative}
.user-btn{display:flex;align-items:center;gap:8px;color:var(--text);font-size:0.84rem;font-weight:500;
  padding:6px 12px 6px 10px;border-radius:var(--radius);background:transparent;
  border:1px solid var(--border);cursor:pointer;transition:all var(--transition);font-family:inherit}
.user-btn:hover{background:var(--surface-hover)}
.caret{color:var(--text-muted);transition:transform var(--transition);margin-left:2px}
.user-wrap.open .caret{transform:rotate(180deg)}
.dd{display:none;position:absolute;right:0;top:calc(100% + 8px);
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);
  min-width:220px;box-shadow:var(--shadow-lg);z-index:999;overflow:hidden}
.user-wrap.open .dd{display:block;animation:dd 150ms ease-out}
@keyframes dd{from{opacity:0;transform:translateY(-4px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.dd-hdr{padding:14px 16px 10px;border-bottom:1px solid var(--border)}
.dd-name{font-weight:700;font-size:0.92rem;margin-bottom:2px}
.dd-sub{font-size:0.76rem;color:var(--text-muted)}
.ddl{display:flex;align-items:center;gap:10px;padding:10px 16px;color:var(--text);
  text-decoration:none;font-size:0.86rem;font-weight:500;transition:background var(--transition)}
.ddl:hover{background:var(--accent-soft);color:var(--text)}
.dd-sep{height:1px;background:var(--border);margin:4px 0}
.ddl.out{color:var(--danger)!important}
.ddl.out:hover{background:var(--danger-soft)!important}

/* MAIN */
main{padding:32px 24px 80px;max-width:1100px;margin:0 auto}
.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;flex-wrap:wrap;gap:12px}
.page-title{font-size:1.75rem;font-weight:800;color:var(--text);letter-spacing:-0.03em;background:var(--gradient);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.page-sub{font-size:0.9rem;color:var(--text-secondary);margin-top:4px;font-weight:500}

/* BUTTONS */
button,input[type=submit]{cursor:pointer;font-family:inherit}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:var(--radius);
  font-size:0.84rem;font-weight:600;border:none;transition:all var(--transition);cursor:pointer}
.btn-primary{background:var(--gradient);color:#fff;box-shadow:0 2px 8px rgba(168,85,247,0.30)}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(168,85,247,0.40)}
.btn-ghost{background:transparent;color:var(--text-secondary);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--surface-hover);color:var(--text)}
.btn-danger{background:var(--danger-soft);color:var(--danger);border:1px solid rgba(244,63,94,0.25)}
.btn-danger:hover{background:rgba(244,63,94,0.2);border-color:rgba(244,63,94,0.4)}
.btn-sm{padding:5px 10px;font-size:0.76rem;border-radius:var(--radius-sm)}
.btn-icon{padding:5px 8px;background:transparent;border:1px solid var(--border);
  border-radius:var(--radius-sm);color:var(--text-muted);font-size:0.8rem;transition:all var(--transition)}
.btn-icon:hover{background:var(--surface-hover);color:var(--text);border-color:var(--border)}
.btn-icon.red:hover{background:var(--danger-soft);color:var(--danger);border-color:rgba(244,63,94,0.3)}

/* SECTION */
.section-block{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);
  margin-bottom:16px;overflow:hidden;transition:all var(--transition);box-shadow:var(--shadow-sm)}
.section-block:hover{border-color:rgba(168,85,247,0.25);box-shadow:0 6px 20px rgba(0,0,0,0.25)}
.section-header{display:flex;align-items:center;gap:10px;padding:14px 20px;
  border-bottom:1px solid var(--border);cursor:pointer;user-select:none;transition:background var(--transition)}
.section-header:hover{background:var(--surface-hover)}
.section-header.collapsed{border-bottom:none}
.section-chevron{color:var(--text-muted);transition:transform 250ms;flex-shrink:0;font-size:0.85em}
.section-header.collapsed .section-chevron{transform:rotate(-90deg)}
.section-name{font-weight:700;font-size:1rem;color:var(--text);flex:1;letter-spacing:-0.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.section-meta{font-size:0.72rem;color:var(--text-muted);white-space:nowrap;font-family:var(--font-mono)}
.section-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.hidden-badge{font-size:0.66rem;font-weight:700;padding:2px 9px;border-radius:999px;letter-spacing:0.04em;
  text-transform:uppercase;background:var(--surface-soft);color:var(--text-muted);border:1px solid var(--border)}

/* TILE GRID */
.tile-area{padding:18px}
.tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:14px}
.tile-card{background:var(--surface-soft);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:16px 14px;cursor:pointer;transition:all var(--transition);position:relative;
  display:flex;flex-direction:column;align-items:flex-start;gap:6px;
  text-decoration:none;color:var(--text);overflow:hidden}
.tile-card::before{content:"";position:absolute;inset:0;background:var(--gradient-subtle);opacity:0;transition:opacity var(--transition);pointer-events:none}
.tile-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(168,85,247,0.2) inset}
.tile-card:hover::before{opacity:1}
.tile-card>*{position:relative;z-index:1}
.tile-emoji{font-size:1.8em;line-height:1;margin-bottom:2px}
.tile-name{font-weight:600;font-size:0.88rem;color:var(--text);line-height:1.3;word-break:break-word}
.tile-url{font-size:0.68rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;width:100%;max-width:100%;font-family:var(--font-mono)}
.tile-actions{display:flex;gap:5px;position:absolute;top:8px;right:8px;
  opacity:0;transition:opacity var(--transition);pointer-events:none;z-index:2}
.tile-card:hover .tile-actions{opacity:1;pointer-events:all}

/* ADD TILE */
.add-tile-btn{display:flex;align-items:center;gap:8px;padding:14px 16px;
  border:1px dashed var(--border);border-radius:var(--radius-lg);color:var(--text-muted);
  font-size:0.84rem;font-weight:600;background:transparent;width:100%;
  cursor:pointer;transition:all var(--transition);justify-content:center;font-family:inherit}
.add-tile-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}

/* FORM INPUTS */
input[type=text],input[type=url],select,textarea{
  background:var(--bg);border:1px solid var(--border);color:var(--text);
  padding:9px 12px;border-radius:var(--radius);font-family:inherit;font-size:0.9em;
  transition:all var(--transition);width:100%}
input::placeholder,textarea::placeholder{color:var(--text-muted)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-glow)}

/* MODAL */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(15,17,21,0.75);
  z-index:1000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)}
.modal-bg.open{display:flex;animation:fadeIn 200ms ease-out}
@keyframes fadeIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
.modal-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);
  padding:26px;width:100%;max-width:480px;box-shadow:var(--shadow-lg)}
.modal-title{font-size:1.05rem;font-weight:700;margin-bottom:20px;letter-spacing:-0.01em}
.form-group{margin-bottom:14px}
.form-group label{display:block;font-size:0.76rem;font-weight:700;color:var(--text-secondary);
  margin-bottom:6px;letter-spacing:0.06em;text-transform:uppercase}
.btn-row{display:flex;gap:10px;margin-top:20px}
.btn-row .btn{flex:1;justify-content:center}

/* EMOJI PICKER */
.emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;
  max-height:160px;overflow-y:auto;margin-top:8px;padding:4px;background:var(--surface-soft);border-radius:var(--radius);border:1px solid var(--border)}
.emoji-opt{font-size:1.3em;padding:6px;border-radius:var(--radius-sm);cursor:pointer;text-align:center;
  background:transparent;border:2px solid transparent;transition:all var(--transition);line-height:1}
.emoji-opt:hover{background:var(--surface-hover)}
.emoji-opt.selected{background:var(--accent-soft);border-color:var(--accent)}

/* EMPTY STATE */
.empty-state{text-align:center;padding:60px 20px;color:var(--text-secondary)}
.empty-icon{font-size:2.5em;margin-bottom:12px;opacity:0.7}
.empty-title{font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:6px;letter-spacing:-0.01em}
.empty-sub{font-size:0.86rem;color:var(--text-muted)}

/* ANIMATION */
main{animation:slideUp 350ms ease-out}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
`;

const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23A855F7'/%3E%3Cstop offset='1' stop-color='%23EC4899'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Ctext x='16' y='21' font-family='Arial,sans-serif' font-weight='900' font-size='12' fill='white' text-anchor='middle'%3E111%3C/text%3E%3C/svg%3E`;

function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderHeader(username) {
    const id = 'cuw';
    const appsId = 'capps';
    return `
  <a href="/" style="text-decoration:none;display:flex;align-items:center;gap:10px;flex-shrink:0">
    <span style="width:36px;height:36px;background:linear-gradient(135deg,#A855F7,#EC4899);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.05em;color:#fff;text-shadow:0 0 12px rgba(255,255,255,.7),0 0 4px rgba(255,255,255,.95);flex-shrink:0;box-shadow:0 2px 8px rgba(168,85,247,.35),0 0 20px rgba(168,85,247,.45)">111</span>
    <div style="display:flex;flex-direction:column;line-height:1.25">
      <span style="font-weight:700;font-size:1.1em;color:#fff;letter-spacing:-.02em">111<span style="color:#A855F7;text-shadow:0 0 20px rgba(168,85,247,.5)">iridescence</span></span>
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
        <a href="/auth/admin" class="ddl">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Admin Panel
        </a>
        <div class="dd-sep"></div>
        <a href="/auth/logout" class="ddl out">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </a>
      </div>
    </div>
    <div class="user-wrap" id="${appsId}">
      <button class="user-btn" onclick="document.getElementById('${appsId}').classList.toggle('open')">
        Apps
        <svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="dd">
        <div class="dd-hdr">
          <div class="dd-name">Switch app</div>
          <div class="dd-sub">111iridescence webapps</div>
        </div>
        <a href="/" class="ddl">🏠 Hub</a>
        <a href="/vault" class="ddl">🔒 Vault</a>
        <a href="/habits" class="ddl">📈 Habits</a>
        <a href="/todo" class="ddl">✅ Todo</a>
        <a href="/courses" class="ddl">🎓 Courses</a>
        <a href="/editor" class="ddl">📝 Editor</a>
        <a href="/dashboard" class="ddl">📊 Dashboard</a>
        <a href="/feed" class="ddl">📰 Feed</a>
      </div>
    </div>
    <script>document.addEventListener('click',e=>{const w=document.getElementById('${id}');const a=document.getElementById('${appsId}');if(w&&!w.contains(e.target))w.classList.remove('open');if(a&&!a.contains(e.target))a.classList.remove('open');});<\/script>
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

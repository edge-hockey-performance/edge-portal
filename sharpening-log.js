/* Staff Sharpening Log (read-only).
 * Adds a "Sharpening Log" section to the staff Service Session page that lists
 * every logged sharpening, grouped into sessions by service date + location.
 * Reads public.sharpenings and portal_player_context with the signed-in staff
 * session (existing RLS applies). It performs no writes.
 */
(function () {
  'use strict';
  if (window.__edgeSharpeningLog) return;

  const host = document.getElementById('asub-service');
  if (!host || typeof initServiceSession !== 'function' || typeof completeServiceSession !== 'function') {
    console.warn('[EDGE] Sharpening log not installed: expected portal hooks missing.');
    return;
  }
  window.__edgeSharpeningLog = true;

  const PAGE = 1000;
  const state = {
    rows: [], players: null, range: '30', location: '', search: '',
    open: new Set(), loading: false, error: '', truncated: false, requestId: 0
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const localISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
  const fetchDb = (q, ms) => (typeof _dbFetch === 'function' ? _dbFetch(q, ms) : q);
  const longDate = (iso) => {
    if (!iso) return 'No date';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  const timeOf = (ts) => ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const condBadge = (c) => (typeof conditionBadge === 'function' && c) ? conditionBadge(c) : esc(c || '');
  const sessionKey = (r) => (r.date || '') + '|' + (r.location || '');
  const currentKey = () => {
    const d = document.getElementById('svc-date');
    const l = document.getElementById('svc-location');
    return (d && d.value ? d.value : '') + '|' + (l ? l.value : '');
  };
  const playerOf = (id) => (state.players && state.players.get(id)) || null;
  const playerName = (id) => {
    const p = playerOf(id);
    return p ? ((p.fname || '') + ' ' + (p.lname || '')).trim() || 'Unnamed player' : 'Unknown player';
  };

  // ── Styles ────────────────────────────────────────────────
  const style = document.createElement('style');
  style.id = 'edge-sharp-log-style';
  style.textContent = `
    #edge-sharp-log .esl-filters{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px}
    #edge-sharp-log .esl-filters .field{margin-bottom:0;min-width:150px;flex:1 1 150px}
    #edge-sharp-log .esl-summary{font-size:12px;color:var(--muted);margin-bottom:12px}
    #edge-sharp-log .esl-session{border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px;background:var(--bg-input)}
    #edge-sharp-log .esl-head{all:unset;box-sizing:border-box;display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;flex-wrap:wrap}
    #edge-sharp-log .esl-head:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:var(--radius)}
    #edge-sharp-log .esl-title{font-weight:700;font-size:14px;color:#fff}
    #edge-sharp-log .esl-meta{font-size:12px;color:var(--muted);margin-top:2px}
    #edge-sharp-log .esl-right{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
    #edge-sharp-log .esl-chev{transition:transform .15s ease;display:inline-block}
    #edge-sharp-log .esl-head[aria-expanded="true"] .esl-chev{transform:rotate(90deg)}
    #edge-sharp-log .esl-current{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);border:1px solid rgba(96,165,250,.4);border-radius:20px;padding:2px 8px}
    #edge-sharp-log .esl-body{border-top:1px solid var(--border);overflow-x:auto}
    #edge-sharp-log table{width:100%;border-collapse:collapse;font-size:12px;min-width:720px}
    #edge-sharp-log th{text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
    #edge-sharp-log td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--silver)}
    #edge-sharp-log tr:last-child td{border-bottom:0}
    #edge-sharp-log td.esl-player{color:#fff;font-weight:600;white-space:nowrap}
    #edge-sharp-log td.esl-notes{max-width:280px;color:var(--muted)}
    #edge-sharp-log .esl-sub{display:block;font-weight:400;color:var(--muted);font-size:11px;margin-top:2px}
    #edge-sharp-log .esl-empty{text-align:center;padding:28px;color:var(--muted);font-size:13px}
    #edge-sharp-log .esl-error{padding:10px 14px;border-radius:var(--radius);background:rgba(240,82,82,.1);color:var(--red);font-size:13px;margin-bottom:12px}
    @media (prefers-reduced-motion: reduce){#edge-sharp-log .esl-chev{transition:none}}
  `;
  document.head.appendChild(style);

  // ── Markup ────────────────────────────────────────────────
  const section = document.createElement('div');
  section.className = 'section';
  section.id = 'edge-sharp-log';
  section.innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div class="section-title">Sharpening Log</div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-ghost btn-sm" id="esl-refresh">Refresh</button>
        <button type="button" class="btn btn-ghost btn-sm" id="esl-export">Export CSV</button>
      </div>
    </div>
    <div class="card card-body">
      <div style="font-size:12px;color:var(--muted);margin:-4px 0 14px;">Every sharpening logged by staff, grouped by service date and location. Newest first.</div>
      <div class="esl-filters">
        <div class="field"><label for="esl-range">Date Range</label>
          <select id="esl-range">
            <option value="7">Last 7 days</option>
            <option value="30" selected>Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
            <option value="all">All time</option>
          </select></div>
        <div class="field"><label for="esl-location">Location</label>
          <select id="esl-location"><option value="">All Locations</option></select></div>
        <div class="field"><label for="esl-search">Search Player</label>
          <input type="text" id="esl-search" placeholder="Name…" autocomplete="off" style="font-size:13px;"/></div>
      </div>
      <div id="esl-error" class="esl-error" style="display:none;" role="alert"></div>
      <div id="esl-summary" class="esl-summary" aria-live="polite"></div>
      <div id="esl-list"><div class="esl-empty">Loading sharpening log…</div></div>
    </div>`;
  host.appendChild(section);

  const $ = (id) => document.getElementById(id);

  // ── Data ──────────────────────────────────────────────────
  async function loadPlayers() {
    if (state.players) return;
    const res = await fetchDb(sb.from('portal_player_context')
      .select('id,fname,lname,organization,team'), 12000);
    if (res && res.error) throw res.error;
    state.players = new Map(((res && res.data) || []).map((p) => [p.id, p]));
  }

  async function load(opts) {
    if (typeof sb === 'undefined' || !sb) return;
    const myId = ++state.requestId;
    state.loading = true;
    state.error = '';
    if (!state.rows.length) $('esl-list').innerHTML = '<div class="esl-empty">Loading sharpening log…</div>';
    try {
      if (opts && opts.refreshPlayers) state.players = null;
      await loadPlayers();
      let q = sb.from('sharpenings')
        .select('id,player_id,date,location,hollow,condition,notes,steel_set,created_at,rating_steel_health,rating_blade_height,rating_edge_condition,rating_profile_shape')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, PAGE - 1);
      if (state.range !== 'all') q = q.gte('date', daysAgo(Number(state.range)));
      const res = await fetchDb(q, 15000);
      if (myId !== state.requestId) return;
      if (res && res.error) throw res.error;
      state.rows = (res && res.data) || [];
      state.truncated = state.rows.length >= PAGE;
    } catch (e) {
      if (myId !== state.requestId) return;
      console.error('[EDGE] sharpening log load error:', e);
      state.error = 'Could not load the sharpening log. ' + ((e && e.message) || 'Please try again.');
    } finally {
      if (myId === state.requestId) { state.loading = false; render(); }
    }
  }

  function filteredRows() {
    const s = state.search.toLowerCase().trim();
    return state.rows.filter((r) => {
      if (state.location && (r.location || '') !== state.location) return false;
      if (s && !playerName(r.player_id).toLowerCase().includes(s)) return false;
      return true;
    });
  }

  function groupSessions(rows) {
    const map = new Map();
    for (const r of rows) {
      const k = sessionKey(r);
      if (!map.has(k)) map.set(k, { key: k, date: r.date, location: r.location || 'No location', rows: [] });
      map.get(k).rows.push(r);
    }
    const sessions = [...map.values()];
    for (const s of sessions) {
      s.rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      s.players = new Set(s.rows.map((r) => r.player_id)).size;
      s.last = s.rows[0] && s.rows[0].created_at;
      s.first = s.rows[s.rows.length - 1] && s.rows[s.rows.length - 1].created_at;
    }
    sessions.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) ||
      String(b.last || '').localeCompare(String(a.last || '')));
    return sessions;
  }

  // ── Render ────────────────────────────────────────────────
  function renderLocations() {
    const sel = $('esl-location');
    const locs = [...new Set(state.rows.map((r) => r.location).filter(Boolean))].sort();
    if (state.location && !locs.includes(state.location)) locs.push(state.location);
    sel.innerHTML = '<option value="">All Locations</option>' +
      locs.map((l) => `<option value="${esc(l)}"${l === state.location ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }

  function ratings(r) {
    const parts = [['SH', r.rating_steel_health, 'Steel health'], ['BH', r.rating_blade_height, 'Blade height'],
      ['EC', r.rating_edge_condition, 'Edge condition'], ['PS', r.rating_profile_shape, 'Profile shape']]
      .filter((p) => p[1] != null);
    if (!parts.length) return '<span style="color:var(--dim)">—</span>';
    return parts.map((p) => `<span title="${p[2]}">${p[0]} ${esc(p[1])}</span>`).join(' · ');
  }

  function rowHtml(r) {
    const p = playerOf(r.player_id);
    const sub = p ? [p.organization, p.team].filter(Boolean).join(' · ') : '';
    return `<tr>
      <td style="white-space:nowrap;">${esc(timeOf(r.created_at)) || '—'}</td>
      <td class="esl-player">${esc(playerName(r.player_id))}${sub ? `<span class="esl-sub">${esc(sub)}</span>` : ''}</td>
      <td>${r.steel_set ? 'Set ' + esc(r.steel_set) : '—'}</td>
      <td style="white-space:nowrap;">${esc(r.hollow || '—')}</td>
      <td>${condBadge(r.condition)}</td>
      <td style="white-space:nowrap;">${ratings(r)}</td>
      <td class="esl-notes">${esc(r.notes || '')}</td>
    </tr>`;
  }

  function render() {
    renderLocations();
    const errEl = $('esl-error');
    errEl.style.display = state.error ? 'block' : 'none';
    errEl.textContent = state.error;

    const rows = filteredRows();
    const sessions = groupSessions(rows);
    const cur = currentKey();
    if (!state.open.size && sessions.length) state.open.add(sessions[0].key);

    const playerCount = new Set(rows.map((r) => r.player_id)).size;
    $('esl-summary').textContent = state.loading && !state.rows.length ? '' :
      `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${rows.length} sharpening${rows.length === 1 ? '' : 's'} · ${playerCount} player${playerCount === 1 ? '' : 's'}` +
      (state.truncated ? ` · Showing the newest ${PAGE} records. Narrow the date range to see older ones.` : '');

    const list = $('esl-list');
    if (!sessions.length) {
      list.innerHTML = state.error ? '' : '<div class="esl-empty">No sharpenings logged for these filters.</div>';
      return;
    }
    list.innerHTML = sessions.map((s, i) => {
      const open = state.open.has(s.key);
      const span = s.first && s.last && timeOf(s.first) !== timeOf(s.last)
        ? `Logged ${esc(timeOf(s.first))} to ${esc(timeOf(s.last))}` : (s.last ? `Logged ${esc(timeOf(s.last))}` : '');
      const bodyId = 'esl-body-' + i;
      return `<div class="esl-session">
        <button type="button" class="esl-head" data-key="${esc(s.key)}" aria-expanded="${open}" aria-controls="${bodyId}">
          <div>
            <div class="esl-title">${esc(longDate(s.date))} · ${esc(s.location)}</div>
            <div class="esl-meta">${s.rows.length} sharpening${s.rows.length === 1 ? '' : 's'} · ${s.players} player${s.players === 1 ? '' : 's'}${span ? ' · ' + span : ''}</div>
          </div>
          <div class="esl-right">${s.key === cur ? '<span class="esl-current">Current session</span>' : ''}<span class="esl-chev" aria-hidden="true">›</span></div>
        </button>
        <div class="esl-body" id="${bodyId}"${open ? '' : ' hidden'}>
          <table>
            <thead><tr><th>Time</th><th>Player</th><th>Steel</th><th>Hollow</th><th>Condition</th><th>Ratings</th><th>Notes</th></tr></thead>
            <tbody>${s.rows.map(rowHtml).join('')}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');
  }

  function exportCsv() {
    const rows = filteredRows();
    if (!rows.length) return;
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['Service Date', 'Location', 'Logged At', 'Player', 'Organization', 'Team', 'Steel Set', 'Hollow',
      'Condition', 'Steel Health', 'Blade Height', 'Edge Condition', 'Profile Shape', 'Notes'];
    const lines = [header.join(',')].concat(rows.map((r) => {
      const p = playerOf(r.player_id) || {};
      return [r.date, r.location, r.created_at ? new Date(r.created_at).toLocaleString('en-US') : '', playerName(r.player_id),
        p.organization, p.team, r.steel_set, r.hollow, r.condition, r.rating_steel_health, r.rating_blade_height,
        r.rating_edge_condition, r.rating_profile_shape, r.notes].map(cell).join(',');
    }));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'edge-sharpening-log-' + localISO(new Date()) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Events ────────────────────────────────────────────────
  $('esl-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.esl-head');
    if (!btn) return;
    const key = btn.getAttribute('data-key');
    if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
    const open = state.open.has(key);
    btn.setAttribute('aria-expanded', String(open));
    const body = document.getElementById(btn.getAttribute('aria-controls'));
    if (body) body.hidden = !open;
  });
  $('esl-range').addEventListener('change', (e) => { state.range = e.target.value; load(); });
  $('esl-location').addEventListener('change', (e) => { state.location = e.target.value; render(); });
  $('esl-search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  $('esl-refresh').addEventListener('click', () => load({ refreshPlayers: true }));
  $('esl-export').addEventListener('click', exportCsv);
  ['svc-date', 'svc-location'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { if (state.rows.length) render(); });
  });

  // ── Hooks into existing Service Session flow ──────────────
  const originalInit = initServiceSession;
  initServiceSession = function () {
    const result = originalInit.apply(this, arguments);
    load({ refreshPlayers: true });
    return result;
  };

  const originalComplete = completeServiceSession;
  completeServiceSession = async function () {
    try {
      return await originalComplete.apply(this, arguments);
    } finally {
      state.open.add(currentKey());
      load();
    }
  };
})();

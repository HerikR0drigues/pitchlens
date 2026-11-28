// Pitchlens - compare players, best XI, progress history and notes.
// Loaded before app.js; uses its helpers ($, t, esc, avatar, rating, store, ALL, BY_UID, F, META...) only inside functions.
'use strict';

const CMP_MAX = 3, HIST_MAX = 80, RECENT_MAX = 150;
let CMP = [], HIST = {}, NOTES = {}, RECENT = [];

function toolsInit() {
  CMP = (store('cmp') || []).filter(Number.isFinite).slice(0, CMP_MAX);
  HIST = store('hist') || {};
  NOTES = store('notes') || {};
  RECENT = (store('recent') || []).filter(Number.isFinite).slice(-RECENT_MAX);
}

// ------------------------------------------------------------------ panel (big overlay used by compare and best XI)
function openPanel(html, wide) {
  const el = $('#panel'); el.innerHTML = html; el.classList.toggle('wide', !!wide);
  el.classList.add('on'); $('#shade').classList.add('on');
  el.querySelector('[data-close]')?.addEventListener('click', closePanel);
}
function closePanel() { $('#panel').classList.remove('on'); if (!$('#drawer').classList.contains('on')) $('#shade').classList.remove('on'); }
const panelHead = (title, extra = '') => `<div class="ph"><h3>${esc(title)}</h3>${extra}<button class="btn icon" data-close title="${esc(t('close'))}">✕</button></div>`;

// ------------------------------------------------------------------ compare
function inCompare(uid) { return CMP.includes(uid); }
function toggleCompare(uid) {
  const i = CMP.indexOf(uid);
  if (i >= 0) CMP.splice(i, 1);
  else { if (CMP.length >= CMP_MAX) CMP.shift(); CMP.push(uid); toast(t('cmpAdded')); }
  store('cmp', CMP); renderCmpBar();
  const b = $('#dcmp'); if (b) b.classList.toggle('on', inCompare(uid));
}
function renderCmpBar() {
  const bar = $('#cmpbar'), ps = CMP.map(u => BY_UID.get(u)).filter(Boolean);
  bar.classList.toggle('on', ps.length > 0);
  if (!ps.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<span class="lbl">${esc(t('compare'))}</span>` +
    ps.map(p => `<span class="chip">${avatar(p)}<span>${esc(p.name)}</span><button data-rm="${p.uid}" title="${esc(t('remove'))}">✕</button></span>`).join('') +
    `<button class="btn primary" id="cmpGo" ${ps.length < 2 ? 'disabled' : ''}>${esc(t('compareGo'))}</button><button class="link" id="cmpClear">${esc(t('clear'))}</button>`;
  bar.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => toggleCompare(+b.dataset.rm));
  $('#cmpGo').onclick = openCompare;
  $('#cmpClear').onclick = () => { CMP = []; store('cmp', CMP); renderCmpBar(); };
}
function openCompare() {
  const ps = CMP.map(u => BY_UID.get(u)).filter(Boolean);
  if (ps.length < 2) return;
  const gk = ps.every(p => (p.pos[0] || 0) >= 15);
  const ageOf = p => p.birth_year ? gameYear() - p.birth_year : 0;
  // one row: label + one value per player; best value (max, or min when lowerBetter) is highlighted
  const row = (label, vals, show = v => v, lowerBetter = false, cls = '') => {
    const nums = vals.map(v => typeof v === 'number' ? v : null).filter(v => v !== null && v > 0);
    const best = nums.length > 1 ? (lowerBetter ? Math.min(...nums) : Math.max(...nums)) : null;
    const tie = nums.filter(v => v === best).length === nums.length;
    return `<div class="crow ${cls}"><span class="cl">${esc(label)}</span>${vals.map(v => `<span class="cv ${best !== null && !tie && v === best ? 'best' : ''}">${show(v)}</span>`).join('')}</div>`;
  };
  const roles = [...new Set(ps.flatMap(p => topRoles(p, 3).map(r => r[0])))];
  const groups = (gk ? ['goalkeeping', 'mental', 'physical'] : ['technical', 'mental', 'physical']).filter(g => GROUPS[g]);
  const A = ps.map(attrsOf);
  const html = panelHead(t('compare')) + `<div class="cmp" style="--n:${ps.length}">
    <div class="crow head"><span class="cl"></span>${ps.map(p => `<span class="cv"><button class="chead" data-uid="${p.uid}">${avatar(p)}<b>${esc(p.name)}</b><span class="sub">${ageOf(p) || '—'} · ${esc(p.club || t('free'))}</span></button></span>`).join('')}</div>
    <div class="csec">${esc(t('overview'))}</div>
    ${row('CA', ps.map(p => p.ca), v => rating(v))}
    ${row('PA', ps.map(p => p.pa), v => rating(v))}
    ${row(t('th_age'), ps.map(ageOf), v => v || '—', true)}
    ${row(t('wage'), ps.map(p => p.wage || 0), v => v ? esc(money(perMonth() ? v * 52 / 12 : v)) : '—', true)}
    ${row(t('estValue'), ps.map(p => estValue({...p, age: p.birth_year ? gameYear() - p.birth_year : 0}) || 0), v => v ? esc(money(v)) : '—', true)}
    ${row(t('releaseClause'), ps.map(p => p.release || 0), v => v ? esc(money(v)) : '—', true)}
    ${row(t('contractEnds'), ps.map(p => p.contract_year || 0), v => v || esc(t('free')))}
    <div class="csec">${esc(t('roles'))}</div>
    ${roles.map(id => row(roleName(id), ps.map(p => roleRating(p, ROLE_BY_ID[id])), v => rating100(v))).join('')}
    ${groups.map(g => `<div class="csec">${esc(t('g_' + g))}</div>` + GROUPS[g].map(i => [attrName(i), i]).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([n, i]) => row(n, A.map(a => a[i]), v => `<b style="color:${tone20(v)}">${v}</b>`, false, 'attr')).join('')).join('')}
  </div>`;
  openPanel(html, ps.length > 2);
  $$('#panel .chead').forEach(b => b.onclick = () => { closePanel(); openPlayer(+b.dataset.uid); });
}

// ------------------------------------------------------------------ best XI
// [position index (fmreader.POSITIONS), role id]
const FORMATIONS = {
  '4-3-3': [[0, 'gk'], [4, 'fb'], [3, 'cd'], [3, 'bpd'], [2, 'fb'], [5, 'dm'], [7, 'b2b'], [7, 'ap'], [11, 'if'], [9, 'if'], [12, 'af']],
  '4-2-3-1': [[0, 'gk'], [4, 'fb'], [3, 'cd'], [3, 'bpd'], [2, 'fb'], [5, 'dm'], [5, 'dlp'], [11, 'w'], [10, 'am'], [9, 'iw'], [12, 'af']],
  '4-4-2': [[0, 'gk'], [4, 'fb'], [3, 'cd'], [3, 'cd'], [2, 'fb'], [8, 'w'], [7, 'b2b'], [7, 'dlp'], [6, 'w'], [12, 'af'], [12, 'tf']],
  '3-5-2': [[0, 'gk'], [3, 'cd'], [3, 'bpd'], [3, 'cd'], [14, 'wb'], [5, 'dm'], [7, 'b2b'], [7, 'ap'], [13, 'wb'], [12, 'af'], [12, 'pf']],
  '5-3-2': [[0, 'gk'], [14, 'wb'], [3, 'cd'], [3, 'bpd'], [3, 'cd'], [13, 'wb'], [7, 'b2b'], [5, 'dlp'], [7, 'mez'], [12, 'af'], [12, 'tf']],
};
// vertical position (%) of each line on the best-XI pitch, spaced so cards never overlap
const XI_Y = {0: 91, 1: 84, 2: 70, 3: 76, 4: 70, 5: 59, 6: 44, 7: 44, 8: 44, 9: 27, 10: 28, 11: 27, 12: 10, 13: 58, 14: 58};
const posFit = f => f >= 18 ? 1 : f >= 15 ? .95 : f >= 10 ? .85 : .7;
const slotRating = (p, role, pos) => Math.round(roleRaw(p, ROLE_BY_ID[role]) * posFit(p.pos[pos] || 1));

// greedy assignment: best (player, slot) pairs first
function pickXI(pool, slots, taken = new Set()) {
  const pairs = [];
  slots.forEach(([pos, role], s) => pool.forEach(p => { if (!taken.has(p.uid)) pairs.push([slotRating(p, role, pos), s, p]); }));
  pairs.sort((a, b) => b[0] - a[0]);
  const out = new Array(slots.length).fill(null), used = new Set(taken);
  for (const [v, s, p] of pairs) { if (out[s] || used.has(p.uid)) continue; out[s] = [p, v]; used.add(p.uid); }
  return out;
}
function slotXY(slots) {
  const byPos = {}; slots.forEach(([pos], i) => (byPos[pos] = byPos[pos] || []).push(i));
  const xy = []; const spread = {1: [50], 2: [36, 64], 3: [24, 50, 76]};
  Object.entries(byPos).forEach(([pos, idx]) => idx.forEach((s, k) => {
    const [x] = PXY[pos]; xy[s] = [idx.length > 1 ? spread[idx.length][k] : x, XI_Y[pos]];
  }));
  return xy;
}
function clubPool(club) {
  if (club === '__fav') return [...FAV].map(u => BY_UID.get(u)).filter(Boolean);
  // players on loan count for the club they are playing for
  return ALL.filter(p => (p.loan_club ? p.loan_club === club : p.club === club) && !p.female === (F.sex !== 'F'));
}
function openBestXI() {
  if (!ALL.length) return toast(t('loading'));
  const clubs = [...new Set(ALL.map(p => p.club).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const st = store('xi') || {}, club = st.club || '', form = FORMATIONS[st.form] ? st.form : '4-3-3';
  const head = panelHead(t('bestXI'), `<div class="xictl"><input id="xiClub" list="xiClubs" placeholder="${esc(t('xiClubPh'))}" value="${esc(club === '__fav' ? t('sit_fav') : club)}" autocomplete="off">
    <datalist id="xiClubs"><option value="${esc(t('sit_fav'))}">${clubs.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="seg" id="xiForm">${Object.keys(FORMATIONS).map(f => `<button data-v="${f}" class="${f === form ? 'on' : ''}">${f}</button>`).join('')}</div></div>`);
  openPanel(head + `<div id="xiBody"></div>`, true);
  const draw = () => {
    const raw = $('#xiClub').value.trim(), c = raw === t('sit_fav') ? '__fav' : raw, f = $('#xiForm .on').dataset.v;
    store('xi', {club: c, form: f});
    $('#xiBody').innerHTML = renderXI(c, f);
    $$('#xiBody [data-uid]').forEach(b => b.onclick = () => openPlayer(+b.dataset.uid));
    $$('#xiBody [data-find]').forEach(b => b.onclick = () => {
      const [pos, role] = b.dataset.find.split(':');
      Object.assign(F, {q: '', sit: 'all', list: '', role, pos: [+pos], posMin: 15, sort: 'role', dir: -1});
      closePanel(); sync(); apply(); toast(t('xiSearching', {r: roleName(role)}));
    });
  };
  $('#xiClub').onchange = draw;
  $$('#xiForm button').forEach(b => b.onclick = () => { $$('#xiForm button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}
function renderXI(club, form) {
  if (!club) return `<div class="empty">${esc(t('xiPick'))}</div>`;
  const pool = clubPool(club).filter(p => p.a);
  if (pool.length < 11) return `<div class="empty">${esc(t('xiFew', {n: pool.length}))}</div>`;
  const slots = FORMATIONS[form], xi = pickXI(pool, slots), xy = slotXY(slots);
  const bench = pickXI(pool, slots, new Set(xi.filter(Boolean).map(x => x[0].uid)));
  const vals = xi.map(x => x ? x[1] : 0), avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const weak = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]);
  const card = (s) => {
    const [pos, role] = slots[s], x = xi[s], b = bench[s];
    if (!x) return '';
    const [p, v] = x;
    return `<div class="xis ${weak.includes(s) ? 'weak' : ''}" style="left:${xy[s][0]}%;top:${xy[s][1]}%">
      <button data-uid="${p.uid}">${avatar(p)}<span class="xn">${esc(p.name.split(' ').slice(-1)[0])} <b class="xr" style="color:${tone(v, 100)}">${v}</b></span></button>
      <span class="xrole">${esc(posName(pos))} · ${esc(roleName(role))}</span>
      ${b ? `<span class="xb" title="${esc(t('xiBackup'))}">↳ ${esc(b[0].name.split(' ').slice(-1)[0])} ${b[1]}</span>` : ''}</div>`;
  };
  return `<div class="xi">
    <div class="xipitch">${pitchLines()}${slots.map((_, s) => card(s)).join('')}</div>
    <div class="xiside">
      <div class="card"><h4>${esc(t('xiAvg'))}</h4><div class="xiavg" style="color:${tone(avg, 100)}">${avg}</div>
        <div class="sub">${esc(t('xiPool', {n: pool.length}))}</div></div>
      <div class="card"><h4>${esc(t('xiWeak'))}</h4>${weak.map(s => {
        const [pos, role] = slots[s], x = xi[s];
        return `<div class="xiw"><span><b>${esc(posName(pos))} · ${esc(roleName(role))}</b><span class="sub">${x ? esc(x[0].name) + ' · ' + x[1] : '—'}</span></span>
          <button class="btn" data-find="${pos}:${role}">${esc(t('xiFind'))}</button></div>`;
      }).join('')}</div>
      <div class="note">ⓘ ${esc(t('xiNote'))}</div>
    </div></div>`;
}

// ------------------------------------------------------------------ progress history (CA/PA per in-game date, kept in this browser)
const gameKey = () => META?.game_year ? META.game_year * 1000 + (META.game_day || 0) : 0;
const keyDate = k => new Date(Math.floor(k / 1000), 0, k % 1000 || 1);
function trackPoint(p) {
  const k = gameKey(); if (!k || !p) return;
  const h = HIST[p.uid] || (HIST[p.uid] = []), last = h[h.length - 1];
  if (last && last[0] === k) { last[1] = p.ca; last[2] = p.pa; }
  else if (!last || last[0] < k) h.push([k, p.ca, p.pa]);
  if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX);
}
function recordHistory() {
  new Set([...FAV, ...RECENT, ...CMP]).forEach(u => trackPoint(BY_UID.get(u)));
  store('hist', HIST);
}
function noteRecent(uid) {
  RECENT = RECENT.filter(u => u !== uid); RECENT.push(uid); if (RECENT.length > RECENT_MAX) RECENT.shift();
  store('recent', RECENT); trackPoint(BY_UID.get(uid)); store('hist', HIST);
}
function progDelta(p) { const h = HIST[p.uid]; return h && h.length > 1 ? p.ca - h[0][1] : null; }
function progTag(p) {
  const d = progDelta(p); if (!d) return '';
  return `<span class="prog ${d > 0 ? 'up' : 'down'}" title="${esc(t('progTip', {d: keyDate(HIST[p.uid][0][0]).toLocaleDateString(LANG() === 'pt' ? 'pt-BR' : 'en-GB')}))}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
}
function historyCard(uid) {
  const h = HIST[uid] || [], loc = LANG() === 'pt' ? 'pt-BR' : 'en-GB';
  if (!h.length) return '';
  if (h.length < 2) return `<div class="card"><h4>${esc(t('progress'))}</h4><div class="sub">${esc(t('progSince', {d: keyDate(h[0][0]).toLocaleDateString(loc)}))}</div></div>`;
  const W = 540, H = 120, lo = Math.max(0, Math.min(...h.map(x => x[1])) - 10), hi = Math.min(200, Math.max(...h.map(x => x[2])) + 10);
  const X = i => 10 + i * (W - 20) / (h.length - 1), Y = v => H - 14 - (v - lo) / Math.max(1, hi - lo) * (H - 28);
  const line = k => h.map((x, i) => `${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join(' ');
  const d = h[h.length - 1][1] - h[0][1];
  return `<div class="card"><h4>${esc(t('progress'))} <span class="prog ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'}${Math.abs(d)} CA</span></h4>
    <svg viewBox="0 0 ${W} ${H}" width="100%" class="hist2" role="img">
      <polyline points="${line(2)}" fill="none" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="4 4"/>
      <polyline points="${line(1)}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
      ${h.map((x, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(x[1]).toFixed(1)}" r="3" fill="var(--accent)"><title>${keyDate(x[0]).toLocaleDateString(loc)} · CA ${x[1]} · PA ${x[2]}</title></circle>`).join('')}
    </svg>
    <div class="row2 sub"><span>${keyDate(h[0][0]).toLocaleDateString(loc)} · CA ${h[0][1]}</span><span>${keyDate(h[h.length - 1][0]).toLocaleDateString(loc)} · CA ${h[h.length - 1][1]}</span></div>
    <div class="sub">${esc(t('progLegend'))}</div></div>`;
}

// ------------------------------------------------------------------ notes
function noteCard(uid) {
  return `<div class="card"><h4>${esc(t('notes'))}</h4><textarea id="dnote" class="notes" rows="3" placeholder="${esc(t('notesPh'))}">${esc(NOTES[uid] || '')}</textarea></div>`;
}
function wireNote(uid) {
  const el = $('#dnote'); if (!el) return; let tm;
  el.oninput = () => { clearTimeout(tm); tm = setTimeout(() => {
    const v = el.value.trim(); if (v) NOTES[uid] = v; else delete NOTES[uid];
    store('notes', NOTES); const p = BY_UID.get(uid); if (p) p._note = v ? norm(v) : '';
  }, 300); };
}
const noteTag = p => NOTES[p.uid] ? `<span class="noteic" title="${esc(NOTES[p.uid])}">✎</span>` : '';
const noteMatch = (p, q) => { if (!NOTES[p.uid]) return false; if (p._note === undefined) p._note = norm(NOTES[p.uid]); return p._note.includes(q); };

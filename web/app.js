// Pitchlens - UI logic (no dependencies). Data comes from the local server (scout.py).
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const URLP = new URLSearchParams(location.search);

// ---------- positions (indexes follow fmreader.POSITIONS)
// grid on the mini pitch: [column 1..5, row 1..7], attack on top
const GRID = {12:[3,1],9:[1,2],10:[3,2],11:[5,2],6:[1,3],7:[3,3],8:[5,3],13:[1,4],5:[3,4],14:[5,4],2:[1,5],3:[3,5],4:[5,5],1:[3,6],0:[3,7]};
const PXY = {0:[50,92],1:[50,80],2:[14,70],3:[50,70],4:[86,70],13:[14,56],14:[86,56],5:[50,57],6:[14,41],7:[50,42],8:[86,41],9:[17,26],10:[50,26],11:[83,26],12:[50,10]};
const SIT = [['free','sit_free','#22c55e'],['ending','sit_end','#a78bfa'],['transfer','sit_tl','#f59e0b'],['loan','sit_ll','#38bdf8'],['pre','sit_pre','#f472b6'],['onloan','sit_onloan','#2dd4bf'],['fav','sit_fav','#facc15'],['all','sit_all','#64748b']];
const RANGES = [['rCA','ca','ca',0,200],['rPA','pa','pa',0,200],['rGAP','gap','gap',0,120],['rAGE','age','age',14,45]];
const RADAR = {
  field: [['ax_finishing',[2,4,6]],['ax_technique',[23,1,22]],['ax_creativity',[7,10,26,18]],['ax_defending',[9,5,20,17]],
          ['ax_speed',[38,34,46]],['ax_physical',[36,37,50,39]],['ax_mental',[51,29,28,52]]],
  gk:    [['ax_reflexes',[21,19]],['ax_handling',[11,33]],['ax_aerial',[12,13,39]],['ax_distribution',[15,16,7]],
          ['ax_mental',[53,18,52,20]],['ax_physical',[46,36,50]]],
};
const DEF = {q:'',sit:'free',nat:'',sex:'M',foot:'',pos:[],posMin:15,ca:[0,200],pa:[0,200],gap:[0,120],age:[15,40],
             year:null,sort:'ca',dir:-1,theme:null,lang:null,role:'',list:'',cur:null,per:null};
// ready-made lists: filter overrides + an extra rule
const LISTS = {
  prospects: {sit: 'all', age: [15, 21], pa: [140, 200], ca: [0, 200], gap: [0, 120], sort: 'pa', dir: -1},
  freeBest: {sit: 'free', age: [18, 33], ca: [0, 200], pa: [0, 200], gap: [0, 120], sort: 'ca', dir: -1},
  bargains: {sit: 'all', age: [18, 29], ca: [0, 200], pa: [0, 200], gap: [0, 120], sort: 'bargain', dir: -1},
  release: {sit: 'all', age: [15, 40], ca: [0, 200], pa: [0, 200], gap: [0, 120], sort: 'ca', dir: -1},
};
const LIST_RULE = {bargains: p => !p.free && p.wage > 0, release: p => p.release > 0};
// money is stored in GBP; rates are approximate (BRL matches FM27's own rate)
const CUR = {GBP: ['£', 1], EUR: ['€', 1.17], USD: ['$', 1.27], BRL: ['R$', 6.951]};
const SQUAD = {1: 'sq_star', 2: 'sq_important', 3: 'sq_regular', 4: 'sq_squad', 5: 'sq_impact', 7: 'sq_fringe', 10: 'sq_hot', 11: 'sq_young', 15: 'sq_gk1'};
const NOPHOTO = new URLSearchParams(location.search).get('photos') === '0';

let F = Object.assign({}, DEF, store('filters') || {});
if (!Array.isArray(F.pos) || F.pos.some(p => typeof p !== 'number')) F.pos = [];
if (![18,15,10].includes(+F.posMin)) F.posMin = 15;
if (!['','L','R','B'].includes(F.foot)) F.foot = '';
let FAV = new Set(store('fav') || []);
let ALL = [], VIEW = [], BASE = [], META = null, shown = 0, lastErr = null, BY_UID = new Map(), GROUPS = {};
if (!ROLE_BY_ID[F.role]) F.role = ''; if (!LISTS[F.list]) F.list = '';
const PAGE = 200;

// ---------- helpers
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('pitchlens.' + k) ?? localStorage.getItem('fm27scout.' + k)); localStorage.setItem('pitchlens.' + k, JSON.stringify(v)); } catch { return null; } }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LANG = () => F.lang || 'en';
const t = (k, vars) => { let s = (I18N[LANG()] || I18N.en)[k] ?? I18N.en[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
const fmt = n => Number(n).toLocaleString(LANG() === 'pt' ? 'pt-BR' : 'en-US');
const posName = i => POS_NAMES[LANG()][i];
const attrName = i => ATTR_NAMES[LANG()][i];
const gameYear = () => +F.year || META?.game_year || new Date().getFullYear();
function tone(v, max = 200) { const r = v / max; return r >= .75 ? '#22c55e' : r >= .6 ? '#84cc16' : r >= .5 ? '#eab308' : r >= .4 ? '#f97316' : '#ef4444'; }
const tone20 = v => tone(v, 20);
const curCode = () => CUR[F.cur] ? F.cur : (LANG() === 'pt' ? 'BRL' : 'GBP');
const perMonth = () => F.per ? F.per === 'm' : curCode() === 'BRL';
function money(gbp) {
  if (!gbp) return '—';
  const [sym, rate] = CUR[curCode()], v = gbp * rate, pt = LANG() === 'pt';
  const f = (n, d) => n.toLocaleString(pt ? 'pt-BR' : 'en-US', {maximumFractionDigits: d});
  const txt = v >= 1e6 ? f(v / 1e6, v >= 1e7 ? 1 : 2) + (pt ? ' mi' : 'M') : v >= 1e3 ? f(v / 1e3, v >= 1e5 ? 0 : 1) + (pt ? ' mil' : 'K') : f(v, 0);
  return sym + ' ' + txt;
}
const wageOf = p => p.wage ? (perMonth() ? p.wage * 52 / 12 : p.wage) : 0;
const wageTxt = p => p.wage ? money(wageOf(p)) + (perMonth() ? t('perMonth') : t('perWeek')) : '—';
const rating100 = v => { const c = tone(v, 100); return `<span class="rating" style="background:${c}1f;color:${c}">${v ?? '—'}</span>`; };
const rating = v => { const c = tone(v); return `<span class="rating" style="background:${c}1f;color:${c}">${v}</span>`; };
function initials(n) { const w = String(n).split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
function avatar(p) {
  const h = (p.uid * 47) % 360, img = p.photo && !NOPHOTO ? `<img src="/api/face?uid=${p.uid}" alt="" loading="lazy" decoding="async" onload="faceOk(this)" onerror="faceFail(this)">` : '';
  return `<div class="av" style="--h1:hsl(${h} 58% 46%);--h2:hsl(${(h + 40) % 360} 62% 36%)"><span>${esc(initials(p.name))}</span>${img}</div>`;
}
function faceOk(img) { img.parentNode.classList.add('ph'); }
function faceFail(img) { img.style.display = 'none'; }
const natural = p => p.pos.map((v, i) => [v, i]).filter(x => x[0] >= 15).sort((a, b) => b[0] - a[0]);
const FOOT_LBL = {L: ['L', 'E'], R: ['R', 'D'], B: ['B', 'A']};
function footTag(p) { const f = FOOT_LBL[p.foot]; if (!f) return ''; const title = {L: t('left'), R: t('right'), B: t('both')}[p.foot]; return `<span class="pt foot" title="${esc(title)}">${LANG() === 'pt' ? f[1] : f[0]}</span>`; }
function preDate(p) { if (!p.pre_year) return ''; if (!p.pre_day) return String(p.pre_year); const d = new Date(p.pre_year, 0, p.pre_day); return d.toLocaleDateString(LANG() === 'pt' ? 'pt-BR' : 'en-GB'); }
function preTag(p) { return p.pre_club ? `<span class="tag pre" title="${esc(t('preTitle', {c: p.pre_club, d: preDate(p)}))}">→ ${esc(p.pre_club)}</span>` : ''; }
function loanTag(p) { return p.loan_club ? `<span class="tag onloan" title="${esc(t('onLoanTitle', {c: p.loan_club}))}">${esc(t('onLoanShort'))} ${esc(p.loan_club)}</span>` : ''; }
function listTags(p) { return loanTag(p) + preTag(p) + (p.transfer_listed ? `<span class="tag tl">${LANG() === 'pt' ? 'Transf.' : 'TL'}</span>` : '') + (p.loan_listed ? `<span class="tag ll">${LANG() === 'pt' ? 'Empr.' : 'LL'}</span>` : ''); }
const STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.tm); toast.tm = setTimeout(() => el.classList.remove('on'), 1600); }
function gameDateText() {
  if (!META?.game_year) return '';
  const d = new Date(META.game_year, 0, META.game_day || 1);
  return `${d.getDate()} ${MONTHS[LANG()][d.getMonth()]} ${d.getFullYear()}`;
}

// ---------- i18n + theme
function applyLang() {
  document.documentElement.lang = LANG() === 'pt' ? 'pt-BR' : 'en';
  $$('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  $$('[data-i18n-ph]').forEach(el => el.placeholder = t(el.dataset.i18nPh) + '  ( / )');
  $$('[data-i18n-title]').forEach(el => el.title = t(el.dataset.i18nTitle));
  $('#lang').textContent = LANG() === 'pt' ? 'PT' : 'EN';
  buildSit(); buildPitch();
  $('#role').innerHTML = `<option value="">${esc(t('anyRole'))}</option>` + ROLES.map(r => `<option value="${r.id}">${esc(roleName(r.id))}</option>`).join('');
  $('#lists').innerHTML = Object.keys(LISTS).map(k => `<button data-v="${k}">${esc(t('list_' + k))}</button>`).join('');
  $$('#lists button').forEach(b => b.onclick = () => {
    const k = b.dataset.v; if (F.list === k) { F.list = ''; } else { Object.assign(F, LISTS[k], {list: k}); }
    if (F.sort === 'role' && !F.role) F.sort = 'ca'; sync(); apply();
  });
  RANGES.forEach(([id, k, l, mn, mx]) => dual($('#' + id), k, t(l), mn, mx));
}
function applyTheme() {
  const th = F.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = th;
  $('#theme').innerHTML = th === 'dark'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
}

// ---------- sidebar widgets
function buildSit() {
  $('#sit').innerHTML = SIT.map(([v, k, c]) => `<button class="opt" data-v="${v}" style="--c:${c}"><span class="dot"></span><span class="t">${esc(t(k, {y: gameYear()}))}</span><span class="n">—</span></button>`).join('');
  $$('#sit .opt').forEach(b => b.onclick = () => { F.sit = b.dataset.v; sync(); apply(); });
}
function dual(el, key, label, min, max) {
  el.innerHTML = `<div class="lbl">${esc(label)}<span class="val"></span></div><svg class="hist" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"></svg>
  <div class="dual"><div class="track"></div><div class="fill"></div><input type="range" min="${min}" max="${max}" aria-label="${esc(label)} min"><input type="range" min="${min}" max="${max}" aria-label="${esc(label)} max"></div>
  <div class="ends"><span>${min}</span><span>${max}</span></div>`;
  const [r1, r2] = el.querySelectorAll('input'), fill = el.querySelector('.fill'), val = el.querySelector('.val');
  Object.assign(el, {_key: key, _min: min, _max: max});
  el._paint = () => {
    const [a, b] = F[key]; r1.value = a; r2.value = b;
    fill.style.left = ((a - min) / (max - min) * 100) + '%'; fill.style.right = (100 - (b - min) / (max - min) * 100) + '%';
    val.textContent = (a === min && b === max) ? t('allValues') : (b === max ? `${a}+` : a === min ? `${t('upTo')} ${b}` : `${a}–${b}`);
    drawHist(el);
  };
  const set = (i, v) => { const k = [...F[key]]; k[i] = +v; if (k[0] > k[1]) k[i ? 0 : 1] = +v; F[key] = k; el._paint(); debounced(); };
  r1.oninput = e => set(0, e.target.value); r2.oninput = e => set(1, e.target.value); el._paint();
}
function drawHist(el) {
  const svg = el.querySelector('.hist'); if (!svg) return;
  const {_key: k, _min: mn, _max: mx} = el, n = Math.min(40, mx - mn), bins = new Array(n).fill(0);
  for (const p of BASE) { const v = p[k]; if (v < mn || v > mx) continue; bins[Math.min(n - 1, Math.floor((v - mn) / (mx - mn) * n))]++; }
  const top = Math.max(1, ...bins), w = 100 / n, [a, b] = F[k];
  svg.innerHTML = bins.map((c, i) => {
    const lo = mn + i * (mx - mn) / n, hi = mn + (i + 1) * (mx - mn) / n, inr = hi > a && lo <= b, h = c ? Math.max(1.5, c / top * 24) : 0;
    return `<rect x="${i * w + .4}" y="${26 - h}" width="${w - .8}" height="${h}" rx=".6" fill="${inr ? 'var(--accent)' : 'var(--line2)'}" opacity="${inr ? .85 : .7}"/>`;
  }).join('');
}
function pitchLines() { return `<svg class="lines" viewBox="0 0 68 80" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="var(--pline)" stroke-width=".5"><rect x="2" y="2" width="64" height="76" rx="1.5"/><line x1="2" y1="40" x2="66" y2="40"/><circle cx="34" cy="40" r="7"/><rect x="18" y="2" width="32" height="10"/><rect x="18" y="68" width="32" height="10"/><rect x="26" y="2" width="16" height="4"/><rect x="26" y="74" width="16" height="4"/></g></svg>`; }
function buildPitch() {
  $('#pitch').innerHTML = pitchLines() + '<div class="pgrid">' + Object.entries(GRID).map(([i, [c, r]]) => `<button class="pc" data-p="${i}" style="grid-column:${c};grid-row:${r}">${posName(+i)}</button>`).join('') + '</div>';
  $$('#pitch .pc').forEach(b => b.onclick = () => { const p = +b.dataset.p; F.pos = F.pos.includes(p) ? F.pos.filter(x => x !== p) : [...F.pos, p]; sync(); apply(); });
}

// ---------- filtering
function apply() {
  const q = norm(F.q), ano = gameYear(), pm = +F.posMin, role = ROLE_BY_ID[F.role], rule = LIST_RULE[F.list];
  const cnt = {free:0, ending:0, transfer:0, loan:0, pre:0, onloan:0, fav:0, all:0};
  VIEW = []; BASE = [];
  const sitOk = p => F.sit === 'all' || (F.sit === 'free' && p.free) || (F.sit === 'ending' && !p.free && p.contract_year === ano)
    || (F.sit === 'transfer' && p.transfer_listed) || (F.sit === 'loan' && p.loan_listed) || (F.sit === 'pre' && p.pre_club) || (F.sit === 'onloan' && p.loan_club) || (F.sit === 'fav' && FAV.has(p.uid));
  for (const p of ALL) {
    if (q) {                                   // global search: ignores every other filter
      if (!p._n.includes(q) && !p._c.includes(q) && !norm(p.pre_club || '').includes(q) && !noteMatch(p, q)) continue;
      p.gap = p.pa - p.ca; p.age = p.birth_year ? ano - p.birth_year : 0;
      cnt.all++; BASE.push(p); VIEW.push(p); continue;
    }
    if (F.nat && p.nation !== F.nat) continue;
    if ((F.sex === 'M' && p.female) || (F.sex === 'F' && !p.female)) continue;
    if (F.foot && p.foot !== F.foot && !(p.foot === 'B' && F.foot !== 'B')) continue;
    if (F.pos.length && !F.pos.some(i => p.pos[i] >= pm)) continue;
    if (role && !role.pos.some(i => p.pos[i] >= pm)) continue;
    if (rule && !rule(p)) continue;
    if (role) p.role = roleRating(p, role);
    p.bargain = p.ca - 22 * Math.log10(Math.max(p.wage || 0, 50));
    p.gap = p.pa - p.ca; p.age = p.birth_year ? ano - p.birth_year : 0;
    const inR = p.ca >= F.ca[0] && p.ca <= F.ca[1] && p.pa >= F.pa[0] && p.pa <= F.pa[1] && p.gap >= F.gap[0]
      && (p.gap <= F.gap[1] || F.gap[1] === 120) && p.age >= F.age[0] && p.age <= F.age[1];
    if (inR) {
      cnt.all++; if (p.free) cnt.free++; else if (p.contract_year === ano) cnt.ending++;
      if (p.transfer_listed) cnt.transfer++; if (p.loan_listed) cnt.loan++; if (p.pre_club) cnt.pre++; if (p.loan_club) cnt.onloan++; if (FAV.has(p.uid)) cnt.fav++;
    }
    if (!sitOk(p)) continue;
    BASE.push(p); if (inR) VIEW.push(p);
  }
  $$('#sit .opt').forEach(b => { b.querySelector('.n').textContent = ALL.length && !q ? fmt(cnt[b.dataset.v]) : '—'; });
  document.body.classList.toggle('searching', !!q);
  $('#gsearch').textContent = q ? t('searchGlobal', {n: fmt(VIEW.length)}) : '';
  const endLbl = $('#sit .opt[data-v="ending"] .t'); if (endLbl) endLbl.textContent = t('sit_end', {y: ano});
  const k = F.sort, d = F.dir;
  VIEW.sort((a, b) => {
    let x = a[k], y = b[k];
    if (k === 'pos0') { x = natural(a)[0]?.[1] ?? 99; y = natural(b)[0]?.[1] ?? 99; }
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d || b.ca - a.ca;
  });
  RANGES.forEach(([id]) => drawHist($('#' + id)));
  shown = PAGE; render(); kpis(); countFilters(); store('filters', F);
}
function countFilters() {
  let n = 0; if (F.role) n++; if (F.list) n++; if (F.sit !== 'all') n++; if (F.nat) n++; if (F.sex) n++; if (F.foot) n++; if (F.pos.length) n++; if (F.q) n++;
  RANGES.forEach(([, k, , mn, mx]) => { if (F[k][0] !== mn || F[k][1] !== mx) n++; });
  $('#fcount').textContent = n;
}
function kpis() {
  const v = VIEW;
  $('#k1').textContent = fmt(v.length); $('#k1s').textContent = t('k_of', {n: fmt(ALL.length)});
  const top = v.reduce((a, b) => !a || b.ca > a.ca ? b : a, null), pot = v.reduce((a, b) => !a || b.pa > a.pa ? b : a, null);
  const gems = v.filter(p => p.age <= 21 && p.pa >= 140);
  $('#k2').textContent = top ? top.ca : '—'; $('#k2s').textContent = top ? top.name : '';
  $('#k3').textContent = pot ? pot.pa : '—'; $('#k3s').textContent = pot ? pot.name : '';
  $('#k4').textContent = fmt(gems.length); $('#k4s').textContent = gems.slice(0, 3).map(p => p.name).join(', ') || '—';
  const n = 24, b = new Array(n).fill(0); v.forEach(p => b[Math.min(n - 1, Math.floor(p.ca / 200 * n))]++); const m = Math.max(1, ...b);
  const pts = b.map((c, i) => `${(i / (n - 1) * 84).toFixed(1)},${(28 - c / m * 26).toFixed(1)}`).join(' ');
  $('#spark').innerHTML = `<defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polygon points="0,30 ${pts} 84,30" fill="url(#sg)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
}
function render() {
  $$('th[data-k]').forEach(th => { const on = th.dataset.k === F.sort; th.classList.toggle('on', on); th.innerHTML = esc(t(th.dataset.i18n)) + (on ? `<span class="a">${F.dir < 0 ? '↓' : '↑'}</span>` : ''); });
  $('#rows').innerHTML = VIEW.slice(0, shown).map(p => {
    const nat = natural(p).slice(0, 3);
    return `<tr data-uid="${p.uid}"><td><button class="star ${FAV.has(p.uid) ? 'on' : ''}" data-fav="${p.uid}" title="${esc(t(FAV.has(p.uid) ? 'removeFav' : 'addFav'))}">${STAR}</button></td>
    <td><div class="pl">${avatar(p)}<div><div class="nm">${esc(p.name)}${noteTag(p)}</div><div class="sub">${p.female ? esc(t('female_tag')) + ' · ' : ''}${esc(p.nation_code || '')}${p.nation_code ? ' · ' : ''}ID ${p.uid}</div></div></div></td>
    <td><div class="poss">${footTag(p)}${nat.map(([v, i]) => `<span class="pt ${v >= 18 ? 'n' : ''}">${posName(i)}</span>`).join('') || '<span class="sub">—</span>'}</div><div class="brole">${p.a ? esc(roleName(bestRole(p))) + ' · ' + p._bestR : ''}</div></td>
    ${F.role ? `<td class="r">${rating100(p.role)}</td>` : ''}
    <td class="r">${p.age || '—'}</td><td class="r">${progTag(p)}${rating(p.ca)}</td><td class="r">${rating(p.pa)}</td>
    <td class="r gap" style="color:${p.gap >= 25 ? '#22c55e' : p.gap >= 10 ? 'var(--text)' : 'var(--faint)'}">${p.gap > 0 ? '+' : ''}${p.gap}</td>
    <td>${esc(p.nation)}<span class="flag">${esc(p.nation_code)}</span></td>
    <td class="r wage">${p.wage ? money(wageOf(p)) : '<span class="sub">—</span>'}</td>
    <td><div class="ct">${p.free ? `<span class="tag free">${esc(t('free'))}</span>` : `<span class="cn">${esc(p.club || '—')}</span><span class="cy">${p.contract_year}</span>`}${listTags(p)}</div></td></tr>`;
  }).join('');
  const empty = $('#empty');
  if (!ALL.length && lastErr) { empty.style.display = 'block'; empty.innerHTML = onboarding(); }
  else { empty.style.display = VIEW.length ? 'none' : 'block'; empty.innerHTML = ALL.length ? `${esc(t('noResults'))}<br><span class="sub">${esc(t('noResultsHint'))}</span>` : esc(t('loading')); }
  $('#more').style.display = VIEW.length > shown ? 'block' : 'none';
}
function onboarding() {
  return `<div class="onboard"><h3>${esc(t('ob_title'))}</h3><p>${esc(t('ob_text'))}</p><ol><li>${esc(t('ob_1'))}</li><li>${esc(t('ob_2'))}</li><li>${esc(t('ob_3'))}</li></ol>
  <div class="err">${esc(lastErr)}</div></div>`;
}
function toggleFav(uid) {
  if (FAV.has(uid)) { FAV.delete(uid); toast(t('favRemoved')); } else { FAV.add(uid); toast(t('favAdded')); }
  store('fav', [...FAV]); apply();
  const s = $('#dfav'); if (s && +s.dataset.uid === uid) s.classList.toggle('on', FAV.has(uid));
}

// ---------- player drawer
async function openPlayer(uid) {
  $$('tr.sel').forEach(r => r.classList.remove('sel')); $(`tr[data-uid="${uid}"]`)?.classList.add('sel');
  let p; try { p = await (await fetch('/api/player?uid=' + uid)).json(); } catch { return toast(t('err_offline')); }
  if (p.error) return toast(t('err_' + p.error_code) || p.error);
  const lp = BY_UID.get(p.uid) || p;
  const roles = lp.a ? topRoles(lp) : [], sim = lp.a ? similarPlayers(lp, ALL) : [];
  const sq = SQUAD[p.squad] ? t(SQUAD[p.squad]) : '';
  const age = p.birth_year ? gameYear() - p.birth_year : '—', nat = natural(p), isGK = p.pos[0] >= 15, A = p.attrs;
  const avg = a => Math.round(a.reduce((s, i) => s + A[i], 0) / a.length * 10) / 10;
  const ax = (isGK ? RADAR.gk : RADAR.field).map(([k, idx]) => [t(k), avg(idx)]);
  const foot = v => t(v >= 18 ? 'f_vstrong' : v >= 14 ? 'f_strong' : v >= 10 ? 'f_ok' : v >= 6 ? 'f_weak' : 'f_vweak');
  const col = g => `<div><h6>${esc(t('g_' + g))}</h6>${p.groups[g].map(i => [attrName(i), A[i]]).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `<div class="ar"><span>${esc(k)}</span><b style="color:${tone20(v)};background:${tone20(v)}1a">${v}</b></div>`).join('')}</div>`;
  $('#drawer').innerHTML = `
   <div class="dh">${avatar(p)}<div><h2>${esc(p.name)}</h2><div class="meta">${age} ${esc(t('years'))} · ${esc(p.nation)} · ${nat.map(x => posName(x[1])).join(' / ') || '—'}</div></div>
     <div class="acts"><button class="btn icon ${inCompare(p.uid) ? 'on' : ''}" id="dcmp" title="${esc(t('addCompare'))}">⇄</button><button class="btn icon star ${FAV.has(p.uid) ? 'on' : ''}" id="dfav" data-uid="${p.uid}" title="${esc(t('addFav'))}">${STAR}</button>
     <button class="btn icon" id="dlink" title="${esc(t('copyLink'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></button>
     <button class="btn icon" id="dclose" title="${esc(t('close'))}">✕</button></div></div>
   <div class="dbody">
    <div class="card"><div class="stat">
      <div><div class="k">CA</div><div class="v" style="color:${tone(p.ca)}">${p.ca}</div><div class="meter"><i style="width:${p.ca / 2}%;background:${tone(p.ca)}"></i></div></div>
      <div><div class="k">PA</div><div class="v" style="color:${tone(p.pa)}">${p.pa}</div><div class="meter"><i style="width:${p.pa / 2}%;background:${tone(p.pa)}"></i></div></div>
      <div><div class="k">${esc(t('margin'))}</div><div class="v">${p.pa - p.ca > 0 ? '+' : ''}${p.pa - p.ca}</div></div>
      <div><div class="k">${esc(t('contract'))}</div><div class="v" style="font-size:13px">${p.free ? `<span class="tag free">${esc(t('free'))}</span>` : esc(p.club) + `<div class="sub">${esc(t('until'))} ${p.contract_year}</div>`}${listTags(p)}${p.pre_club ? `<div class="sub">${esc(t('preTitle', {c: p.pre_club, d: preDate(p)}))}</div>` : ''}</div></div>
    </div></div>
    ${p.free ? '' : `<div class="card"><div class="stat">
      <div><div class="k">${esc(t('wage'))}</div><div class="v sm">${esc(wageTxt(p))}</div></div>
      <div><div class="k">${esc(t('releaseClause'))}</div><div class="v sm">${esc(p.release ? money(p.release) : t('none'))}</div></div>
      <div><div class="k">${esc(t('squadStatus'))}</div><div class="v sm">${esc(sq || '—')}</div></div>
      <div><div class="k">${esc(t('contractEnds'))}</div><div class="v sm">${p.contract_year || '—'}</div></div>
    </div></div>`}
    ${roles.length ? `<div class="grid2">
      <div class="card"><h4>${esc(t('bestRoles'))}</h4>${roles.map(([id, v, raw]) => `<div class="rbar" title="${esc(t('roleRawTip', {n: raw}))}"><span>${esc(roleName(id))}</span><i><b style="width:${v}%;background:${tone(v, 100)}"></b></i><em style="color:${tone(v, 100)}">${v}</em></div>`).join('')}<div class="sub" style="margin-top:8px">${esc(t('roleNote'))}</div></div>
      <div class="card"><h4>${esc(t('similar'))}</h4>${sim.map(([o, s]) => `<button class="simrow" data-uid="${o.uid}">${avatar(o)}<span class="nm">${esc(o.name)}<span class="sub">${o.birth_year ? gameYear() - o.birth_year : '—'} · ${esc(o.club || t('free'))}${o.wage ? ' · ' + esc(money(wageOf(o))) : ''}</span></span><span class="r">${rating(o.ca)}<em>${s}%</em></span></button>`).join('') || '<div class="sub">—</div>'}</div>
    </div>` : ''}
    <div class="grid2">
      <div class="card"><h4>${esc(t('profile'))}</h4>${radar(ax)}</div>
      <div class="card"><h4>${esc(t('positions'))}</h4>${bigPitch(p.pos)}
        <div class="feet"><div><div class="sub">${esc(t('leftFoot'))}</div><b>${esc(foot(A[24]))}</b></div><div><div class="sub">${esc(t('rightFoot'))}</div><b>${esc(foot(A[25]))}</b></div></div></div>
    </div>
    ${historyCard(p.uid)}
    ${noteCard(p.uid)}
    <div class="card"><h4>${esc(t('attributes'))}</h4><div class="attrs">${isGK ? col('goalkeeping') : col('technical')}${col('mental')}${col('physical')}</div></div>
    <div class="card"><h4>${esc(t('hidden'))}</h4><div class="attrs">${col('hidden')}</div></div>
    <div class="note">ⓘ ${esc(t('attrNote'))}</div>
   </div>`;
  $('#dclose').onclick = closeDrawer;
  $('#dcmp').onclick = () => toggleCompare(p.uid);
  wireNote(p.uid); noteRecent(p.uid);
  $$('#drawer .simrow').forEach(b => b.onclick = () => openPlayer(+b.dataset.uid));
  $('#dfav').onclick = () => toggleFav(p.uid);
  $('#dlink').onclick = () => { const u = new URL(location.href); u.searchParams.set('p', p.uid); navigator.clipboard?.writeText(u.href); toast(t('linkCopied')); };
  $('#drawer').classList.add('on'); $('#shade').classList.add('on');
  const u = new URL(location.href); u.searchParams.set('p', p.uid); history.replaceState(null, '', u);
}
function closeDrawer() {
  $('#drawer').classList.remove('on'); if (!$('#panel').classList.contains('on')) $('#shade').classList.remove('on');
  const u = new URL(location.href); u.searchParams.delete('p'); history.replaceState(null, '', u);
}
function radar(ax) {
  const n = ax.length, cx = 120, cy = 112, R = 84, pt = (i, r) => [cx + r * Math.sin(2 * Math.PI * i / n), cy - r * Math.cos(2 * Math.PI * i / n)];
  const ring = f => ax.map((_, i) => pt(i, R * f).join(',')).join(' '), poly = ax.map(([, v], i) => pt(i, R * v / 20).join(',')).join(' ');
  return `<svg viewBox="0 0 240 226" width="100%" role="img"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".45"/><stop offset="1" stop-color="var(--accent2)" stop-opacity=".3"/></linearGradient></defs>
  <g fill="none" stroke="var(--line2)">${[.25, .5, .75, 1].map(f => `<polygon points="${ring(f)}"/>`).join('')}${ax.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}"/>`).join('')}</g>
  <polygon points="${poly}" fill="url(#rg)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
  ${ax.map(([, v], i) => { const [x, y] = pt(i, R * v / 20); return `<circle cx="${x}" cy="${y}" r="2.6" fill="var(--accent)"/>`; }).join('')}
  ${ax.map(([l, v], i) => { const [x, y] = pt(i, R + 17); return `<text x="${x}" y="${y - 4}" text-anchor="middle" font-size="9.5" fill="var(--muted)" font-weight="600">${esc(l)}</text><text x="${x}" y="${y + 8}" text-anchor="middle" font-size="10" fill="var(--text)" font-weight="800">${v}</text>`; }).join('')}</svg>`;
}
function bigPitch(pos) {
  return `<div class="bpitch">${pitchLines()}${pos.map((v, i) => {
    if (v < 5) return ''; const c = v >= 18 ? '#22c55e' : v >= 15 ? '#84cc16' : v >= 10 ? '#eab308' : '#f97316';
    return `<span class="pp" style="left:${PXY[i][0]}%;top:${PXY[i][1]}%;background:${c};opacity:${v >= 10 ? 1 : .6}" title="${posName(i)}: ${v}/20">${posName(i)}</span>`;
  }).join('')}</div>`;
}

// ---------- update check (the server asks GitHub for the latest release once per run)
let updChecked = false;
async function checkUpdate() {
  if (updChecked) return; updChecked = true;
  try {
    const r = await (await fetch('/api/update')).json();
    if (r.newer && /^https:\/\/github\.com\//.test(r.url)) { const a = $('#upd'); a.href = r.url; a.textContent = t('newVersion', {v: r.latest}); a.hidden = false; }
  } catch { /* offline: ignore */ }
}

// ---------- data
async function load(path, tries = 0) {
  const b = $('#refresh'); b.disabled = true; b.innerHTML = `<span class="spin"></span>${esc(t('reading'))}`;
  try {
    const r = await (await fetch(path)).json();
    $('#ver').textContent = r.version ? 'v' + r.version : '';
    lastErr = r.error ? (t('err_' + r.error_code) !== 'err_' + r.error_code ? t('err_' + r.error_code) : r.error) : null;
    if (r.meta) {
      META = r.meta;
      const c = r.fields;
      ALL = r.rows.map(row => { const o = {}; c.forEach((k, i) => o[k] = row[i]); o._n = norm(o.name); o._c = norm(o.club + ' ' + (o.loan_club || '')); return o; });
      BY_UID = new Map(ALL.map(p => [p.uid, p])); GROUPS = r.groups || {};
      recordHistory(); renderCmpBar(); checkUpdate();
      fillNations();
    }
    setStatus();
    apply();
    const pid = +URLP.get('p'); if (pid && ALL.length && !$('#drawer').classList.contains('on')) openPlayer(pid);
    // deep links: ?xi=<club>&form=4-3-3 opens the best XI, ?cmp=uid,uid[,uid] opens the comparison (first load only)
    if (ALL.length && !load.linked) {
      load.linked = true;
      if (URLP.get('cmp')) { CMP = URLP.get('cmp').split(',').map(Number).filter(u => BY_UID.has(u)).slice(0, CMP_MAX); store('cmp', CMP); renderCmpBar(); if (CMP.length > 1) openCompare(); }
      if (URLP.get('xi')) { store('xi', {club: URLP.get('xi'), form: URLP.get('form') || '4-3-3'}); openBestXI(); }
    }
  } catch {
    // the first read of a big save can outlast the connection; the server keeps the result, so just ask again
    if (tries < 4) { await new Promise(r => setTimeout(r, 1500)); return load('/api/players', tries + 1); }
    lastErr = t('err_offline'); setStatus(); render();
  } finally { b.disabled = false; b.textContent = t('refresh'); }
}
function setStatus() {
  const st = $('#status');
  if (lastErr && !ALL.length) { st.className = 'status err'; $('#statusTxt').textContent = lastErr; }
  else if (META) { st.className = lastErr ? 'status err' : 'status'; $('#statusTxt').textContent = `${fmt(META.total)} ${t('players')}` + (META.game_year ? ` · ${gameDateText()} ${t('gameDate')}` : '') + ` · ${META.read_at}`; }
  else { st.className = 'status wait'; $('#statusTxt').textContent = t('connecting'); }
  $('#yearInput').value = gameYear();
  $('#yearHint').textContent = !F.year && META?.game_year ? `${gameDateText()} · ${t('detected')}` : '';
}
function fillNations() {
  const c = {}; ALL.forEach(p => { if (p.nation) c[p.nation] = (c[p.nation] || 0) + 1; });
  if (F.nat && !c[F.nat]) F.nat = '';
  $('#nat').innerHTML = `<option value="">${esc(t('allNations'))}</option>` + Object.keys(c).sort((a, b) => a.localeCompare(b)).map(n => `<option value="${esc(n)}">${esc(n)} · ${fmt(c[n])}</option>`).join('');
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
  if (F.nat && !top.includes(F.nat)) top.push(F.nat);
  $('#natQuick').innerHTML = ['', ...top].map(n => `<button data-v="${esc(n)}">${esc(n || t('all'))}</button>`).join('');
  $$('#natQuick button').forEach(b => b.onclick = () => { F.nat = b.dataset.v; sync(); apply(); });
  sync();
}

// ---------- wiring
let tmr; const debounced = () => { clearTimeout(tmr); tmr = setTimeout(apply, 90); };
function sync() {
  $('#q').value = F.q; if ($('#nat').options.length > 1) $('#nat').value = F.nat;
  $$('#sit .opt').forEach(b => b.classList.toggle('on', b.dataset.v === F.sit));
  $$('#sex button').forEach(b => b.classList.toggle('on', b.dataset.v === F.sex));
  $$('#foot button').forEach(b => b.classList.toggle('on', b.dataset.v === (F.foot || '')));
  $$('#posMin button').forEach(b => b.classList.toggle('on', +b.dataset.v === +F.posMin));
  $$('#natQuick button').forEach(b => b.classList.toggle('on', b.dataset.v === F.nat));
  $('#role').value = F.role; $('#cur').value = curCode();
  $$('#per button').forEach(b => b.classList.toggle('on', b.dataset.v === (perMonth() ? 'm' : 'w')));
  $$('#lists button').forEach(b => b.classList.toggle('on', b.dataset.v === F.list));
  document.body.classList.toggle('hasrole', !!F.role);
  $$('#pitch .pc').forEach(b => b.classList.toggle('on', F.pos.includes(+b.dataset.p)));
  RANGES.forEach(([id]) => $('#' + id)._paint && $('#' + id)._paint());
}
$('#q').oninput = e => { F.q = e.target.value; debounced(); };
$('#yearInput').oninput = e => { F.year = +e.target.value || null; $('#yearHint').textContent = ''; debounced(); };
$('#nat').onchange = e => { F.nat = e.target.value; sync(); apply(); };
$('#role').onchange = e => { F.role = e.target.value; if (F.role) { F.sort = 'role'; F.dir = -1; } else if (F.sort === 'role') F.sort = 'ca'; sync(); apply(); };
$('#cur').onchange = e => { F.cur = e.target.value; F.per = null; sync(); apply(); };
$$('#per button').forEach(b => b.onclick = () => { F.per = b.dataset.v; sync(); apply(); });
$$('#sex button').forEach(b => b.onclick = () => { F.sex = b.dataset.v; sync(); apply(); });
$$('#foot button').forEach(b => b.onclick = () => { F.foot = b.dataset.v; sync(); apply(); });
$$('#posMin button').forEach(b => b.onclick = () => { F.posMin = +b.dataset.v; sync(); apply(); });
$$('th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; F.dir = F.sort === k ? -F.dir : (['name', 'nation', 'club', 'pos0'].includes(k) ? 1 : -1); F.sort = k; apply(); });
$('#rows').onclick = e => {
  const s = e.target.closest('[data-fav]'); if (s) { e.stopPropagation(); return toggleFav(+s.dataset.fav); }
  const tr = e.target.closest('tr'); if (tr) openPlayer(+tr.dataset.uid);
};
$('#more').onclick = () => { shown += PAGE; render(); };
$('#tblWrap').onscroll = e => { const el = e.target; if (el.scrollTop + el.clientHeight > el.scrollHeight - 300 && VIEW.length > shown) { shown += PAGE; render(); } };
$('#refresh').onclick = () => load('/api/refresh');
$('#reset').onclick = () => { F = Object.assign({}, DEF, {theme: F.theme, lang: F.lang, cur: F.cur, per: F.per, pos: []}); sync(); setStatus(); apply(); };
$('#posClear').onclick = () => { F.pos = []; sync(); apply(); };
$('#theme').onclick = () => { F.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); RANGES.forEach(([id]) => drawHist($('#' + id))); store('filters', F); };
$('#lang').onclick = () => { F.lang = LANG() === 'pt' ? 'en' : 'pt'; applyLang(); if (ALL.length) fillNations(); sync(); setStatus(); apply(); };
$('#shade').onclick = () => { closePanel(); closeDrawer(); };
$('#xiBtn').onclick = openBestXI;
$('#csv').onclick = () => {
  // basic data only: the FM EULA does not allow exporting ratings/attributes in bulk
  const cols = ['name', 'age', 'nation', 'club', 'contract_year', 'free', 'transfer_listed', 'loan_listed', 'pre_club', 'uid'];
  const lines = [cols.join(';'), ...VIEW.map(p => cols.map(c => `"${String(p[c] ?? '').replace(/"/g, '""')}"`).join(';'))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], {type: 'text/csv;charset=utf-8'})); a.download = 'pitchlens.csv'; a.click();
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#panel').classList.contains('on')) closePanel(); else closeDrawer(); }
  if (e.key === '/' && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
});

// ---------- boot (URL params win: ?lang=en|pt&theme=dark|light&sit=<situation>&q=<search>&role=<role id>&photos=0&p=<uid>&xi=<club>&form=<formation>&cmp=<uid,uid>)
if (URLP.get('lang')) F.lang = URLP.get('lang') === 'pt' ? 'pt' : 'en';
if (!F.lang) F.lang = (navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en';
if (SIT.some(s => s[0] === URLP.get('sit'))) F.sit = URLP.get('sit');
if (URLP.has('q')) F.q = URLP.get('q');
if (ROLE_BY_ID[URLP.get('role')]) { F.role = URLP.get('role'); F.sort = 'role'; F.dir = -1; }
if (URLP.get('theme')) F.theme = URLP.get('theme') === 'light' ? 'light' : 'dark';
toolsInit(); applyTheme(); applyLang(); sync(); setStatus(); render();
load('/api/players');
// heartbeat: in desktop mode the server stops by itself a few minutes after the window is gone
const alive = () => fetch('/api/ping?alive=1').catch(() => {});
alive(); setInterval(alive, 30000);

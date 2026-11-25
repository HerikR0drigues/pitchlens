// Pitchlens - UI logic (no dependencies). Data comes from the local server (scout.py).
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const URLP = new URLSearchParams(location.search);

// ---------- positions (indexes follow fmreader.POSICOES)
// grid on the mini pitch: [column 1..5, row 1..7], attack on top
const GRID = {12:[3,1],9:[1,2],10:[3,2],11:[5,2],6:[1,3],7:[3,3],8:[5,3],13:[1,4],5:[3,4],14:[5,4],2:[1,5],3:[3,5],4:[5,5],1:[3,6],0:[3,7]};
const PXY = {0:[50,92],1:[50,80],2:[14,70],3:[50,70],4:[86,70],13:[14,56],14:[86,56],5:[50,57],6:[14,41],7:[50,42],8:[86,41],9:[17,26],10:[50,26],11:[83,26],12:[50,10]};
const SIT = [['livre','sit_free','#22c55e'],['fim','sit_end','#a78bfa'],['transf','sit_tl','#f59e0b'],['emprest','sit_ll','#38bdf8'],['fav','sit_fav','#facc15'],['todos','sit_all','#64748b']];
const RANGES = [['rCA','ca','ca',0,200],['rPA','pa','pa',0,200],['rGAP','gap','gap',0,120],['rID','id','age',14,45]];
const RADAR = {
  field: [['ax_finishing',[2,4,6]],['ax_technique',[23,1,22]],['ax_creativity',[7,10,26,18]],['ax_defending',[9,5,20,17]],
          ['ax_speed',[38,34,46]],['ax_physical',[36,37,50,39]],['ax_mental',[51,29,28,52]]],
  gk:    [['ax_reflexes',[21,19]],['ax_handling',[11,33]],['ax_aerial',[12,13,39]],['ax_distribution',[15,16,7]],
          ['ax_mental',[53,18,52,20]],['ax_physical',[46,36,50]]],
};
const DEF = {q:'',sit:'livre',nat:'',sexo:'M',pe:'',pos:[],posMin:15,ca:[0,200],pa:[0,200],gap:[0,120],id:[15,40],
             year:null,sort:'ca',dir:-1,theme:null,lang:null};

let F = Object.assign({}, DEF, store('f') || {});
if (!Array.isArray(F.pos) || F.pos.some(p => typeof p !== 'number')) F.pos = [];
if (![18,15,10].includes(+F.posMin)) F.posMin = 15;
if (!['','L','R','B'].includes(F.pe)) F.pe = '';
let FAV = new Set(store('fav') || []);
let ALL = [], VIEW = [], BASE = [], META = null, shown = 0, lastErr = null;
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
const gameYear = () => +F.year || META?.ano_jogo || new Date().getFullYear();
function tone(v, max = 200) { const r = v / max; return r >= .75 ? '#22c55e' : r >= .6 ? '#84cc16' : r >= .5 ? '#eab308' : r >= .4 ? '#f97316' : '#ef4444'; }
const tone20 = v => tone(v, 20);
const rating = v => { const c = tone(v); return `<span class="rating" style="background:${c}1f;color:${c}">${v}</span>`; };
function initials(n) { const w = String(n).split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
function avatar(p) { const h = (p.uid * 47) % 360; return `<div class="av" style="background:linear-gradient(135deg,hsl(${h} 58% 46%),hsl(${(h + 40) % 360} 62% 36%))">${esc(initials(p.nome))}</div>`; }
const natural = p => p.pos.map((v, i) => [v, i]).filter(x => x[0] >= 15).sort((a, b) => b[0] - a[0]);
const FOOT_LBL = {L: ['L', 'E'], R: ['R', 'D'], B: ['B', 'A']};
function footTag(p) { const f = FOOT_LBL[p.pe]; if (!f) return ''; const title = {L: t('left'), R: t('right'), B: t('both')}[p.pe]; return `<span class="pt foot" title="${esc(title)}">${LANG() === 'pt' ? f[1] : f[0]}</span>`; }
function listTags(p) { return (p.lista_transf ? `<span class="tag tl">${LANG() === 'pt' ? 'Transf.' : 'TL'}</span>` : '') + (p.lista_emprest ? `<span class="tag ll">${LANG() === 'pt' ? 'Empr.' : 'LL'}</span>` : ''); }
const STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.tm); toast.tm = setTimeout(() => el.classList.remove('on'), 1600); }
function gameDateText() {
  if (!META?.ano_jogo) return '';
  const d = new Date(META.ano_jogo, 0, META.dia_jogo || 1);
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
  for (const p of BASE) { const v = p[k === 'id' ? 'idade' : k]; if (v < mn || v > mx) continue; bins[Math.min(n - 1, Math.floor((v - mn) / (mx - mn) * n))]++; }
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
  const q = norm(F.q), ano = gameYear(), pm = +F.posMin;
  const cnt = {livre:0, fim:0, transf:0, emprest:0, fav:0, todos:0};
  VIEW = []; BASE = [];
  const sitOk = p => F.sit === 'todos' || (F.sit === 'livre' && p.livre) || (F.sit === 'fim' && !p.livre && p.contrato_ano === ano)
    || (F.sit === 'transf' && p.lista_transf) || (F.sit === 'emprest' && p.lista_emprest) || (F.sit === 'fav' && FAV.has(p.uid));
  for (const p of ALL) {
    if (F.nat && p.nacao !== F.nat) continue;
    if ((F.sexo === 'M' && p.feminino) || (F.sexo === 'F' && !p.feminino)) continue;
    if (F.pe && p.pe !== F.pe && !(p.pe === 'B' && F.pe !== 'B')) continue;
    if (F.pos.length && !F.pos.some(i => p.pos[i] >= pm)) continue;
    if (q && !p._n.includes(q) && !p._c.includes(q)) continue;
    p.gap = p.pa - p.ca; p.idade = p.nasc_ano ? ano - p.nasc_ano : 0;
    const inR = p.ca >= F.ca[0] && p.ca <= F.ca[1] && p.pa >= F.pa[0] && p.pa <= F.pa[1] && p.gap >= F.gap[0]
      && (p.gap <= F.gap[1] || F.gap[1] === 120) && p.idade >= F.id[0] && p.idade <= F.id[1];
    if (inR) {
      cnt.todos++; if (p.livre) cnt.livre++; else if (p.contrato_ano === ano) cnt.fim++;
      if (p.lista_transf) cnt.transf++; if (p.lista_emprest) cnt.emprest++; if (FAV.has(p.uid)) cnt.fav++;
    }
    if (!sitOk(p)) continue;
    BASE.push(p); if (inR) VIEW.push(p);
  }
  $$('#sit .opt').forEach(b => { b.querySelector('.n').textContent = ALL.length ? fmt(cnt[b.dataset.v]) : '—'; });
  const fimLbl = $('#sit .opt[data-v="fim"] .t'); if (fimLbl) fimLbl.textContent = t('sit_end', {y: ano});
  const k = F.sort, d = F.dir;
  VIEW.sort((a, b) => {
    let x = a[k], y = b[k];
    if (k === 'pos0') { x = natural(a)[0]?.[1] ?? 99; y = natural(b)[0]?.[1] ?? 99; }
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d || b.ca - a.ca;
  });
  RANGES.forEach(([id]) => drawHist($('#' + id)));
  shown = PAGE; render(); kpis(); countFilters(); store('f', F);
}
function countFilters() {
  let n = 0; if (F.sit !== 'todos') n++; if (F.nat) n++; if (F.sexo) n++; if (F.pe) n++; if (F.pos.length) n++; if (F.q) n++;
  RANGES.forEach(([, k, , mn, mx]) => { if (F[k][0] !== mn || F[k][1] !== mx) n++; });
  $('#fcount').textContent = n;
}
function kpis() {
  const v = VIEW;
  $('#k1').textContent = fmt(v.length); $('#k1s').textContent = t('k_of', {n: fmt(ALL.length)});
  const top = v.reduce((a, b) => !a || b.ca > a.ca ? b : a, null), pot = v.reduce((a, b) => !a || b.pa > a.pa ? b : a, null);
  const gems = v.filter(p => p.idade <= 21 && p.pa >= 140);
  $('#k2').textContent = top ? top.ca : '—'; $('#k2s').textContent = top ? top.nome : '';
  $('#k3').textContent = pot ? pot.pa : '—'; $('#k3s').textContent = pot ? pot.nome : '';
  $('#k4').textContent = fmt(gems.length); $('#k4s').textContent = gems.slice(0, 3).map(p => p.nome).join(', ') || '—';
  const n = 24, b = new Array(n).fill(0); v.forEach(p => b[Math.min(n - 1, Math.floor(p.ca / 200 * n))]++); const m = Math.max(1, ...b);
  const pts = b.map((c, i) => `${(i / (n - 1) * 84).toFixed(1)},${(28 - c / m * 26).toFixed(1)}`).join(' ');
  $('#spark').innerHTML = `<defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polygon points="0,30 ${pts} 84,30" fill="url(#sg)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
}
function render() {
  $$('th[data-k]').forEach(th => { const on = th.dataset.k === F.sort; th.classList.toggle('on', on); th.innerHTML = esc(t(th.dataset.i18n)) + (on ? `<span class="a">${F.dir < 0 ? '↓' : '↑'}</span>` : ''); });
  $('#rows').innerHTML = VIEW.slice(0, shown).map(p => {
    const nat = natural(p).slice(0, 3);
    return `<tr data-uid="${p.uid}"><td><button class="star ${FAV.has(p.uid) ? 'on' : ''}" data-fav="${p.uid}" title="${esc(t(FAV.has(p.uid) ? 'removeFav' : 'addFav'))}">${STAR}</button></td>
    <td><div class="pl">${avatar(p)}<div><div class="nm">${esc(p.nome)}</div><div class="sub">${p.feminino ? esc(t('female_tag')) + ' · ' : ''}ID ${p.uid}</div></div></div></td>
    <td><div class="poss">${footTag(p)}${nat.map(([v, i]) => `<span class="pt ${v >= 18 ? 'n' : ''}">${posName(i)}</span>`).join('') || '<span class="sub">—</span>'}</div></td>
    <td class="r">${p.idade || '—'}</td><td class="r">${rating(p.ca)}</td><td class="r">${rating(p.pa)}</td>
    <td class="r gap" style="color:${p.gap >= 25 ? '#22c55e' : p.gap >= 10 ? 'var(--text)' : 'var(--faint)'}">${p.gap > 0 ? '+' : ''}${p.gap}</td>
    <td>${esc(p.nacao)}<span class="flag">${esc(p.nacao_sigla)}</span></td>
    <td>${p.livre ? `<span class="tag free">${esc(t('free'))}</span>` : `<span class="tag ctr">${esc(p.clube || '—')} · ${p.contrato_ano}</span>`}${listTags(p)}</td></tr>`;
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
  if (p.erro) return toast(t('err_' + p.erro_code) || p.erro);
  const idade = p.nasc_ano ? gameYear() - p.nasc_ano : '—', nat = natural(p), isGK = p.pos[0] >= 15, A = p.attrs;
  const avg = a => Math.round(a.reduce((s, i) => s + A[i], 0) / a.length * 10) / 10;
  const ax = (isGK ? RADAR.gk : RADAR.field).map(([k, idx]) => [t(k), avg(idx)]);
  const foot = v => t(v >= 18 ? 'f_vstrong' : v >= 14 ? 'f_strong' : v >= 10 ? 'f_ok' : v >= 6 ? 'f_weak' : 'f_vweak');
  const col = g => `<div><h6>${esc(t('g_' + g))}</h6>${p.groups[g].map(i => [attrName(i), A[i]]).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `<div class="ar"><span>${esc(k)}</span><b style="color:${tone20(v)};background:${tone20(v)}1a">${v}</b></div>`).join('')}</div>`;
  $('#drawer').innerHTML = `
   <div class="dh">${avatar(p)}<div><h2>${esc(p.nome)}</h2><div class="meta">${idade} ${esc(t('years'))} · ${esc(p.nacao)} · ${nat.map(x => posName(x[1])).join(' / ') || '—'}</div></div>
     <div class="acts"><button class="btn icon star ${FAV.has(p.uid) ? 'on' : ''}" id="dfav" data-uid="${p.uid}" title="${esc(t('addFav'))}">${STAR}</button>
     <button class="btn icon" id="dlink" title="${esc(t('copyLink'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></button>
     <button class="btn icon" id="dclose" title="${esc(t('close'))}">✕</button></div></div>
   <div class="dbody">
    <div class="card"><div class="stat">
      <div><div class="k">CA</div><div class="v" style="color:${tone(p.ca)}">${p.ca}</div><div class="meter"><i style="width:${p.ca / 2}%;background:${tone(p.ca)}"></i></div></div>
      <div><div class="k">PA</div><div class="v" style="color:${tone(p.pa)}">${p.pa}</div><div class="meter"><i style="width:${p.pa / 2}%;background:${tone(p.pa)}"></i></div></div>
      <div><div class="k">${esc(t('margin'))}</div><div class="v">${p.pa - p.ca > 0 ? '+' : ''}${p.pa - p.ca}</div></div>
      <div><div class="k">${esc(t('contract'))}</div><div class="v" style="font-size:13px">${p.livre ? `<span class="tag free">${esc(t('free'))}</span>` : esc(p.clube) + `<div class="sub">${esc(t('until'))} ${p.contrato_ano}</div>`}${listTags(p)}</div></div>
    </div></div>
    <div class="grid2">
      <div class="card"><h4>${esc(t('profile'))}</h4>${radar(ax)}</div>
      <div class="card"><h4>${esc(t('positions'))}</h4>${bigPitch(p.pos)}
        <div class="feet"><div><div class="sub">${esc(t('leftFoot'))}</div><b>${esc(foot(A[24]))}</b></div><div><div class="sub">${esc(t('rightFoot'))}</div><b>${esc(foot(A[25]))}</b></div></div></div>
    </div>
    <div class="card"><h4>${esc(t('attributes'))}</h4><div class="attrs">${isGK ? col('goalkeeping') : col('technical')}${col('mental')}${col('physical')}</div></div>
    <div class="card"><h4>${esc(t('hidden'))}</h4><div class="attrs">${col('hidden')}</div></div>
    <div class="note">ⓘ ${esc(t('attrNote'))}</div>
   </div>`;
  $('#dclose').onclick = closeDrawer;
  $('#dfav').onclick = () => toggleFav(p.uid);
  $('#dlink').onclick = () => { const u = new URL(location.href); u.searchParams.set('p', p.uid); navigator.clipboard?.writeText(u.href); toast(t('linkCopied')); };
  $('#drawer').classList.add('on'); $('#shade').classList.add('on');
  const u = new URL(location.href); u.searchParams.set('p', p.uid); history.replaceState(null, '', u);
}
function closeDrawer() {
  $('#drawer').classList.remove('on'); $('#shade').classList.remove('on');
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

// ---------- data
async function load(path) {
  const b = $('#refresh'); b.disabled = true; b.innerHTML = `<span class="spin"></span>${esc(t('reading'))}`;
  try {
    const r = await (await fetch(path)).json();
    $('#ver').textContent = r.version ? 'v' + r.version : '';
    lastErr = r.erro ? (t('err_' + r.erro_code) !== 'err_' + r.erro_code ? t('err_' + r.erro_code) : r.erro) : null;
    if (r.meta) {
      META = r.meta;
      const c = r.campos;
      ALL = r.linhas.map(row => { const o = {}; c.forEach((k, i) => o[k] = row[i]); o._n = norm(o.nome); o._c = norm(o.clube); return o; });
      fillNations();
    }
    setStatus();
    apply();
    const pid = +URLP.get('p'); if (pid && ALL.length && !$('#drawer').classList.contains('on')) openPlayer(pid);
  } catch {
    lastErr = t('err_offline'); setStatus(); render();
  } finally { b.disabled = false; b.textContent = t('refresh'); }
}
function setStatus() {
  const st = $('#status');
  if (lastErr && !ALL.length) { st.className = 'status err'; $('#statusTxt').textContent = lastErr; }
  else if (META) { st.className = lastErr ? 'status err' : 'status'; $('#statusTxt').textContent = `${fmt(META.total)} ${t('players')}` + (META.ano_jogo ? ` · ${gameDateText()} ${t('gameDate')}` : '') + ` · ${META.lido_em}`; }
  else { st.className = 'status wait'; $('#statusTxt').textContent = t('connecting'); }
  $('#anoJogo').value = gameYear();
  $('#yearHint').textContent = !F.year && META?.ano_jogo ? `${gameDateText()} · ${t('detected')}` : '';
}
function fillNations() {
  const c = {}; ALL.forEach(p => { if (p.nacao) c[p.nacao] = (c[p.nacao] || 0) + 1; });
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
  $$('#sexo button').forEach(b => b.classList.toggle('on', b.dataset.v === F.sexo));
  $$('#pe button').forEach(b => b.classList.toggle('on', b.dataset.v === (F.pe || '')));
  $$('#posMin button').forEach(b => b.classList.toggle('on', +b.dataset.v === +F.posMin));
  $$('#natQuick button').forEach(b => b.classList.toggle('on', b.dataset.v === F.nat));
  $$('#pitch .pc').forEach(b => b.classList.toggle('on', F.pos.includes(+b.dataset.p)));
  RANGES.forEach(([id]) => $('#' + id)._paint && $('#' + id)._paint());
}
$('#q').oninput = e => { F.q = e.target.value; debounced(); };
$('#anoJogo').oninput = e => { F.year = +e.target.value || null; $('#yearHint').textContent = ''; debounced(); };
$('#nat').onchange = e => { F.nat = e.target.value; sync(); apply(); };
$$('#sexo button').forEach(b => b.onclick = () => { F.sexo = b.dataset.v; sync(); apply(); });
$$('#pe button').forEach(b => b.onclick = () => { F.pe = b.dataset.v; sync(); apply(); });
$$('#posMin button').forEach(b => b.onclick = () => { F.posMin = +b.dataset.v; sync(); apply(); });
$$('th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; F.dir = F.sort === k ? -F.dir : (['nome', 'nacao', 'clube', 'pos0'].includes(k) ? 1 : -1); F.sort = k; apply(); });
$('#rows').onclick = e => {
  const s = e.target.closest('[data-fav]'); if (s) { e.stopPropagation(); return toggleFav(+s.dataset.fav); }
  const tr = e.target.closest('tr'); if (tr) openPlayer(+tr.dataset.uid);
};
$('#more').onclick = () => { shown += PAGE; render(); };
$('#tblWrap').onscroll = e => { const el = e.target; if (el.scrollTop + el.clientHeight > el.scrollHeight - 300 && VIEW.length > shown) { shown += PAGE; render(); } };
$('#refresh').onclick = () => load('/api/refresh');
$('#reset').onclick = () => { F = Object.assign({}, DEF, {theme: F.theme, lang: F.lang, pos: []}); sync(); setStatus(); apply(); };
$('#posClear').onclick = () => { F.pos = []; sync(); apply(); };
$('#theme').onclick = () => { F.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); RANGES.forEach(([id]) => drawHist($('#' + id))); store('f', F); };
$('#lang').onclick = () => { F.lang = LANG() === 'pt' ? 'en' : 'pt'; applyLang(); if (ALL.length) fillNations(); sync(); setStatus(); apply(); };
$('#shade').onclick = closeDrawer;
$('#csv').onclick = () => {
  const cols = ['nome', 'idade', 'ca', 'pa', 'gap', 'nacao', 'clube', 'contrato_ano', 'livre', 'lista_transf', 'lista_emprest', 'pe', 'uid'];
  const lines = [cols.join(';'), ...VIEW.map(p => cols.map(c => `"${String(p[c] ?? '').replace(/"/g, '""')}"`).join(';'))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], {type: 'text/csv;charset=utf-8'})); a.download = 'pitchlens.csv'; a.click();
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === '/' && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
});

// ---------- boot (URL params win: ?lang=en|pt&theme=dark|light&p=<uid>)
if (URLP.get('lang')) F.lang = URLP.get('lang') === 'pt' ? 'pt' : 'en';
if (!F.lang) F.lang = (navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en';
if (URLP.get('theme')) F.theme = URLP.get('theme') === 'light' ? 'light' : 'dark';
applyTheme(); applyLang(); sync(); setStatus(); render();
load('/api/players');
// heartbeat: in desktop mode the server stops by itself a few minutes after the window is gone
const alive = () => fetch('/api/ping?alive=1').catch(() => {});
alive(); setInterval(alive, 30000);

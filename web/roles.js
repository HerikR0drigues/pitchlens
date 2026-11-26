// Pitchlens - role ratings and similar players.
// The ratings are Pitchlens' own formula (not the game's): a weighted average of the attributes that matter
// for each role (key x5, preferable x3, everything else in the group x1), scaled to 0-100, then adjusted by how
// well the player knows the role's positions. Attribute names follow ATTR_NAMES.en; positions follow POS_NAMES.
'use strict';

const ROLE_DEFS = [
  // [id, positions, key attributes, preferable attributes, goalkeeper?]
  ['gk', [0], ['Aerial Reach', 'Command of Area', 'Communication', 'Handling', 'Kicking', 'One on Ones', 'Reflexes', 'Concentration', 'Positioning', 'Agility'],
    ['Throwing', 'Rushing Out', 'Anticipation', 'Decisions'], true],
  ['sk', [0], ['Command of Area', 'Kicking', 'One on Ones', 'Reflexes', 'Rushing Out', 'Anticipation', 'Composure', 'Concentration', 'Positioning', 'Agility'],
    ['Aerial Reach', 'Communication', 'Handling', 'Throwing', 'First Touch', 'Passing', 'Decisions', 'Vision', 'Acceleration'], true],
  ['cd', [3], ['Heading', 'Marking', 'Tackling', 'Positioning', 'Jumping Reach', 'Strength'],
    ['Aggression', 'Anticipation', 'Bravery', 'Composure', 'Concentration', 'Decisions', 'Pace']],
  ['bpd', [3], ['Heading', 'Marking', 'Passing', 'Tackling', 'Composure', 'Positioning', 'Jumping Reach', 'Strength'],
    ['First Touch', 'Technique', 'Vision', 'Anticipation', 'Bravery', 'Concentration', 'Decisions', 'Pace']],
  ['fb', [2, 4], ['Marking', 'Tackling', 'Anticipation', 'Concentration', 'Positioning', 'Teamwork'],
    ['Crossing', 'Passing', 'Technique', 'Decisions', 'Work Rate', 'Acceleration', 'Pace', 'Stamina']],
  ['wb', [2, 4, 13, 14], ['Crossing', 'Dribbling', 'Tackling', 'Teamwork', 'Work Rate', 'Acceleration', 'Stamina'],
    ['First Touch', 'Marking', 'Passing', 'Technique', 'Anticipation', 'Decisions', 'Flair', 'Off the Ball', 'Positioning', 'Agility', 'Balance', 'Pace']],
  ['iwb', [2, 4, 13, 14], ['Passing', 'Tackling', 'Anticipation', 'Composure', 'Decisions', 'Teamwork'],
    ['First Touch', 'Marking', 'Technique', 'Vision', 'Concentration', 'Positioning', 'Work Rate', 'Acceleration', 'Agility', 'Stamina']],
  ['dm', [5], ['Tackling', 'Anticipation', 'Concentration', 'Positioning', 'Teamwork'],
    ['Marking', 'Passing', 'Composure', 'Decisions', 'Work Rate', 'Stamina', 'Strength']],
  ['dlp', [5, 7], ['First Touch', 'Passing', 'Technique', 'Composure', 'Decisions', 'Teamwork', 'Vision'],
    ['Anticipation', 'Off the Ball', 'Positioning', 'Balance']],
  ['bwm', [5, 7], ['Tackling', 'Aggression', 'Anticipation', 'Teamwork', 'Work Rate', 'Stamina'],
    ['Marking', 'Bravery', 'Concentration', 'Positioning', 'Agility', 'Pace', 'Strength']],
  ['b2b', [7], ['Passing', 'Tackling', 'Off the Ball', 'Teamwork', 'Work Rate', 'Stamina'],
    ['Dribbling', 'First Touch', 'Long Shots', 'Technique', 'Aggression', 'Anticipation', 'Composure', 'Decisions', 'Positioning', 'Acceleration', 'Balance', 'Pace', 'Strength']],
  ['mez', [7], ['Passing', 'Technique', 'Decisions', 'Off the Ball', 'Work Rate', 'Acceleration'],
    ['Dribbling', 'First Touch', 'Long Shots', 'Anticipation', 'Composure', 'Flair', 'Vision', 'Balance', 'Stamina']],
  ['ap', [7, 10], ['First Touch', 'Passing', 'Technique', 'Composure', 'Decisions', 'Off the Ball', 'Teamwork', 'Vision'],
    ['Dribbling', 'Anticipation', 'Flair', 'Agility']],
  ['am', [10], ['Dribbling', 'First Touch', 'Long Shots', 'Passing', 'Technique', 'Anticipation', 'Decisions', 'Flair', 'Off the Ball'],
    ['Finishing', 'Composure', 'Vision', 'Agility']],
  ['ss', [10], ['Dribbling', 'Finishing', 'First Touch', 'Anticipation', 'Composure', 'Off the Ball', 'Acceleration'],
    ['Passing', 'Technique', 'Concentration', 'Decisions', 'Work Rate', 'Agility', 'Balance', 'Pace', 'Stamina']],
  ['w', [6, 8, 9, 11], ['Crossing', 'Dribbling', 'Technique', 'Acceleration', 'Agility'],
    ['First Touch', 'Passing', 'Off the Ball', 'Work Rate', 'Balance', 'Pace', 'Stamina']],
  ['iw', [6, 8, 9, 11], ['Crossing', 'Dribbling', 'Passing', 'Technique', 'Acceleration', 'Agility'],
    ['First Touch', 'Long Shots', 'Composure', 'Decisions', 'Off the Ball', 'Vision', 'Work Rate', 'Balance', 'Pace', 'Stamina']],
  ['if', [9, 11], ['Dribbling', 'Finishing', 'First Touch', 'Technique', 'Anticipation', 'Off the Ball', 'Acceleration', 'Agility'],
    ['Long Shots', 'Passing', 'Composure', 'Flair', 'Work Rate', 'Balance', 'Pace', 'Stamina']],
  ['af', [12], ['Dribbling', 'Finishing', 'First Touch', 'Technique', 'Composure', 'Off the Ball', 'Acceleration'],
    ['Passing', 'Anticipation', 'Decisions', 'Work Rate', 'Agility', 'Balance', 'Pace', 'Stamina']],
  ['p', [12], ['Finishing', 'Anticipation', 'Composure', 'Off the Ball'],
    ['First Touch', 'Heading', 'Technique', 'Decisions', 'Acceleration']],
  ['tf', [12], ['Heading', 'Bravery', 'Composure', 'Off the Ball', 'Balance', 'Jumping Reach', 'Strength'],
    ['Finishing', 'First Touch', 'Aggression', 'Anticipation', 'Decisions', 'Teamwork']],
  ['dlf', [12], ['First Touch', 'Passing', 'Technique', 'Composure', 'Decisions', 'Off the Ball', 'Teamwork'],
    ['Dribbling', 'Finishing', 'Anticipation', 'Flair', 'Vision', 'Balance', 'Strength']],
  ['pf', [12], ['Aggression', 'Anticipation', 'Bravery', 'Decisions', 'Teamwork', 'Work Rate', 'Acceleration', 'Stamina'],
    ['First Touch', 'Finishing', 'Composure', 'Concentration', 'Agility', 'Balance', 'Pace', 'Strength']],
  ['cf', [12], ['Dribbling', 'Finishing', 'First Touch', 'Heading', 'Long Shots', 'Passing', 'Technique', 'Anticipation', 'Composure', 'Decisions', 'Off the Ball', 'Vision', 'Acceleration', 'Agility', 'Strength'],
    ['Work Rate', 'Teamwork', 'Balance', 'Jumping Reach', 'Pace', 'Stamina']],
];

const ROLE_NAMES = {
  en: {gk: 'Goalkeeper', sk: 'Sweeper Keeper', cd: 'Central Defender', bpd: 'Ball-Playing Defender', fb: 'Full-Back', wb: 'Wing-Back',
       iwb: 'Inverted Wing-Back', dm: 'Defensive Midfielder', dlp: 'Deep-Lying Playmaker', bwm: 'Ball-Winning Midfielder', b2b: 'Box-to-Box',
       mez: 'Mezzala', ap: 'Advanced Playmaker', am: 'Attacking Midfielder', ss: 'Shadow Striker', w: 'Winger', iw: 'Inverted Winger',
       if: 'Inside Forward', af: 'Advanced Forward', p: 'Poacher', tf: 'Target Forward', dlf: 'Deep-Lying Forward', pf: 'Pressing Forward',
       cf: 'Complete Forward'},
  pt: {gk: 'Goleiro', sk: 'Goleiro líbero', cd: 'Zagueiro', bpd: 'Zagueiro construtor', fb: 'Lateral', wb: 'Ala',
       iwb: 'Lateral invertido', dm: 'Volante', dlp: 'Armador recuado', bwm: 'Volante marcador', b2b: 'Box-to-box',
       mez: 'Mezzala', ap: 'Armador', am: 'Meia atacante', ss: 'Segundo atacante', w: 'Ponta', iw: 'Ponta invertido',
       if: 'Ponta finalizador', af: 'Atacante de área', p: 'Matador', tf: 'Pivô', dlf: 'Atacante recuado', pf: 'Atacante de pressão',
       cf: 'Atacante completo'},
};

// attribute groups used as the "everything else" part of the average
const OUTFIELD_SET = [...Array(11).keys(), 17, 18, 20, 22, 23, 26, 28, 29, 30, 34, 35, 36, 37, 38, 39, 40, 42, 43, 45, 46, 50, 51, 52, 53];
const GK_SET = [11, 12, 13, 14, 15, 16, 19, 21, 31, 32, 33, 17, 18, 20, 52, 53, 34, 46, 39, 7, 22];

const ROLES = ROLE_DEFS.map(([id, pos, key, pref, gk]) => {
  const idx = n => { const i = ATTR_NAMES.en.indexOf(n); if (i < 0) throw new Error('unknown attribute ' + n); return i; };
  const w = new Map((gk ? GK_SET : OUTFIELD_SET).map(i => [i, 1]));
  pref.forEach(n => w.set(idx(n), 3)); key.forEach(n => w.set(idx(n), 5));
  const ids = [...w.keys()], ws = ids.map(i => w.get(i)), total = ws.reduce((a, b) => a + b, 0);
  return {id, pos, gk: !!gk, ids, ws, total};
});
const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));
const roleName = id => (ROLE_NAMES[LANG()] || ROLE_NAMES.en)[id] || id;

// attrs come from the server as one string per player: chr(48 + value)
function attrsOf(p) { if (!p._a) { const s = p.a || ''; p._a = new Uint8Array(54); for (let i = 0; i < 54; i++) p._a[i] = (s.charCodeAt(i) - 48) || 1; } return p._a; }

// 0-100 from the attributes only
function roleRaw(p, r) {
  const A = attrsOf(p); let s = 0;
  for (let i = 0; i < r.ids.length; i++) s += A[r.ids[i]] * r.ws[i];
  return Math.round((s / r.total - 1) / 19 * 100);
}
// familiarity with the role's positions: natural 100%, accomplished 95%, unconvincing 85%, otherwise 70%
function roleFit(p, r) { const f = Math.max(...r.pos.map(i => p.pos[i] || 1)); return f >= 18 ? 1 : f >= 15 ? .95 : f >= 10 ? .85 : .7; }
const roleRating = (p, r) => Math.round(roleRaw(p, r) * roleFit(p, r));

// best role for each player (cached until the data reloads)
function bestRole(p) {
  if (p._best === undefined) {
    let best = null, val = -1;
    for (const r of ROLES) { const v = roleRating(p, r); if (v > val) { val = v; best = r.id; } }
    p._best = best; p._bestR = val;
  }
  return p._best;
}
function topRoles(p, n = 6) { return ROLES.map(r => [r.id, roleRating(p, r), roleRaw(p, r)]).sort((a, b) => b[1] - a[1]).slice(0, n); }

// similar players: distance between attribute profiles (goalkeepers with goalkeepers, men with men, women with women)
function similarPlayers(p, pool, n = 8) {
  const gk = (p.pos[0] || 0) >= 15, set = gk ? GK_SET : OUTFIELD_SET, A = attrsOf(p), out = [];
  for (const o of pool) {
    if (o.uid === p.uid || ((o.pos[0] || 0) >= 15) !== gk || !o.a || !o.female !== !p.female) continue;
    const B = attrsOf(o); let d = 0;
    for (const i of set) { const x = A[i] - B[i]; d += x * x; }
    out.push([o, d]);
    if (out.length > 4 * n) { out.sort((a, b) => a[1] - b[1]); out.length = n; }
  }
  out.sort((a, b) => a[1] - b[1]);
  const max = 19 * 19 * set.length;
  return out.slice(0, n).map(([o, d]) => [o, Math.max(0, Math.round(100 - Math.sqrt(d / max) * 250))]);
}

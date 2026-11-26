// Tests for the browser-side logic (role ratings, similar players, best XI) using Node's built-in test runner.
// Run: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = f => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const ctx = {LANG: () => 'en', console};
vm.createContext(ctx);
// i18n.js and roles.js only declare data and functions; tools.js needs FAV/ALL/PXY only inside functions
vm.runInContext(web('i18n.js') + web('roles.js') + web('tools.js') +
  ';globalThis.T = {ROLES, ROLE_BY_ID, roleRaw, roleRating, topRoles, bestRole, similarPlayers, pickXI, FORMATIONS, slotRating, ATTR_NAMES};', ctx);
const T = ctx.T;

const attrs = f => String.fromCharCode(...Array.from({length: 54}, (_, i) => 48 + f(i)));
const mk = (uid, f, posIdx, fam = 20) => { const pos = Array(15).fill(1); pos[posIdx] = fam; return {uid, a: attrs(f), pos}; };

test('every role uses known attributes and positions', () => {
  assert.strictEqual(T.ROLES.length, 24);
  for (const r of T.ROLES) {
    assert.ok(r.ids.every(i => i >= 0 && i < 54), r.id);
    assert.ok(r.pos.every(i => i >= 0 && i < 15), r.id);
    assert.ok(r.ws.length === r.ids.length && r.total > 0, r.id);
  }
});

test('ratings go from 0 (all 1s) to 100 (all 20s)', () => {
  const st = T.ROLE_BY_ID.af;
  assert.strictEqual(T.roleRaw(mk(1, () => 1, 12), st), 0);
  assert.strictEqual(T.roleRaw(mk(2, () => 20, 12), st), 100);
});

test('position familiarity lowers the rating', () => {
  const st = T.ROLE_BY_ID.af, f = () => 15;
  assert.ok(T.roleRating(mk(1, f, 12, 20), st) > T.roleRating(mk(2, f, 12, 12), st));
  assert.ok(T.roleRating(mk(3, f, 12, 12), st) > T.roleRating(mk(4, f, 3, 20), st));
});

test('a finisher is rated best as a poacher-type striker, not a keeper', () => {
  const fin = ['Finishing', 'Anticipation', 'Composure', 'Off the Ball'].map(n => T.ATTR_NAMES.en.indexOf(n));
  const p = mk(1, i => fin.includes(i) ? 20 : 8, 12);
  assert.strictEqual(T.bestRole(p), 'p');
  assert.ok(T.topRoles(p, 3).every(([id]) => !T.ROLE_BY_ID[id].gk));
});

test('similar players are sorted by closeness and skip the player himself', () => {
  const base = mk(1, i => 10 + (i % 5), 12);
  const near = mk(2, i => 10 + (i % 5) + (i === 3 ? 1 : 0), 12), far = mk(3, () => 2, 12), gk = mk(4, i => 10 + (i % 5), 0);
  const twin = Object.assign(mk(5, i => 10 + (i % 5), 12), {female: true});
  const out = T.similarPlayers(base, [base, far, near, gk, twin], 3);
  assert.deepStrictEqual(Array.from(out, ([o]) => o.uid), [2, 3]);
  assert.ok(out[0][1] > out[1][1]);
});

test('best XI fills every slot once with the best fits', () => {
  for (const [name, slots] of Object.entries(T.FORMATIONS)) assert.strictEqual(slots.length, 11, name);
  const slots = T.FORMATIONS['4-3-3'], pool = [];
  slots.forEach(([pos], i) => { pool.push(mk(100 + i, () => 15, pos)); pool.push(mk(200 + i, () => 8, pos)); });
  const xi = T.pickXI(pool, slots);
  const uids = xi.map(x => x[0].uid);
  assert.strictEqual(new Set(uids).size, 11);
  assert.ok(uids.every(u => u >= 100 && u < 200), 'the stronger player of each position should start');
  const bench = T.pickXI(pool, slots, new Set(uids));
  assert.ok(bench.every(x => x && x[0].uid >= 200));
});

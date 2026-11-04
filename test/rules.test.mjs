// Unit tests for the pure game rules: node --test test/rules.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import * as R from '../server/rules.js';
const S = R.DEFAULTS; const T0 = Date.UTC(2026, 10, 4, 6, 30);
const opts = (d = 1, extra = {}) => ({ settings: S, density: d, customSpecies: [], events: {}, ...extra });
test('spawns are deterministic: same area + time => same shadows (friends see the same ones)', () => {
  const a = R.spawnsForCell(10000, 8000, T0, opts(3)), b = R.spawnsForCell(10000, 8000, T0, opts(3)); assert.deepEqual(a, b); assert.ok(a.length > 0);
  const c = R.spawnsForCell(10001, 8000, T0, opts(3)); assert.notDeepEqual(a.map(x => x.id), c.map(x => x.id));
});
test('spawn positions stay inside their cell, timers are in the future and below the slot period', () => {
  for (const sp of R.spawnsForCell(10000, 8000, T0, opts(6))) { assert.ok(sp.lat >= 8000 * R.CELL && sp.lat <= 8001 * R.CELL); assert.ok(sp.lng >= 10000 * R.CELL && sp.lng <= 10001 * R.CELL); assert.ok(sp.expires > T0 && sp.expires - sp.born <= S.spawnLifeMax * 1000 + 1); }
});
test('spawn id round trip + spawnById refuses forged ids and expired spawns', () => {
  const sp = R.spawnsForCell(10000, 8000, T0, opts(6))[0]; assert.deepEqual(R.spawnById(sp.id, T0, opts(6)), sp); assert.equal(R.spawnById('1:2:3:4', T0, opts(6)), null); assert.equal(R.spawnById('abc', T0, opts(6)), null); assert.equal(R.spawnById(sp.id, sp.expires + 1000, opts(6)), null);
});
test('density adapts to the area: more recent players / hot zones => more spawns, admin multiplier and events apply, clamped', () => {
  assert.ok(R.densityFor(0) < R.densityFor(7)); assert.ok(R.densityFor(3, 2) > R.densityFor(3, 1)); assert.equal(R.densityFor(0, 1, { ...S, density: 0 }), 0); assert.ok(R.densityFor(1000, 4, { ...S, density: 6 }) <= 6); assert.ok(R.densityFor(2, 1, S, { densityMult: 1.6 }) > R.densityFor(2, 1, S));
  let lo = 0, hi = 0; for (let x = 0; x < 200; x++) { lo += R.spawnsForCell(x, 5, T0, opts(0.6)).length; hi += R.spawnsForCell(x, 5, T0, opts(2.5)).length; } assert.ok(hi > lo * 1.5, `${hi} vs ${lo}`);
});
test('day/night cycle by local solar time: night shadows are rarer/stronger, day weaker', () => {
  const lng = 77; const night = Date.UTC(2026, 10, 4, 18, 0) - 0, day = Date.UTC(2026, 10, 4, 6, 30);   // 18:00 UTC at 77E ~ 23:08 solar; 06:30 UTC ~ 11:38 solar
  assert.equal(R.dayPhase(night, lng).phase, 'night'); assert.equal(R.dayPhase(day, lng).phase, 'day'); assert.equal(R.dayPhase(Date.UTC(2026, 10, 4, 12, 0), lng).phase, 'dusk');
  const wn = R.rarityWeightsFor('night', S), wd = R.rarityWeightsFor('day', S); assert.ok(wn[5] > wd[5] * 20); assert.ok(wn[0] < wd[0]);
  assert.equal(R.dayPhase(night, lng + 180).phase !== undefined, true); // longitude shifts local time
  const base = R.dayPhase(T0, 0).hour, shifted = R.dayPhase(T0, 90).hour; assert.ok(Math.abs(((shifted - base + 24) % 24) - 6) < 0.01);
  // event can force night everywhere
  const forced = []; for (let x = 0; x < 300; x++) for (const sp of R.spawnsForCell(x, 3, day, opts(4, { events: { forceNight: true } }))) forced.push(sp.phase); assert.ok(forced.length && forced.every(p => p === 'night'));
});
test('rarity mix: weights respected, events/custom species flow through', () => {
  let counts = [0, 0, 0, 0, 0, 0]; for (let x = 0; x < 2000; x++) for (const sp of R.spawnsForCell(x, 7, T0, opts(3))) counts[sp.r]++; assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] > counts[3]); assert.ok(counts[5] < counts[0] / 50);
  const custom = [{ id: 'c_x', name: 'X', r: 0, shape: 'wisp', base: { hp: 10, atk: 5, def: 1 }, hue: 280, eyes: 2, horns: 0, ab: 'a' }]; let seen = false; for (let x = 0; x < 300 && !seen; x++) seen = R.spawnsForCell(x, 9, T0, opts(4, { customSpecies: custom })).some(s => s.sp === 'c_x'); assert.ok(seen);
  const ev = { rarityMult: [0, 0, 0, 0, 0, 1] }; for (let x = 0; x < 100; x++) for (const sp of R.spawnsForCell(x, 11, T0, opts(4, { events: ev }))) assert.equal(sp.r, 5);
});
test('anti-cheat: precise limits', () => {
  const p = { lat: 25, lng: 82, ts: 1000000 }; const m = (d) => ({ lat: 25 + d / 111320, lng: 82 });
  assert.equal(R.checkMove(p, m(30 + 9 * 10 - 1), p.ts + 10000).ok, true); assert.equal(R.checkMove(p, m(30 + 9 * 10 + 5), p.ts + 10000).ok, false);
  const t = R.checkMove(p, m(5000), p.ts + 2000); assert.equal(t.ok, false); assert.equal(t.reason, 'too_fast');
  assert.equal(R.checkMove(p, m(10), p.ts + 300).reason, 'too_frequent'); assert.equal(R.checkMove(p, { lat: 999, lng: 0 }, p.ts + 5000).reason, 'bad_position'); assert.equal(R.checkMove(p, { lat: 0, lng: 0 }, p.ts + 5000).reason, 'bad_position');
  assert.equal(R.checkMove(null, m(1), 5).first, true);
  const long = R.checkMove(p, m(200000), p.ts + 40 * 60000); assert.equal(long.ok, true); assert.equal(long.relocated, true);     // flew somewhere: allowed after a long gap but flagged (arrival cooldown)
  assert.equal(R.walkedMeters(R.checkMove(p, m(12), p.ts + 10000)), R.distM(p, m(12))); assert.equal(R.walkedMeters(long), 0); assert.equal(R.walkedMeters({ ok: true, dist: 100, speed: 20 }), 0);
});
test('XP / level / rank maths', () => {
  assert.equal(R.levelFromXp(0), 1); assert.equal(R.levelFromXp(99), 1); assert.equal(R.levelFromXp(100), 2); assert.equal(R.levelFromXp(R.xpForLevel(10)), 10); assert.equal(R.levelFromXp(R.xpForLevel(10) - 1), 9);
  for (let l = 1; l < 80; l++) assert.ok(R.xpForLevel(l + 1) > R.xpForLevel(l));
  assert.equal(R.rankOf(1).id, 'E'); assert.equal(R.rankOf(9).id, 'E'); assert.equal(R.rankOf(10).id, 'D'); assert.equal(R.rankOf(29).id, 'C'); assert.equal(R.rankOf(30).id, 'B'); assert.equal(R.rankOf(45).id, 'A'); assert.equal(R.rankOf(60).id, 'S'); assert.equal(R.rankOf(99).id, 'S');
  const a = R.rewardFor(10, 0, 'wild'), b = R.rewardFor(10, 4, 'wild'); assert.ok(b.xp > a.xp * 2); assert.equal(R.rewardFor(10, 0, 'wild', { xp: 2 }).xp, a.xp * 2);
  const ps = R.playerStats(10, [{ power: 700 }, { power: 100 }], { blade: { bonus: { atk: 10, luck: 8 } } }); const ps0 = R.playerStats(10, [], {}); assert.ok(ps.atk > ps0.atk + 10); assert.equal(ps.luck, 0.08);
});
test('shadow stats, evolution, level caps and costs', () => {
  const sp = R.SPECIES_BY_ID.ashhound; const s1 = R.statsFor(sp, 1), s10 = R.statsFor(sp, 10), e = R.statsFor(sp, 10, 2); assert.ok(s10.atk > s1.atk && e.atk > s10.atk); assert.equal(R.MAX_LEVEL_BY_STAGE[1], 15); assert.ok(R.levelUpCost(10) > R.levelUpCost(2)); assert.ok(R.evolveCost(2) > R.evolveCost(1));
  assert.equal(R.speciesName(sp, 2), 'Elite Ashhound'); assert.ok(R.releaseValue({ level: 10, r: 3, stage: 1 }) > R.releaseValue({ level: 10, r: 0, stage: 1 })); assert.equal(R.SPECIES.length, 28); assert.equal(new Set(R.SPECIES.map(s => s.id)).size, 28);
});
test('fight resolution is deterministic from the seed and cannot be rerolled', () => {
  const mk = (seed) => R.newFight({ hp: 200, atk: 40, def: 8, luck: 0 }, { hp: 150, atk: 20, def: 5, r: 1 }, seed);
  const run = (seed) => { const f = mk(seed); for (let i = 0; i < 40 && f.status === 'active'; i++) R.fightAct(f, i % 4 === 3 ? 'guard' : 'strike', 0.5); return JSON.stringify(f); };
  assert.equal(run('abc'), run('abc')); assert.notEqual(run('abc'), run('abd'));
  const f = mk('x'); R.fightAct(f, 'strike', 1); const t = f.turn; assert.equal(t, 1); const before = JSON.stringify(f); R.fightAct({ ...f, status: 'won' }, 'strike'); assert.equal(JSON.stringify(f), before);
});
test('fight: strike damage, timing bonus capped, guard reduces damage, bind rules, flee, defeat', () => {
  const base = () => R.newFight({ hp: 500, atk: 50, def: 5, luck: 0 }, { hp: 1000, atk: 30, def: 0, r: 0 }, 'seedA');
  let a = base(), b = base(); R.fightAct(a, 'strike', 0); R.fightAct(b, 'strike', 1); assert.ok(a.emax - a.ehp > 0 && (b.emax - b.ehp) >= (a.emax - a.ehp) && (b.emax - b.ehp) <= (a.emax - a.ehp) * 1.4);
  const f = base(); R.fightAct(f, 'bind'); assert.equal(f.status, 'active'); assert.equal(f.turn, 0); assert.ok(f.log.some(l => /weaken/.test(l)));   // too healthy: no turn spent
  const g1 = base(), g2 = base(); g1.intent = g2.intent = 'heavy'; g1.php = g2.php = 300; R.fightAct(g1, 'guard'); R.fightAct(g2, 'strike'); assert.ok(g1.php > g2.php);
  const w = base(); w.ehp = 100; assert.ok(R.bindChance(w) > 0); w.ehp = 900; assert.equal(R.bindChance(w), 0); const lowR = base(); lowR.ehp = 100; const hiR = R.newFight({ hp: 500, atk: 50, def: 5, luck: 0 }, { hp: 1000, atk: 30, def: 0, r: 5 }, 's'); hiR.ehp = 100; assert.ok(R.bindChance(lowR) > R.bindChance(hiR));
  const fl = base(); R.fightAct(fl, 'flee'); assert.equal(fl.status, 'fled');
  const weak = R.newFight({ hp: 20, atk: 5, def: 0, luck: 0 }, { hp: 9999, atk: 500, def: 0, r: 0 }, 'q'); for (let i = 0; i < 5 && weak.status === 'active'; i++) R.fightAct(weak, 'strike'); assert.equal(weak.status, 'lost');
  const kill = R.newFight({ hp: 500, atk: 500, def: 5, luck: 0 }, { hp: 10, atk: 5, def: 0, r: 0 }, 'k'); R.fightAct(kill, 'strike'); assert.equal(kill.status, 'won');
  let caught = 0; for (let i = 0; i < 200; i++) { const h = R.newFight({ hp: 5000, atk: 5, def: 99, luck: 0 }, { hp: 100, atk: 1, def: 0, r: 0 }, 'bind' + i); h.ehp = 5; R.fightAct(h, 'bind'); if (h.status === 'captured') caught++; } assert.ok(caught > 60 && caught < 200);
  let ex = 0; for (let i = 0; i < 400; i++) if (R.extractRoll('e' + i, 0)) ex++; let ex5 = 0; for (let i = 0; i < 400; i++) if (R.extractRoll('e' + i, 5)) ex5++; assert.ok(ex > ex5 * 2);
});
test('dungeon: plan is deterministic, scales with party, waves + boss, timer, clear/fail', () => {
  const p1 = R.dungeonPlan('g:1:2:3', 2, 1), p2 = R.dungeonPlan('g:1:2:3', 2, 1), p3 = R.dungeonPlan('g:1:2:3', 2, 3); assert.deepEqual(p1, p2); assert.equal(p1.waves.length, 4); assert.equal(p1.waves[3][0].boss, true); assert.ok(p3.waves[0][0].max > p1.waves[0][0].max); assert.ok(R.dungeonPlan('g:1:2:3', 5, 1).limitMs > R.dungeonPlan('g:1:2:3', 0, 1).limitMs);
  const mem = [{ id: 'a', name: 'A', hp: 100000, atk: 100000, def: 9999, luck: 0 }]; const d = R.newDungeon('g:1:2:3', 1, mem, 1000); for (let i = 0; i < 30 && d.status === 'active'; i++) R.dungeonAct(d, 'a', 'strike', 1, 2000 + i); assert.equal(d.status, 'cleared');
  const d2 = R.newDungeon('g:1:2:3', 1, mem, 1000); R.dungeonAct(d2, 'a', 'strike', 0, d2.deadline + 1); assert.equal(d2.status, 'failed');
  const weak = R.newDungeon('g:9:9:9', 4, [{ id: 'w', name: 'W', hp: 5, atk: 1, def: 0, luck: 0 }], 1000); for (let i = 0; i < 20 && weak.status === 'active'; i++) R.dungeonAct(weak, 'w', 'strike', 0, 2000); assert.equal(weak.status, 'failed');
  const g = R.gatesForCell(1, 1, T0, { settings: { ...S, gateChance: 1 } }); assert.equal(g.length, 1); assert.equal(R.parseGateId(g[0].id).gx, 1); assert.deepEqual(R.gatesForCell(1, 1, T0, { settings: { ...S, gateChance: 0 } }), []); assert.deepEqual(R.gatesForCell(1, 1, T0, { settings: { ...S, gateChance: 1 } }), g);
});
test('territory: zone grid, decay, weekly reset, guardian', () => {
  const z = R.zoneOf(25.3176, 82.9739); assert.equal(R.zoneId(z.cx, z.cy), `${Math.floor(82.9739 / R.ZONE)}:${Math.floor(25.3176 / R.ZONE)}`);
  const row = { power: 100, claimed_at: T0, week: R.weekKey(T0) }; assert.equal(R.territoryPower(row, T0), 100); assert.equal(R.territoryPower(row, T0 + R.DAY), 100 - R.ZONE_DECAY_PER_DAY); assert.equal(R.territoryPower(row, T0 + 20 * R.DAY), 0);
  assert.equal(R.territoryActive(row, T0 + R.DAY), true); assert.equal(R.territoryActive(row, T0 + 9 * R.DAY), false);   // decayed to 0 / new week
  assert.equal(R.territoryActive({ ...row, power: 100 }, T0 + 8 * R.DAY), false);          // week rolled over => reset even if power remained
  assert.equal(R.territoryActive(null, T0), false); assert.equal(R.weekKey(Date.UTC(2026, 10, 2, 0, 0)), R.weekKey(Date.UTC(2026, 10, 8, 23, 0))); assert.equal(R.weekKey(Date.UTC(2026, 10, 9, 0, 1)), R.weekKey(Date.UTC(2026, 10, 2, 0, 0)) + 1);
  const g1 = R.zoneGuardian(3, 4, T0, 0), g2 = R.zoneGuardian(3, 4, T0, 0), g3 = R.zoneGuardian(3, 4, T0, 100); assert.deepEqual(g1, g2); assert.ok(g3.level >= g1.level); assert.equal(R.zoneColor({ guild_color: '#fff' }, '#000'), '#fff'); assert.equal(R.zoneColor({}, '#000'), '#000'); assert.equal(R.zoneColor(null), null);
});
test('guild boss: deterministic weekly boss, scales with members, damage within bounds', () => {
  const a = R.guildBossPlan('g1', 2966, 1), b = R.guildBossPlan('g1', 2966, 1), c = R.guildBossPlan('g1', 2966, 10); assert.deepEqual(a, b); assert.ok(c.hp > a.hp * 3); assert.ok(R.SPECIES_BY_ID[a.sp].r >= 3);
  const dmg = R.guildAttackDamage({ atk: 100, legion: 300 }, 'x'); assert.ok(dmg > 100 && dmg < 1500); assert.equal(R.guildAttackDamage({ atk: 100, legion: 300 }, 'x'), dmg);
});
test('quests, streak, bounty, achievements', () => {
  const q = R.questsForDay(20000); assert.equal(q.length, 3); assert.deepEqual(q, R.questsForDay(20000)); assert.equal(new Set(q.map(x => x.type)).size, 3); assert.notDeepEqual(q, R.questsForDay(20001)); assert.ok(q.every(x => x.target >= 1 && x.xp > 0));
  assert.equal(R.streakAfter(3, 100, 100), 3); assert.equal(R.streakAfter(3, 99, 100), 4); assert.equal(R.streakAfter(3, 90, 100), 1); assert.equal(R.streakAfter(0, 0, 100), 1);
  assert.equal(R.dayKey(Date.UTC(2026, 10, 4, 18, 29), 330), R.dayKey(Date.UTC(2026, 10, 4, 0, 0), 330)); assert.equal(R.dayKey(Date.UTC(2026, 10, 4, 18, 31), 330), R.dayKey(Date.UTC(2026, 10, 4, 0, 0), 330) + 1);
  assert.equal(R.bountyForDay(5), R.bountyForDay(5)); assert.ok(R.SPECIES_BY_ID[R.bountyForDay(5)].r <= 3);
  const unlocked = R.ACHIEVEMENTS.filter(a => a.test({ caught: 25, best_rarity: 2, walked: 6000, gates: 0, zones: 0, trades: 0, crafted: 0, beacons: 0, bounties: 0, streak: 3, level: 10, guild: 0 })).map(a => a.key); assert.deepEqual(unlocked.sort(), ['catch_25', 'first_catch', 'rank_d', 'rare_find', 'streak_3', 'walk_5k'].sort());
});
test('relic crafting is deterministic per seed, valid slots and bonuses', () => {
  const a = R.craftRelic('u|1', 20), b = R.craftRelic('u|1', 20); assert.deepEqual(a, b); assert.ok(R.RELIC_SLOTS.includes(a.slot)); assert.ok(Object.values(a.bonus).every(v => v > 0)); const slots = new Set(); for (let i = 0; i < 60; i++) slots.add(R.craftRelic('s' + i, 20).slot); assert.equal(slots.size, 3);
  assert.deepEqual(R.CRAFT_COST, { shards: 5, essence: 50 });
});
test('validation helpers + friend codes + settings merge', () => {
  assert.ok(R.validUsername('abc_12') && !R.validUsername('ab') && !R.validUsername('a b c') && !R.validUsername('x'.repeat(21))); assert.ok(R.validPassword('secret') && !R.validPassword('12345'));
  const c = R.friendCode('seed'); assert.match(c, /^[A-Z2-9]{8}$/); assert.equal(R.friendCode('seed'), c); assert.notEqual(R.friendCode('seed2'), c);
  const m = R.mergeSettings({ density: 3, rarityWeights: [1, 2, 3], nightStat: 'x', bogus: 1 }); assert.equal(m.density, 3); assert.deepEqual(m.rarityWeights, R.DEFAULTS.rarityWeights); assert.equal(m.nightStat, R.DEFAULTS.nightStat); assert.equal(m.bogus, undefined);
  assert.ok(R.distM({ lat: 25, lng: 82 }, { lat: 25.001, lng: 82 }) > 100 && R.distM({ lat: 25, lng: 82 }, { lat: 25.001, lng: 82 }) < 120); assert.equal(R.cellsAround(25, 82, 100).length >= 1, true); assert.ok(R.cellsAround(25, 82, 600).length >= 9);
});

import * as R from '../server/rules.js';
// balance simulation: a hunter of level L (with a small legion) vs. wild shadows of each rarity, simple bot strategy
function fightOnce(L, legionPower, sp, level, seed) {
  const ps = R.playerStats(L, [{ power: legionPower }], {}); const es = R.statsFor(sp, level, 1, 1);
  const f = R.newFight(ps, { hp: es.hp, atk: es.atk, def: es.def, r: sp.r }, seed);
  for (let i = 0; i < 60 && f.status === 'active'; i++) { const act = f.ehp / f.emax <= 0.4 ? 'bind' : f.intent === 'heavy' ? 'guard' : (f.php < f.pmax * 0.35 ? 'guard' : 'power'); R.fightAct(f, act, 0.7); }
  return f.status;
}
for (const [L, lp] of [[1, 0], [5, 100], [10, 400], [20, 1500], [30, 4000], [45, 9000]]) {
  const row = [];
  for (let ri = 0; ri < 6; ri++) { let w = 0, N = 60; const pool = R.SPECIES.filter(s => s.r === ri); for (let k = 0; k < N; k++) { const sp = pool[k % pool.length]; const lvl = 1 + ri * 4 + (k % 5); const st = fightOnce(L, lp, sp, lvl, 's' + L + ri + k); if (st === 'won' || st === 'captured') w++; } row.push(Math.round(100 * w / N) + '%'); }
  console.log('hunter L' + L, 'win vs E..S:', row.join(' '));
}

// zone guardians: win rate by hunter level over many zones (fresh and owned/strong)
for (const [L, lp] of [[3, 0], [10, 400], [20, 1500], [30, 4000]]) {
  const row = []; for (const power of [0, 100]) { let w = 0, N = 80; for (let k = 0; k < N; k++) { const g = R.zoneGuardian(k, 7, Date.now(), power); const sp = R.SPECIES_BY_ID[g.sp]; const ps = R.playerStats(L, [{ power: lp }], {}); const f = R.newFight(ps, { hp: g.hp, atk: g.atk, def: g.def, r: g.r }, 'z' + L + k + power); for (let i = 0; i < 60 && f.status === 'active'; i++) R.fightAct(f, f.ehp / f.emax <= 0.4 ? 'bind' : f.intent === 'heavy' || f.php < f.pmax * 0.35 ? 'guard' : 'power', 0.7); if (f.status === 'won' || f.status === 'captured') w++; } row.push(Math.round(100 * w / N) + '%'); }
  console.log('zone guardian vs hunter L' + L, 'fresh/owned-strong:', row.join(' '));
}

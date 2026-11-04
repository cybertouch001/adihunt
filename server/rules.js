// AdiHunt game rules — pure functions (no I/O). Shared by the server and the unit tests.
export const VERSION_RULES = 1;
// ---------- deterministic hashing / rng ----------
export function h32(s) { s = String(s); let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^ (h >>> 16)) >>> 0; }
export function rng(seed) { let a = h32(seed) || 1; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r1 = (x) => Math.round(x * 10) / 10;
function pickW(r, weights) { const tot = weights.reduce((a, b) => a + b, 0); let x = r * tot; for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; } return weights.length - 1; }

// ---------- geometry ----------
export const CELL = 0.0025, ZONE = 0.005, GATE_CELL = 0.01;
export function distM(a, b) { const R = 6371000, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))); }
export const validPos = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
export const cellOf = (lat, lng, size = CELL) => ({ cx: Math.floor(lng / size), cy: Math.floor(lat / size) });
export const cellsAround = (lat, lng, radiusM, size = CELL) => { const c = cellOf(lat, lng, size); const mLat = size * 111320, mLng = Math.max(1, size * 111320 * Math.cos(lat * Math.PI / 180)); const ry = Math.ceil(radiusM / mLat), rx = Math.ceil(radiusM / mLng); const out = []; for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) out.push({ cx: c.cx + dx, cy: c.cy + dy }); return out; };

// ---------- time ----------
export const DAY = 86400000, WEEK = 7 * DAY;
export const dayKey = (ts, tzMin = 330) => Math.floor((ts + tzMin * 60000) / DAY);
export const weekKey = (ts) => Math.floor(ts / DAY + 3) / 7 | 0;   // weeks start Monday 00:00 UTC
export const dayStr = (k) => new Date(k * DAY).toISOString().slice(0, 10);
export function solarHour(ts, lng) { const h = ((ts / 3600000) % 24 + lng / 15) % 24; return h < 0 ? h + 24 : h; }
// Day/Night cycle from local solar time at the player's position
export function dayPhase(ts, lng) {
  const h = solarHour(ts, lng);
  if (h >= 19 || h < 5) return { phase: 'night', hour: h, night: true };
  if (h >= 17) return { phase: 'dusk', hour: h, night: false };
  if (h < 7) return { phase: 'dawn', hour: h, night: false };
  return { phase: 'day', hour: h, night: false };
}

// ---------- rarity / species ----------
export const RARITIES = [
  { id: 'E', name: 'Common', color: '#9aa0b4' }, { id: 'D', name: 'Uncommon', color: '#6bd0a0' }, { id: 'C', name: 'Rare', color: '#5aa9ff' },
  { id: 'B', name: 'Epic', color: '#b46bff' }, { id: 'A', name: 'Legendary', color: '#ffb347' }, { id: 'S', name: 'Mythic', color: '#ff4d6d' }];
const S = (id, name, r, shape, hp, atk, def, hue, eyes, horns, ab) => ({ id, name, r, shape, base: { hp, atk, def }, hue, eyes, horns, ab });
export const SPECIES = [
  S('gloomwisp', 'Gloomwisp', 0, 'wisp', 30, 7, 2, 275, 2, 0, 'Flicker'), S('murkimp', 'Murk Imp', 0, 'imp', 34, 8, 3, 285, 2, 2, 'Scratch'), S('sootcrawler', 'Soot Crawler', 0, 'spider', 32, 8, 2, 265, 4, 0, 'Skitter'),
  S('ashhound', 'Ashhound', 0, 'hound', 38, 9, 3, 290, 2, 0, 'Snap'), S('dimbat', 'Dimbat', 0, 'bat', 28, 7, 2, 270, 2, 0, 'Screech'),
  S('veilmoth', 'Veilmoth', 1, 'moth', 46, 11, 4, 280, 2, 0, 'Dust Veil'), S('hollowowl', 'Hollow Owl', 1, 'owl', 50, 12, 5, 262, 2, 0, 'Night Gaze'), S('nightcoil', 'Nightcoil', 1, 'serpent', 54, 12, 5, 295, 2, 0, 'Constrict'),
  S('cinderimp', 'Cinder Imp', 1, 'imp', 48, 13, 4, 300, 2, 4, 'Ember Jab'), S('dreadhound', 'Dreadhound', 1, 'hound', 56, 13, 6, 255, 2, 2, 'Rend'),
  S('gravebat', 'Gravebat', 2, 'bat', 66, 16, 7, 268, 2, 2, 'Sonic Wail'), S('thornstag', 'Thorn Stag', 2, 'stag', 78, 16, 8, 288, 2, 6, 'Antler Rush'), S('mistwraith', 'Mist Wraith', 2, 'wraith', 62, 18, 6, 282, 2, 0, 'Chill Touch'),
  S('voidspinner', 'Voidspinner', 2, 'spider', 70, 17, 8, 272, 6, 0, 'Web Snare'), S('ironshade', 'Ironshade', 2, 'golem', 96, 15, 12, 258, 2, 0, 'Slag Slam'),
  S('hollowknight', 'Hollow Knight', 3, 'knight', 110, 22, 13, 278, 2, 2, 'Cleave'), S('duskstalker', 'Duskstalker', 3, 'hound', 98, 25, 10, 292, 3, 4, 'Pounce'), S('umbralwyrm', 'Umbral Wyrm', 3, 'serpent', 118, 23, 12, 266, 2, 2, 'Venom Coil'),
  S('eclipsemoth', 'Eclipse Moth', 3, 'moth', 100, 26, 10, 286, 4, 2, 'Solar Dust'), S('cryptgolem', 'Crypt Golem', 3, 'golem', 150, 20, 18, 260, 2, 0, 'Grave Quake'),
  S('nightmarestag', 'Nightmare Stag', 4, 'stag', 170, 32, 17, 284, 4, 8, 'Dread Charge'), S('revenantlord', 'Revenant Lord', 4, 'wraith', 150, 36, 15, 274, 2, 4, 'Soul Rend'), S('gloomdrake', 'Gloomdrake', 4, 'drake', 185, 34, 18, 296, 2, 4, 'Umbral Breath'), S('voidwarden', 'Voidwarden', 4, 'knight', 200, 30, 24, 264, 2, 6, 'Rift Strike'),
  S('hollowking', 'The Hollow King', 5, 'knight', 300, 46, 30, 270, 2, 8, 'Crown of Ruin'), S('eventidecolossus', 'Eventide Colossus', 5, 'golem', 380, 40, 36, 280, 2, 4, 'Dusk Avalanche'), S('starlessmaw', 'Starless Maw', 5, 'drake', 320, 50, 28, 290, 6, 6, 'Devour Light'), S('eclipseseraph', 'Eclipse Seraph', 5, 'wraith', 280, 52, 26, 300, 4, 6, 'Black Sun')];
export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map(s => [s.id, s]));
export const STAGES = [{ n: 1, mult: 1, tag: '' }, { n: 2, mult: 1.35, tag: 'Elite ' }, { n: 3, mult: 1.8, tag: 'Ascended ' }];
export const MAX_LEVEL_BY_STAGE = [0, 15, 30, 45];
export const speciesName = (sp, stage = 1) => (STAGES[stage - 1] || STAGES[0]).tag + sp.name;
export function statsFor(sp, level, stage = 1, statMult = 1) { const k = (1 + 0.14 * (level - 1)) * (STAGES[stage - 1] || STAGES[0]).mult * statMult; return { hp: Math.round(sp.base.hp * k * 1.6), atk: Math.round(sp.base.atk * k), def: Math.round(sp.base.def * k) }; }
export const powerOf = (st) => Math.round(st.hp / 4 + st.atk * 2 + st.def * 1.5);

// ---------- settings (admin-tunable) ----------
export const DEFAULTS = {
  density: 1, rarityWeights: [60, 24, 10, 4.5, 1.3, 0.2], nightMult: [0.6, 0.9, 1.3, 1.8, 2.6, 4], dayMult: [1.4, 1.1, 0.8, 0.5, 0.3, 0.1], duskMult: [1, 1, 1, 1, 1, 1],
  nightStat: 1.25, dayStat: 0.85, spawnLifeMin: 480, spawnLifeMax: 1080, engageRadius: 40, xpMult: 1, essenceMult: 1, demoRewardPct: 50, softCapKm: 8, maxSpeed: 9,
  gateChance: 0.08, viewRadius: 550, tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', demoAllowed: 1, maxSlots: 6, slotChance: 0.35,
};
export function mergeSettings(rows) { const s = JSON.parse(JSON.stringify(DEFAULTS)); for (const [k, v] of Object.entries(rows || {})) if (k in s && typeof v === typeof s[k] && (!Array.isArray(s[k]) || (Array.isArray(v) && v.length === s[k].length && v.every(Number.isFinite)))) s[k] = v; return s; }

// ---------- spawns ----------
export function rarityWeightsFor(phase, s, ev = {}) {
  const m = phase === 'night' ? s.nightMult : phase === 'day' ? s.dayMult : s.duskMult;
  return s.rarityWeights.map((w, i) => w * m[i] * (ev.rarityMult && ev.rarityMult[i] != null ? ev.rarityMult[i] : 1));
}
export function densityFor(activeUsers, zoneMult = 1, s = DEFAULTS, ev = {}) { // adapts to the area: busier areas get more spawns; admin hot zones add more
  const base = clamp(0.6 + 0.4 * Math.log2(1 + (activeUsers || 0)), 0.6, 2.5);
  return Math.round(clamp(base * zoneMult * s.density * (ev.densityMult || 1), 0, 6) * 4) / 4;
}
export function spawnsForCell(cx, cy, ts, o) {
  const { settings: s, density = 1, customSpecies = [], events = {} } = o; const out = []; const P = 1200 * 1000;
  const pool = SPECIES.concat(customSpecies);
  for (let i = 0; i < s.maxSlots; i++) {
    const phaseOff = h32(`ph|${cx}|${cy}|${i}`) % P; const n = Math.floor((ts - phaseOff) / P); const born = n * P + phaseOff;
    const r = rng(`sp|${cx}|${cy}|${i}|${n}`);
    const chance = clamp(density * s.slotChance * (i < 3 ? 1 : 0.6), 0, 1);
    if (r() >= chance) continue;
    const life = (s.spawnLifeMin + r() * (s.spawnLifeMax - s.spawnLifeMin)) * 1000; const expires = born + life; if (ts >= expires) continue;
    const lat = (cy + 0.05 + r() * 0.9) * CELL, lng = (cx + 0.05 + r() * 0.9) * CELL;
    const ph = events.forceNight ? { phase: 'night', night: true } : dayPhase(born + life / 2, lng);
    const ri = pickW(r(), rarityWeightsFor(ph.phase, s, events));
    const cands = pool.filter(p => p.r === ri); if (!cands.length) continue;
    const sp = cands[Math.floor(r() * cands.length)];
    const statMult = ph.phase === 'night' ? s.nightStat : ph.phase === 'day' ? s.dayStat : 1;
    const level = Math.max(1, 1 + ri * 4 + Math.floor(r() * 5) + (ph.night ? 2 : 0));
    out.push({ id: `${cx}:${cy}:${i}:${n}`, sp: sp.id, r: ri, level, statMult, lat, lng, expires, born, phase: ph.phase });
  }
  return out;
}
export function parseSpawnId(id) { const m = /^(-?\d+):(-?\d+):(\d+):(-?\d+)$/.exec(String(id)); return m ? { cx: +m[1], cy: +m[2], i: +m[3], n: +m[4] } : null; }
export function spawnById(id, ts, o) { const p = parseSpawnId(id); if (!p) return null; return spawnsForCell(p.cx, p.cy, ts, o).find(x => x.id === id) || null; }

// ---------- player progression ----------
export const xpForLevel = (l) => 50 * (l - 1) * l;               // cumulative XP needed to reach level l
export function levelFromXp(xp) { let l = 1; while (xp >= xpForLevel(l + 1) && l < 99) l++; return l; }
export const RANKS = [{ id: 'E', min: 1, title: 'E-Rank Hunter' }, { id: 'D', min: 10, title: 'D-Rank Hunter' }, { id: 'C', min: 20, title: 'C-Rank Hunter' }, { id: 'B', min: 30, title: 'B-Rank Hunter' }, { id: 'A', min: 45, title: 'A-Rank Hunter' }, { id: 'S', min: 60, title: 'S-Rank Hunter' }];
export function rankOf(level) { let r = RANKS[0]; for (const x of RANKS) if (level >= x.min) r = x; return r; }
export const levelUpCost = (l) => Math.round(18 * Math.pow(l, 1.35));
export const evolveCost = (stage) => (stage === 1 ? 400 : 1500);
export const releaseValue = (sh) => Math.round(10 + sh.level * 6 * (1 + sh.r) * (sh.stage || 1));
export function playerStats(level, army = [], relics = {}) {
  const top = army.slice().sort((a, b) => b.power - a.power).slice(0, 5); const legion = top.reduce((a, b) => a + b.power, 0);
  const rb = { atk: 0, hp: 0, def: 0, luck: 0 }; for (const k of Object.keys(relics || {})) { const rl = relics[k]; if (rl) for (const [a, v] of Object.entries(rl.bonus || {})) rb[a] = (rb[a] || 0) + v; }
  return { hp: 80 + level * 9 + rb.hp, atk: Math.round(10 + level * 2.2 + legion / 14 + rb.atk), def: Math.round(3 + level * 0.8 + rb.def), luck: Math.min(0.5, rb.luck / 100), legion };
}

// ---------- anti-cheat ----------
export const TELEPORT_GAP_MS = 30 * 60000;
// returns {ok, reason, dist, speed, relocated}
export function checkMove(prev, next, now, s = DEFAULTS) {
  if (!validPos(next.lat, next.lng)) return { ok: false, reason: 'bad_position' };
  if (!prev) return { ok: true, dist: 0, speed: 0, first: true };
  const dt = (now - prev.ts) / 1000; if (dt < 0.8) return { ok: false, reason: 'too_frequent' };
  const d = distM(prev, next); const speed = d / dt;
  if (dt * 1000 >= TELEPORT_GAP_MS) return { ok: true, dist: d, speed, relocated: d > 1500 };      // long gap: allowed, but arrival cooldown applies
  if (d > 30 + s.maxSpeed * dt) return { ok: false, reason: 'too_fast', dist: d, speed };
  return { ok: true, dist: d, speed, relocated: false };
}
export const COOLDOWN_MS = 5 * 60000;
export const walkedMeters = (chk) => (chk.ok && chk.speed <= 3.5 && chk.dist >= 3 && !chk.relocated ? chk.dist : 0);

// ---------- fights (turn based) ----------
export const FIGHT_TTL = 10 * 60000, MAX_TURNS = 30;
export function newFight(p, e, seed, o = {}) {
  const f = { seed: String(seed), turn: 0, php: p.hp, pmax: p.hp, patk: p.atk, pdef: p.def, luck: p.luck || 0, ehp: e.hp, emax: e.hp, eatk: e.atk, edef: e.def, rarity: e.r || 0, status: 'active', log: [], kind: o.kind || 'wild', guard: 0, bindTries: 0 };
  f.intent = intentFor(f); return f;
}
export function intentFor(f) { const x = rng(`${f.seed}|i|${f.turn}`)(); return x < 0.65 ? 'attack' : x < 0.88 ? 'heavy' : 'charge'; }
export const CATCH_BASE = [0.9, 0.8, 0.65, 0.5, 0.35, 0.2];     // chance to extract after a defeat
export const BIND_MULT = [1.0, 0.95, 0.85, 0.7, 0.55, 0.4];
export function bindChance(f) { const frac = f.ehp / f.emax; if (frac > 0.4) return 0; return clamp((0.35 + (0.4 - frac) * 1.5) * BIND_MULT[f.rarity] * (1 + f.luck), 0.05, 0.92); }
export function fightAct(f, action, tb = 0) {
  if (f.status !== 'active') return f;
  const r = rng(`${f.seed}|a|${f.turn}`); const log = []; tb = clamp(Number(tb) || 0, 0, 1);
  let guard = false;
  if (action === 'flee') { f.status = 'fled'; f.log.push('You retreated.'); return f; }
  if (action === 'strike' || action === 'power') {
    const hitC = action === 'power' ? 0.75 : 0.95; const roll = r(), cr = r(), var1 = r();
    if (roll < hitC) {
      let d = f.patk * (0.9 + var1 * 0.2) * (action === 'power' ? 1.7 : 1) * (1 + 0.25 * tb) - f.edef * 0.5; const crit = cr < 0.1 + f.luck * 0.2; if (crit) d *= 1.8; d = Math.max(1, Math.round(d)); f.ehp = Math.max(0, f.ehp - d); log.push(`${crit ? 'Critical! ' : ''}You deal ${d}.`);
    } else log.push('You missed!');
  } else if (action === 'guard') { guard = true; const h = Math.round(f.pmax * 0.08); f.php = Math.min(f.pmax, f.php + h); log.push(`You brace and recover ${h}.`); }
  else if (action === 'bind') {
    if (f.ehp / f.emax > 0.4) { log.push('Too strong to bind — weaken it below 40% first.'); f.log.push(...log); return f; }   // no turn spent
    f.bindTries++; const c = bindChance(f); if (r() < c) { f.status = 'captured'; f.log.push('The shadow yields to your bind!'); return f; } log.push('The bind slips away!');
  } else { f.log.push('Unknown action.'); return f; }
  if (f.ehp <= 0) { f.status = 'won'; f.log.push(...log, 'The shadow collapses.'); return f; }
  // enemy turn
  const it = f.intent; const er = rng(`${f.seed}|e|${f.turn}`);
  if (it === 'charge') log.push('The shadow gathers darkness…');
  else { let d = f.eatk * (0.85 + er() * 0.3) * (it === 'heavy' ? 1.6 : 1) - f.pdef * 0.5; if (guard) d *= 0.4; d = Math.max(1, Math.round(d)); f.php = Math.max(0, f.php - d); log.push(`It ${it === 'heavy' ? 'smashes' : 'strikes'} you for ${d}.`); }
  f.turn++; f.charged = it === 'charge'; if (f.charged) f.eatk = Math.round(f.eatk * 1.1);
  f.intent = intentFor(f); f.log.push(...log); f.log = f.log.slice(-14);
  if (f.php <= 0) { f.status = 'lost'; f.log.push('You were knocked out.'); } else if (f.turn >= MAX_TURNS) { f.status = 'lost'; f.log.push('The shadow slipped away.'); }
  return f;
}
export function extractRoll(seed, rarity, luck = 0) { return rng(`${seed}|x`)() < clamp(CATCH_BASE[rarity] * (1 + luck), 0.02, 0.95); }

// ---------- rewards ----------
export function rewardFor(level, rarity, kind, mods = {}) {
  const k = { wild: 1, zone: 2, gate: 1.2, boss: 3, guild: 0 }[kind] ?? 1;
  let xp = Math.round((20 + level * 7) * (1 + rarity * 0.6) * k), essence = Math.round((6 + level * 2) * (1 + rarity * 0.5) * k);
  xp = Math.round(xp * (mods.xp || 1)); essence = Math.round(essence * (mods.essence || 1));
  return { xp, essence, shards: rarity >= 2 ? 1 + (rarity >= 4 ? 1 : 0) : (kind === 'wild' ? 0 : 1) };
}

// ---------- gates / dungeons ----------
export const GATE_WINDOW = 6 * 3600000;
export function gatesForCell(gx, gy, ts, o) {
  const { settings: s, events = {} } = o; const w = Math.floor(ts / GATE_WINDOW); const r = rng(`gate|${gx}|${gy}|${w}`);
  if (r() >= clamp(s.gateChance * (events.gateMult || 1), 0, 1)) return [];
  const lat = (gy + 0.1 + r() * 0.8) * GATE_CELL, lng = (gx + 0.1 + r() * 0.8) * GATE_CELL;
  const night = events.forceNight || dayPhase(ts, lng).night; const rk = pickW(r(), night ? [30, 28, 20, 13, 7, 2] : [48, 26, 14, 8, 3.5, 0.5]);
  return [{ id: `g:${gx}:${gy}:${w}`, lat, lng, rank: rk, rankId: RARITIES[rk].id, expires: (w + 1) * GATE_WINDOW }];
}
export function parseGateId(id) { const m = /^g:(-?\d+):(-?\d+):(-?\d+)$/.exec(String(id)); return m ? { gx: +m[1], gy: +m[2], w: +m[3] } : null; }
export function dungeonPlan(gateId, rank, party = 1, customSpecies = []) {
  const r = rng(`dng|${gateId}`); const pool = SPECIES.concat(customSpecies); const lv = 3 + rank * 6; const scale = 1 + 0.6 * (party - 1);
  const mk = (rr, lvl, boss) => { const c = pool.filter(p => p.r === clamp(rr, 0, 5)); const sp = c[Math.floor(r() * c.length)] || SPECIES[0]; const st = statsFor(sp, lvl, 1, boss ? 1.6 : 1); return { sp: sp.id, level: lvl, r: sp.r, hp: Math.round(st.hp * scale), max: Math.round(st.hp * scale), atk: st.atk, def: st.def, boss: !!boss }; };
  const waves = []; for (let w = 0; w < 3; w++) { const n = 1 + (w > 0 ? 1 : 0) + (rank >= 3 && w === 2 ? 1 : 0); const en = []; for (let i = 0; i < n; i++) en.push(mk(Math.max(0, rank - 1 + Math.floor(r() * 2)) , lv + w * 2 + Math.floor(r() * 3), false)); waves.push(en); }
  waves.push([mk(Math.min(5, rank + 1 > 5 ? 5 : rank + (rank < 5 ? 1 : 0)), lv + 8, true)]);
  return { waves, limitMs: (10 + rank) * 60000 };
}
export function newDungeon(gateId, rank, members, now, customSpecies = []) {
  const plan = dungeonPlan(gateId, rank, members.length, customSpecies);
  return { gateId, rank, waves: plan.waves, wave: 0, turn: 0, members: Object.fromEntries(members.map(m => [m.id, { name: m.name, hp: m.hp, max: m.hp, atk: m.atk, def: m.def, luck: m.luck || 0, dmg: 0, down: false }])), deadline: now + plan.limitMs, status: 'active', log: [], startedAt: now };
}
export function dungeonAct(d, uid, action, tb, now) {
  if (d.status !== 'active') return d; const m = d.members[uid]; if (!m) return d; if (now > d.deadline) { d.status = 'failed'; d.log.push('Time ran out — the gate collapses.'); return d; }
  if (m.down) { d.log.push(`${m.name} is down.`); return d; }
  const en = d.waves[d.wave].filter(e => e.hp > 0); const tgt = en[0]; const r = rng(`${d.gateId}|${d.turn}|${uid}`); tb = clamp(Number(tb) || 0, 0, 1); let guard = false;
  if (action === 'strike' || action === 'power') {
    if (r() < (action === 'power' ? 0.75 : 0.95)) { let dm = m.atk * (0.9 + r() * 0.2) * (action === 'power' ? 1.7 : 1) * (1 + 0.25 * tb) - tgt.def * 0.5; const crit = r() < 0.1 + m.luck * 0.2; if (crit) dm *= 1.8; dm = Math.max(1, Math.round(dm)); dm = Math.min(dm, tgt.hp); tgt.hp -= dm; m.dmg += dm; d.log.push(`${m.name} hits ${dm}${crit ? ' (crit)' : ''}.`); } else d.log.push(`${m.name} missed.`);
  } else if (action === 'guard') { guard = true; const h = Math.round(m.max * 0.1); m.hp = Math.min(m.max, m.hp + h); d.log.push(`${m.name} braces (+${h}).`); }
  else { d.log.push('Unknown action.'); return d; }
  if (!d.waves[d.wave].some(e => e.hp > 0)) { d.log.push(d.wave === 3 ? 'The boss falls!' : `Wave ${d.wave + 1} cleared.`); d.wave++; if (d.wave >= d.waves.length) { d.status = 'cleared'; return d; } }
  else { const alive = d.waves[d.wave].filter(e => e.hp > 0); const e0 = alive[Math.floor(r() * alive.length)]; let dm = e0.atk * (0.85 + r() * 0.3) * (e0.boss && r() < 0.3 ? 1.6 : 1) - m.def * 0.5; if (guard) dm *= 0.4; dm = Math.max(1, Math.round(dm)); m.hp = Math.max(0, m.hp - dm); d.log.push(`${SPECIES_BY_ID[e0.sp] ? SPECIES_BY_ID[e0.sp].name : 'Shadow'} hits ${m.name} for ${dm}.`); if (m.hp <= 0) { m.down = true; d.log.push(`${m.name} is down!`); } }
  d.turn++; d.log = d.log.slice(-16);
  if (Object.values(d.members).every(x => x.down)) { d.status = 'failed'; d.log.push('The party was wiped out.'); }
  return d;
}

// ---------- territory ----------
export const ZONE_POWER = 100, ZONE_DECAY_PER_DAY = 12, ZONE_COOLDOWN = 10 * 60000;
export const zoneOf = (lat, lng) => cellOf(lat, lng, ZONE);
export const zoneId = (zx, zy) => `${zx}:${zy}`;
export const territoryPower = (row, now) => (row ? Math.max(0, Math.round((row.power - ZONE_DECAY_PER_DAY * (now - row.claimed_at) / DAY) * 10) / 10) : 0);
export const territoryActive = (row, now) => !!row && row.week === weekKey(now) && territoryPower(row, now) > 0;
export function zoneGuardian(zx, zy, now, power = 0, customSpecies = []) {
  const r = rng(`zg|${zx}|${zy}|${weekKey(now)}`); const pool = SPECIES.concat(customSpecies); const ri = clamp(Math.floor(r() * 3) + (power > 60 ? 1 : 0), 0, 5);
  const c = pool.filter(p => p.r === ri); const sp = c[Math.floor(r() * c.length)] || SPECIES[0]; const level = 5 + Math.floor(r() * 6) + Math.round(power / 15);
  const st = statsFor(sp, level, 1, 1.15); return { sp: sp.id, r: sp.r, level, ...st, hp: Math.round(st.hp * 1.25) };
}
export const zoneColor = (row, userColor) => (row ? (row.guild_color || userColor || '#b46bff') : null);
export const GUILD_COLORS = ['#b46bff', '#ff4d6d', '#5aa9ff', '#6bd0a0', '#ffb347', '#ff7ad9', '#f2e55c', '#4de1d2'];

// ---------- guild boss ----------
export function guildBossPlan(guildId, week, members = 1, customSpecies = []) {
  const r = rng(`gb|${guildId}|${week}`); const pool = SPECIES.concat(customSpecies); const c = pool.filter(p => p.r >= 3); const sp = c[Math.floor(r() * c.length)];
  const hp = Math.round(4000 * (1 + 0.35 * Math.max(0, members - 1))); return { sp: sp.id, hp, max: hp, level: 25 };
}
export const GUILD_ATTACKS_PER_DAY = 5;
export function guildAttackDamage(pl, seed) { const r = rng(seed); return Math.max(5, Math.round((pl.atk * 4 + pl.legion / 6) * (0.85 + r() * 0.3) * (r() < 0.12 ? 1.8 : 1))); }

// ---------- quests / bounty / achievements ----------
export const QUEST_POOL = [
  { type: 'catch', title: 'Extract {n} shadows', min: 2, max: 4, xp: 60, essence: 40 }, { type: 'win', title: 'Win {n} fights', min: 3, max: 6, xp: 70, essence: 40 },
  { type: 'walk', title: 'Walk {n} m', min: 600, max: 2000, step: 100, xp: 80, essence: 50 }, { type: 'rare', title: 'Extract a Rare (C) or better shadow', min: 1, max: 1, xp: 120, essence: 80 },
  { type: 'gate', title: 'Clear a Dungeon Gate', min: 1, max: 1, xp: 150, essence: 100 }, { type: 'zone', title: 'Claim a territory zone', min: 1, max: 1, xp: 130, essence: 90 },
  { type: 'beacon', title: 'Check in at a beacon', min: 1, max: 1, xp: 60, essence: 120 }, { type: 'levelup', title: 'Level up a shadow', min: 1, max: 1, xp: 50, essence: 30 }];
export function questsForDay(dk) {
  const r = rng(`q|${dk}`); const pool = QUEST_POOL.filter(q => q.type !== 'beacon'); const out = [];
  const first = [pool[0], pool[1]][Math.floor(r() * 2)]; const rest = pool.filter(q => q !== first); const pick = [first];
  while (pick.length < 3) { const i = Math.floor(r() * rest.length); pick.push(rest.splice(i, 1)[0]); }
  pick.forEach((q, i) => { const t = q.step ? Math.round((q.min + r() * (q.max - q.min)) / q.step) * q.step : q.min + Math.floor(r() * (q.max - q.min + 1)); out.push({ id: q.type, i, type: q.type, target: t, title: q.title.replace('{n}', t), xp: q.xp, essence: q.essence }); });
  return out;
}
export function bountyForDay(dk, customSpecies = []) { const r = rng(`bounty|${dk}`); const pool = SPECIES.filter(s => s.r <= 3).concat(customSpecies.filter(s => s.r <= 3)); return pool[Math.floor(r() * pool.length)].id; }
export function streakAfter(prevStreak, prevDay, today) { if (prevDay === today) return prevStreak; return prevDay === today - 1 ? prevStreak + 1 : 1; }
export const ACHIEVEMENTS = [
  { key: 'first_catch', name: 'First Extraction', desc: 'Extract your first shadow', test: s => s.caught >= 1 }, { key: 'catch_25', name: 'Gatherer', desc: 'Extract 25 shadows', test: s => s.caught >= 25 },
  { key: 'catch_100', name: 'Legion Builder', desc: 'Extract 100 shadows', test: s => s.caught >= 100 }, { key: 'rare_find', name: 'Rare Find', desc: 'Extract a Rare (C) or better shadow', test: s => s.best_rarity >= 2 },
  { key: 'legend', name: 'Legend Seeker', desc: 'Extract a Legendary (A) shadow', test: s => s.best_rarity >= 4 }, { key: 'mythic', name: 'Mythic Hunter', desc: 'Extract a Mythic (S) shadow', test: s => s.best_rarity >= 5 },
  { key: 'walk_5k', name: 'Pathfinder', desc: 'Walk 5 km in total', test: s => s.walked >= 5000 }, { key: 'walk_50k', name: 'Wanderer', desc: 'Walk 50 km in total', test: s => s.walked >= 50000 },
  { key: 'gate_1', name: 'Gate Crasher', desc: 'Clear a Dungeon Gate', test: s => s.gates >= 1 }, { key: 'gate_10', name: 'Gate Veteran', desc: 'Clear 10 Dungeon Gates', test: s => s.gates >= 10 },
  { key: 'zone_1', name: 'Landowner', desc: 'Claim a territory zone', test: s => s.zones >= 1 }, { key: 'zone_5', name: 'Warlord', desc: 'Claim 5 zones', test: s => s.zones >= 5 },
  { key: 'streak_3', name: 'On a Roll', desc: '3-day quest streak', test: s => s.streak >= 3 }, { key: 'streak_7', name: 'Relentless', desc: '7-day quest streak', test: s => s.streak >= 7 },
  { key: 'rank_d', name: 'Rank D', desc: 'Reach hunter level 10', test: s => s.level >= 10 }, { key: 'rank_b', name: 'Rank B', desc: 'Reach hunter level 30', test: s => s.level >= 30 },
  { key: 'trader', name: 'Fair Trader', desc: 'Complete a trade or gift', test: s => s.trades >= 1 }, { key: 'crafter', name: 'Relic Smith', desc: 'Craft a relic', test: s => s.crafted >= 1 },
  { key: 'guild', name: 'Guild Hunter', desc: 'Join a guild', test: s => s.guild >= 1 }, { key: 'beacon', name: 'Beacon Scout', desc: 'Check in at a beacon', test: s => s.beacons >= 1 },
  { key: 'bounty', name: 'Bounty Hunter', desc: 'Extract the Hunt of the Day', test: s => s.bounties >= 1 }];

// ---------- relics ----------
export const RELIC_SLOTS = ['blade', 'cloak', 'sigil'];
const RELIC_NAMES = { blade: ['Dusk Fang', 'Gloam Edge', 'Umbral Claw', 'Veil Cutter'], cloak: ['Mist Mantle', 'Nightweave', 'Hollow Shroud', 'Ember Veil'], sigil: ['Eclipse Sigil', 'Lantern Rune', 'Star-Eater Seal', 'Dusk Charm'] };
export const CRAFT_COST = { shards: 5, essence: 50 };
export function craftRelic(seed, level) {
  const r = rng(seed); const slot = RELIC_SLOTS[Math.floor(r() * 3)]; const tier = pickW(r(), [55, 28, 12, 5].map((w, i) => w * (i === 0 ? clamp(1.4 - level / 60, 0.5, 1.4) : 1 + level / 80))); const k = 1 + tier * 0.6; const bonus = {};
  if (slot === 'blade') { bonus.atk = Math.round((4 + level * 0.4) * k); bonus.luck = Math.round(2 * tier); } else if (slot === 'cloak') { bonus.hp = Math.round((25 + level * 2) * k); bonus.def = Math.round((2 + level * 0.15) * k); } else { bonus.luck = Math.round((6 + tier * 4)); bonus.atk = Math.round((2 + level * 0.15) * k); }
  const names = RELIC_NAMES[slot]; return { slot, tier, tierName: ['Worn', 'Fine', 'Grand', 'Mythic'][tier], name: `${['Worn', 'Fine', 'Grand', 'Mythic'][tier]} ${names[Math.floor(r() * names.length)]}`, bonus };
}

// ---------- misc ----------
export const normUser = (u) => String(u || '').trim();
export const validUsername = (u) => /^[A-Za-z0-9_]{3,20}$/.test(u);
export const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 100;
export const friendCode = (seed) => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const r = rng(seed); let s = ''; for (let i = 0; i < 8; i++) s += A[Math.floor(r() * A.length)]; return s; };
export const TRADE_RANGE_M = 120, TRADE_TTL = 3600000, TRADES_PER_DAY = 6;
export const SAFE_NOTICE = ['Stay aware of your surroundings — never walk while looking at the screen.', 'Stay off roads, rail lines and water; never enter unsafe or restricted places.', 'Respect private property; only play where you are allowed to be.', 'Take breaks and drink water; play with a friend when you can.'];

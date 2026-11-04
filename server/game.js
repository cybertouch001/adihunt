// AdiHunt — player API (core): auth, profile, position/world, encounters, army, quests, relics, leaderboards, beacons
import * as R from './rules.js';
import { ApiError, bad, str, num, uid, sha256, hashPw, checkPw, audit, rate, init, getCtx, speciesOf, zoneInfo, spawnOpts, bustCtx } from './db.js';

// ---------- auth ----------
export async function authUser(db, req, role) {
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(req.headers.get('authorization') || ''); if (!m) throw new ApiError(401, 'Please log in');
  const s = await db.prepare(`SELECT s.id sid, s.revoked_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(await sha256(m[1])).first();
  if (!s || s.revoked_at) throw new ApiError(401, 'Session expired, please log in again', { logged_out: true });
  if (!s.active) throw new ApiError(403, s.banned_reason ? 'Account suspended: ' + s.banned_reason : 'Account suspended', { logged_out: true });
  if (role && s.role !== role) throw new ApiError(403, role === 'admin' ? 'Admin only' : 'Hunters only');
  const now = Date.now(); if (now - (s.last_seen || 0) > 60000) await db.prepare(`UPDATE sessions SET last_seen=? WHERE id=?`).bind(now, s.sid).run();
  return s;
}
async function newSession(db, u, b, req) {
  const token = uid(32), now = Date.now();
  await db.prepare(`INSERT INTO sessions (id, token_hash, user_id, app, device, created_at, last_seen) VALUES (?,?,?,?,?,?,?)`).bind(uid(8), await sha256(token), u.id, str(b.app, 20) || 'web', str(b.device, 120) || (req.headers.get('user-agent') || '').slice(0, 120), now, now).run();
  return token;
}
export async function loginCommon(db, b, req, wantRole) {
  const name = R.normUser(b.username), pw = String(b.password || ''); if (!name || !pw) bad('Enter username and password');
  const k = 'l:' + name.toLowerCase(), now = Date.now();
  const f = await db.prepare(`SELECT n, first_at FROM login_fail WHERE k=?`).bind(k).first();
  if (f && f.n >= 8 && now - f.first_at < 15 * 60000) throw new ApiError(429, 'Too many wrong attempts. Try again in 15 minutes.');
  const u = await db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).bind(name).first();
  if (!u || u.role !== wantRole || !(await checkPw(pw, u.pw))) {
    if (!f || now - f.first_at >= 15 * 60000) await db.prepare(`INSERT OR REPLACE INTO login_fail (k, n, first_at) VALUES (?, 1, ?)`).bind(k, now).run(); else await db.prepare(`UPDATE login_fail SET n = n + 1 WHERE k=?`).bind(k).run();
    throw new ApiError(401, 'Wrong username or password');
  }
  if (!u.active) throw new ApiError(403, u.banned_reason ? 'Account suspended: ' + u.banned_reason : 'Account suspended');
  await db.prepare(`DELETE FROM login_fail WHERE k=?`).bind(k).run();
  const token = await newSession(db, u, b, req); if (u.role === 'admin') await audit(db, u.id, 'admin_login', {});
  return { token, user: { id: u.id, username: u.username, role: u.role } };
}
export async function signup(db, b, req) {
  const ip = req.headers.get('cf-connecting-ip') || 'x'; await rate(db, 'su:' + ip, 30, 3600000);
  const name = R.normUser(b.username), pw = String(b.password || '');
  if (!R.validUsername(name)) bad('Username must be 3–20 letters, numbers or underscore'); if (!R.validPassword(pw)) bad('Password must be at least 6 characters');
  if (/^(admin|root|system|moderator)$/i.test(name)) bad('That username is reserved');
  if (await db.prepare(`SELECT id FROM users WHERE username=? COLLATE NOCASE`).bind(name).first()) bad('That username is taken', 409);
  const id = uid(), now = Date.now(); const tz = Math.max(-720, Math.min(840, Math.round(num(b.tz, 330))));
  const color = R.GUILD_COLORS.includes(b.color) ? b.color : R.GUILD_COLORS[R.h32(name) % R.GUILD_COLORS.length];
  let code; for (let i = 0; i < 5; i++) { code = R.friendCode(id + i); if (!(await db.prepare(`SELECT 1 FROM users WHERE friend_code=?`).bind(code).first())) break; }
  await db.prepare(`INSERT INTO users (id, username, pw, role, created_at, color, friend_code, tz, last_seen) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, name, await hashPw(pw), 'player', now, color, code, tz, now).run();
  const u = { id }; const token = await newSession(db, u, b, req); await audit(db, id, 'signup', {});
  return { token, user: { id, username: name, role: 'player' } };
}
export async function logout(db, u) { await db.prepare(`UPDATE sessions SET revoked_at=? WHERE id=?`).bind(Date.now(), u.sid).run(); return {}; }
export async function changePassword(db, u, b) { if (!(await checkPw(String(b.old || ''), u.pw))) bad('Current password is wrong', 403); if (!R.validPassword(b.password)) bad('New password must be at least 6 characters'); await db.prepare(`UPDATE users SET pw=? WHERE id=?`).bind(await hashPw(b.password), u.id).run(); await db.prepare(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>?`).bind(Date.now(), u.id, u.sid).run(); return {}; }

// ---------- helpers ----------
export const effSpeed = (u, now) => (u.pos_ts && now - u.pos_ts < 25000 ? (u.speed || 0) : 0);
export const dayOf = (u, now) => R.dayKey(now, u.tz);
export async function armyOf(db, uidv) { const rows = (await db.prepare(`SELECT * FROM shadows WHERE user_id=? ORDER BY level DESC, r DESC`).bind(uidv).all()).results; return rows; }
export function shadowView(ctx, r) {
  const sp = speciesOf(ctx, r.sp) || R.SPECIES[0]; const st = R.statsFor(sp, r.level, r.stage); const max = R.MAX_LEVEL_BY_STAGE[r.stage] || 45;
  return { id: r.id, sp: r.sp, name: R.speciesName(sp, r.stage), nick: r.nick || null, r: r.r, rarity: R.RARITIES[r.r].id, level: r.level, stage: r.stage, maxLevel: max, stats: st, power: R.powerOf(st), fav: !!r.fav, traded: !!r.traded, shape: sp.shape, hue: sp.hue, eyes: sp.eyes, horns: sp.horns, ab: sp.ab, levelCost: r.level < max ? R.levelUpCost(r.level) : null, canEvolve: r.level >= max && r.stage < 3, evolveCost: r.stage < 3 ? R.evolveCost(r.stage) : null, value: R.releaseValue(r) };
}
export async function relicsOf(db, uidv) { return (await db.prepare(`SELECT * FROM relics WHERE user_id=? ORDER BY equipped DESC, tier DESC, at DESC`).bind(uidv).all()).results.map(r => ({ id: r.id, slot: r.slot, name: r.name, tier: r.tier, bonus: JSON.parse(r.bonus || '{}'), equipped: !!r.equipped })); }
export async function pstatsOf(db, ctx, u) {
  const army = (await armyOf(db, u.id)).map(r => ({ power: R.powerOf(R.statsFor(speciesOf(ctx, r.sp) || R.SPECIES[0], r.level, r.stage)) }));
  const rel = {}; for (const r of await relicsOf(db, u.id)) if (r.equipped) rel[r.slot] = r;
  return R.playerStats(u.level, army, rel);
}
export async function applyReward(db, u, rw, now, mods) {
  let { xp = 0, essence = 0, shards = 0 } = rw; const w = R.weekKey(now);
  await db.prepare(`UPDATE users SET xp=xp+?, essence=essence+?, shards=shards+?, weekly_xp=CASE WHEN weekly_week=? THEN weekly_xp+? ELSE ? END, weekly_week=? WHERE id=?`).bind(xp, essence, shards, w, xp, xp, w, u.id).run();
  const row = await db.prepare(`SELECT xp, level FROM users WHERE id=?`).bind(u.id).first(); const nl = R.levelFromXp(row.xp); let levelUp = null;
  if (nl !== row.level) { await db.prepare(`UPDATE users SET level=? WHERE id=?`).bind(nl, u.id).run(); levelUp = { from: row.level, to: nl, rank: R.rankOf(nl).id, newRank: R.rankOf(nl).id !== R.rankOf(row.level).id }; u.level = nl; }
  return levelUp;
}
export async function progress(db, u, type, amount, now, rarity = 0) {
  if (type === 'rare' && rarity < 2) return; const day = dayOf(u, now); const qs = R.questsForDay(day).filter(q => q.type === type); if (!qs.length) return;
  for (const q of qs) await db.prepare(`INSERT INTO quest_progress (user_id, day, qid, progress, claimed) VALUES (?,?,?,?,0) ON CONFLICT(user_id, day, qid) DO UPDATE SET progress = progress + excluded.progress`).bind(u.id, day, q.id, amount).run();
  await touchStreak(db, u, now);
}
export async function touchStreak(db, u, now) {
  const day = dayOf(u, now); const cur = await db.prepare(`SELECT streak, best_streak, streak_day FROM users WHERE id=?`).bind(u.id).first(); if (cur.streak_day === day) return;
  const rows = (await db.prepare(`SELECT qid, progress FROM quest_progress WHERE user_id=? AND day=?`).bind(u.id, day).all()).results; const done = R.questsForDay(day).some(q => (rows.find(r => r.qid === q.id) || { progress: 0 }).progress >= q.target); if (!done) return;
  const ns = R.streakAfter(cur.streak, cur.streak_day, day); await db.prepare(`UPDATE users SET streak=?, best_streak=MAX(best_streak,?), streak_day=? WHERE id=?`).bind(ns, ns, day, u.id).run();
}
export async function checkAch(db, uidv, now) {
  const u = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(uidv).first(); const gcount = u.guild_id ? 1 : 0;
  const st = { caught: u.caught, walked: u.walked, gates: u.gates, zones: u.zones, trades: u.trades, crafted: u.crafted, beacons: u.beacons, bounties: u.bounties, best_rarity: u.best_rarity, streak: Math.max(u.streak, u.best_streak), level: u.level, guild: gcount };
  const have = new Set((await db.prepare(`SELECT key FROM achievements WHERE user_id=?`).bind(uidv).all()).results.map(r => r.key)); const gained = [];
  for (const a of R.ACHIEVEMENTS) if (!have.has(a.key) && a.test(st)) { await db.prepare(`INSERT OR IGNORE INTO achievements (user_id, key, at) VALUES (?,?,?)`).bind(uidv, a.key, now).run(); gained.push({ key: a.key, name: a.name }); }
  return gained;
}
function publicMe(ctx, u, now, extra = {}) {
  const nxt = R.xpForLevel(u.level + 1), cur = R.xpForLevel(u.level); const rk = R.rankOf(u.level);
  return { id: u.id, username: u.username, level: u.level, xp: u.xp, xpCur: cur, xpNext: nxt, rank: rk.id, rankTitle: rk.title, essence: u.essence, shards: u.shards, color: u.color, friendCode: u.friend_code, guildId: u.guild_id || null, streak: (u.streak_day >= dayOf(u, now) - 1 ? u.streak : 0), bestStreak: u.best_streak, caught: u.caught, wins: u.wins, gates: u.gates, zones: u.zones, walked: Math.round(u.walked), todayWalk: Math.round(u.walk_day === dayOf(u, now) ? u.day_walk : 0), bestRarity: u.best_rarity, safeAck: !!u.safe_ack, demo: !!u.demo, ...extra };
}

// ---------- me / config ----------
export async function config(db) { const ctx = await getCtx(db); const s = ctx.settings; return { tileUrl: s.tileUrl, engageRadius: s.engageRadius, viewRadius: s.viewRadius, softCapKm: s.softCapKm, demoAllowed: !!s.demoAllowed, species: R.SPECIES.map(sp => ({ id: sp.id, name: sp.name, r: sp.r, shape: sp.shape, hue: sp.hue, eyes: sp.eyes, horns: sp.horns, ab: sp.ab })).concat(ctx.custom.map(c => ({ id: c.id, name: c.name, r: c.r, shape: c.shape, hue: c.hue, eyes: c.eyes, horns: c.horns, ab: c.ab, custom: true }))), rarities: R.RARITIES, safe: R.SAFE_NOTICE, version: (await import('./config.js')).VERSION }; }
export async function me(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); const day = dayOf(u, now);
  if (b && Number.isFinite(Number(b.tz)) && Math.round(b.tz) !== u.tz) { u.tz = Math.max(-720, Math.min(840, Math.round(b.tz))); await db.prepare(`UPDATE users SET tz=? WHERE id=?`).bind(u.tz, u.id).run(); }
  const prog = (await db.prepare(`SELECT qid, progress, claimed FROM quest_progress WHERE user_id=? AND day=?`).bind(u.id, day).all()).results;
  const quests = R.questsForDay(day).map(q => { const p = prog.find(x => x.qid === q.id) || { progress: 0, claimed: 0 }; return { ...q, progress: Math.min(q.target, p.progress), done: p.progress >= q.target, claimed: !!p.claimed }; });
  const bountySp = R.bountyForDay(day, ctx.custom); const bsp = speciesOf(ctx, bountySp); const bdone = !!(await db.prepare(`SELECT 1 FROM consumed WHERE user_id=? AND k=?`).bind(u.id, 'bounty:' + day).first());
  const ach = (await db.prepare(`SELECT key, at FROM achievements WHERE user_id=?`).bind(u.id).all()).results; const have = Object.fromEntries(ach.map(a => [a.key, a.at]));
  const ann = (await db.prepare(`SELECT id, at, title, body FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 3`).all()).results;
  const ph = ctx.events.forceNight ? { phase: 'night', night: true, hour: 0 } : R.dayPhase(now, u.lng != null ? u.lng : 82.99);
  const strip = []; const rowsAll = (await db.prepare(`SELECT day, qid, progress FROM quest_progress WHERE user_id=? AND day>?`).bind(u.id, day - 14).all()).results;
  for (let d = day - 13; d <= day; d++) { const qs = R.questsForDay(d); strip.push({ day: R.dayStr(d), done: qs.some(q => (rowsAll.find(r => r.day === d && r.qid === q.id) || { progress: 0 }).progress >= q.target) }); }
  const guild = u.guild_id ? await db.prepare(`SELECT id, name, tag, color FROM guilds WHERE id=?`).bind(u.guild_id).first() : null;
  return { me: publicMe(ctx, u, now, { guild }), quests, bounty: { sp: bountySp, name: bsp ? bsp.name : '', done: bdone, shape: bsp && bsp.shape, hue: bsp && bsp.hue }, achievements: R.ACHIEVEMENTS.map(a => ({ key: a.key, name: a.name, desc: a.desc, at: have[a.key] || null })), announcements: ann, phase: ph, events: ctx.events.names, strip, softCapKm: ctx.settings.softCapKm, now };
}
export async function safeAck(db, u) { await db.prepare(`UPDATE users SET safe_ack=1 WHERE id=?`).bind(u.id).run(); return {}; }
export async function setColor(db, u, b) { if (!R.GUILD_COLORS.includes(b.color)) bad('Pick one of the offered colours'); await db.prepare(`UPDATE users SET color=? WHERE id=?`).bind(b.color, u.id).run(); return { color: b.color }; }

// ---------- position + world ----------
export async function pos(db, u, b) {
  await rate(db, 'pos:' + u.id, 100, 60000); const ctx = await getCtx(db); const s = ctx.settings, now = Date.now();
  const lat = num(b.lat), lng = num(b.lng), acc = Math.max(0, num(b.acc, 20)); const demo = b.demo ? 1 : 0;
  if (demo && !s.demoAllowed) bad('Demo mode is switched off');
  const prev = u.pos_ts ? { lat: u.lat, lng: u.lng, ts: u.pos_ts } : null; let chk = R.checkMove(prev, { lat, lng }, now, s);
  if (!chk.ok && chk.reason === 'too_fast' && u.demo && !demo) chk = { ok: true, dist: chk.dist, speed: 0, relocated: true, fromDemo: true };   // leaving demo mode: real GPS may be far from the simulated spot (arrival cooldown applies)
  if (!chk.ok) {
    if (chk.reason === 'too_frequent') return { accepted: false, reason: 'too_frequent', pos: prev ? { lat: u.lat, lng: u.lng } : null };
    if (chk.reason === 'bad_position') bad('Invalid position');
    const strikes = (now - (u.strike_at || 0) > 3600000 ? 0 : u.strikes) + 1; let lock = u.lock_until || 0;
    if (strikes >= 5) { lock = Math.max(lock, now + 15 * 60000); await audit(db, u.id, 'anticheat_lock', { reason: chk.reason, dist: Math.round(chk.dist), speed: Math.round(chk.speed), strikes }); }
    await db.prepare(`UPDATE users SET strikes=?, strike_at=?, lock_until=? WHERE id=?`).bind(strikes, now, lock, u.id).run();
    return { accepted: false, reason: 'too_fast', message: 'That movement was too fast to be walking — position ignored.', lockedUntil: lock > now ? lock : null, pos: { lat: u.lat, lng: u.lng }, strikes };
  }
  const day = dayOf(u, now); const walked = R.walkedMeters(chk); const dayWalk = (u.walk_day === day ? u.day_walk : 0) + walked; let lock = u.lock_until || 0;
  if (chk.relocated) { lock = Math.max(lock, now + (chk.fromDemo ? 3 * R.COOLDOWN_MS : R.COOLDOWN_MS)); }
  let trailM = (u.trail_m || 0) + (chk.dist || 0); const addTrail = !prev || trailM >= 15; if (addTrail) trailM = 0;
  const st = [db.prepare(`UPDATE users SET lat=?, lng=?, acc=?, pos_ts=?, speed=?, demo=?, lock_until=?, walked=walked+?, day_walk=?, walk_day=?, trail_m=?, last_seen=? WHERE id=?`).bind(lat, lng, acc, now, chk.speed || 0, demo, lock, walked, dayWalk, day, trailM, now, u.id)];
  const c = R.cellOf(lat, lng); st.push(db.prepare(`INSERT OR IGNORE INTO cell_act (cx, cy, uid, day) VALUES (?,?,?,?)`).bind(c.cx, c.cy, u.id, R.dayKey(now, 0)));
  if (addTrail) { st.push(db.prepare(`INSERT INTO trail (user_id, ts, lat, lng) VALUES (?,?,?,?)`).bind(u.id, now, lat, lng)); if (Math.random() < 0.05) st.push(db.prepare(`DELETE FROM trail WHERE ts < ?`).bind(now - 3 * 86400000)); }
  await db.batch(st); Object.assign(u, { lat, lng, acc, pos_ts: now, speed: chk.speed || 0, demo, lock_until: lock });
  if (walked > 0) await progress(db, u, 'walk', Math.round(walked), now);
  const ach = walked > 0 ? await checkAch(db, u.id, now) : [];
  const w = await world(db, ctx, u, lat, lng, now);
  return { accepted: true, relocated: !!chk.relocated, lockedUntil: lock > now ? lock : null, speed: Math.round((chk.speed || 0) * 10) / 10, softCap: dayWalk >= s.softCapKm * 1000, dayWalk: Math.round(dayWalk), ach, ...w };
}
export async function worldGet(db, u) { const ctx = await getCtx(db), now = Date.now(); if (!u.pos_ts) return { world: null }; return await world(db, ctx, u, u.lat, u.lng, now); }
export async function world(db, ctx, u, lat, lng, now) {
  const s = ctx.settings, ev = ctx.events; const cells = R.cellsAround(lat, lng, s.viewRadius);
  const xs = cells.map(c => c.cx), ys = cells.map(c => c.cy); const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const act = (await db.prepare(`SELECT cx, cy, COUNT(DISTINCT uid) n FROM cell_act WHERE cx BETWEEN ? AND ? AND cy BETWEEN ? AND ? AND day>=? GROUP BY cx, cy`).bind(minx, maxx, miny, maxy, R.dayKey(now, 0) - 3).all()).results; const am = {}; for (const a of act) am[a.cx + ':' + a.cy] = a.n;
  const consumed = new Set((await db.prepare(`SELECT k FROM consumed WHERE user_id=? AND ts>?`).bind(u.id, now - 3600000).all()).results.map(r => r.k));
  const spawns = [];
  for (const c of cells) { const zi = zoneInfo(ctx, (c.cy + 0.5) * R.CELL, (c.cx + 0.5) * R.CELL); if (zi.mult === 0) continue; const dens = R.densityFor(am[c.cx + ':' + c.cy] || 0, zi.mult, s, ev);
    for (const sp of R.spawnsForCell(c.cx, c.cy, now, spawnOpts(ctx, dens))) { if (consumed.has(sp.id)) continue; const d = R.distM({ lat, lng }, sp); if (d > s.viewRadius) continue; if (zoneInfo(ctx, sp.lat, sp.lng).blocked) continue; const spec = speciesOf(ctx, sp.sp); spawns.push({ id: sp.id, sp: sp.sp, name: spec.name, r: sp.r, rarity: R.RARITIES[sp.r].id, level: sp.level, lat: sp.lat, lng: sp.lng, expires: Math.round(sp.expires), dist: Math.round(d), shape: spec.shape, hue: spec.hue, eyes: spec.eyes, horns: spec.horns, phase: sp.phase }); } }
  spawns.sort((a, b) => a.dist - b.dist);
  const gates = []; for (const c of R.cellsAround(lat, lng, 2500, R.GATE_CELL)) for (const g of R.gatesForCell(c.cx, c.cy, now, { settings: s, events: ev })) { const d = R.distM({ lat, lng }, g); if (d <= 2500 && !consumed.has(g.id) && !zoneInfo(ctx, g.lat, g.lng).blocked) gates.push({ ...g, dist: Math.round(d) }); }
  const zc = R.cellsAround(lat, lng, 700, R.ZONE); const zrows = (await db.prepare(`SELECT * FROM territories WHERE zx BETWEEN ? AND ? AND zy BETWEEN ? AND ?`).bind(Math.min(...zc.map(c => c.cx)), Math.max(...zc.map(c => c.cx)), Math.min(...zc.map(c => c.cy)), Math.max(...zc.map(c => c.cy))).all()).results;
  const zones = zc.map(c => { const row = zrows.find(r => r.zx === c.cx && r.zy === c.cy); const active = R.territoryActive(row, now); return { id: R.zoneId(c.cx, c.cy), b: [c.cy * R.ZONE, c.cx * R.ZONE, (c.cy + 1) * R.ZONE, (c.cx + 1) * R.ZONE], owner: active ? row.owner_name : null, mine: active && row.owner_id === u.id, color: active ? R.zoneColor(row, row.user_color) : null, power: active ? R.territoryPower(row, now) : 0 }; });
  const bcn = (await db.prepare(`SELECT code, name, reward, lat, lng, radius FROM beacons WHERE active=1 AND lat IS NOT NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`).bind(lat - 0.03, lat + 0.03, lng - 0.03, lng + 0.03).all()).results;
  const horns = (await db.prepare(`SELECT d.code, d.rank, d.glat, d.glng, d.gate_id, d.id, uh.username host FROM dungeons d JOIN users uh ON uh.id=d.host WHERE d.status='active' AND d.horn_at>? AND d.host<>? AND (d.host IN (SELECT friend_id FROM friends WHERE user_id=?) OR (uh.guild_id IS NOT NULL AND uh.guild_id=?))`).bind(now - 600000, u.id, u.id, u.guild_id || '-').all()).results;
  const ph = ev.forceNight ? { phase: 'night', night: true } : R.dayPhase(now, lng);
  return { world: { at: { lat, lng }, spawns: spawns.slice(0, 60), gates, zones, beacons: bcn.map(b => ({ ...b, dist: Math.round(R.distM({ lat, lng }, b)) })), horns: horns.map(h => ({ code: h.code, host: h.host, rank: R.RARITIES[h.rank].id, lat: h.glat, lng: h.glng, dist: Math.round(R.distM({ lat, lng }, { lat: h.glat, lng: h.glng })) })), phase: ph.phase, night: ph.night, events: ev.names, now, engageRadius: s.engageRadius } };
}

export async function cellDensity(db, ctx, cx, cy, now) {
  const a = await db.prepare(`SELECT COUNT(DISTINCT uid) n FROM cell_act WHERE cx=? AND cy=? AND day>=?`).bind(cx, cy, R.dayKey(now, 0) - 3).first();
  const zi = zoneInfo(ctx, (cy + 0.5) * R.CELL, (cx + 0.5) * R.CELL); return R.densityFor(a ? a.n : 0, zi.mult, ctx.settings, ctx.events);
}
// ---------- encounters ----------
const fightView = (f, enemy, extra = {}) => { const { seed, ...pub } = f; return { ...pub, enemy, ...extra }; };
export async function encounterStart(db, u, b) {
  const ctx = await getCtx(db), s = ctx.settings, now = Date.now(); await rate(db, 'es:' + u.id, 40, 3600000);
  if ((u.lock_until || 0) > now) bad('Arrival cooldown — you can engage shadows again in ' + Math.ceil((u.lock_until - now) / 60000) + ' min.', 423, { lockedUntil: u.lock_until });
  if (!u.pos_ts || now - u.pos_ts > 180000) bad('Your position is out of date — wait for a GPS fix and try again.', 409);
  if ((u.acc || 0) > 60) bad('GPS accuracy is too low (' + Math.round(u.acc) + ' m). Move to open sky and try again.', 409);
  if (effSpeed(u, now) > 7) bad('You are moving too fast to engage — slow down and stay safe.', 409);
  const open = await db.prepare(`SELECT * FROM fights WHERE user_id=? AND status='active' AND updated_at>?`).bind(u.id, now - R.FIGHT_TTL).first();
  if (open) { const en = JSON.parse(open.enemy); return { fight: fightView(JSON.parse(open.state), en, { id: open.id, kind: open.kind }), resumed: true }; }
  const pid = R.parseSpawnId(b.spawnId); if (!pid) bad('That shadow has vanished.', 404);
  const sp = R.spawnById(b.spawnId, now, spawnOpts(ctx, await cellDensity(db, ctx, pid.cx, pid.cy, now))); if (!sp) bad('That shadow has vanished.', 404);
  const d = R.distM(u, sp); if (d > s.engageRadius) bad(`Too far — get within ${s.engageRadius} m (you are ${Math.round(d)} m away).`, 403, { dist: Math.round(d) });
  if (zoneInfo(ctx, sp.lat, sp.lng).blocked) bad('That shadow has vanished.', 404);
  if (await db.prepare(`SELECT 1 FROM consumed WHERE user_id=? AND k=?`).bind(u.id, sp.id).first()) bad('You already dealt with that shadow.', 409);
  const spec = speciesOf(ctx, sp.sp); const est = R.statsFor(spec, sp.level, 1, sp.statMult); const ps = await pstatsOf(db, ctx, u);
  const f = R.newFight(ps, { hp: est.hp, atk: est.atk, def: est.def, r: sp.r }, uid(8)); const id = uid(8);
  const enemy = { sp: sp.sp, name: spec.name, level: sp.level, r: sp.r, rarity: R.RARITIES[sp.r].id, shape: spec.shape, hue: spec.hue, eyes: spec.eyes, horns: spec.horns, ab: spec.ab, phase: sp.phase };
  await db.prepare(`INSERT INTO fights (id, user_id, kind, ref, state, enemy, status, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, u.id, 'wild', sp.id, JSON.stringify(f), JSON.stringify(enemy), 'active', 0, now, now).run();
  return { fight: fightView(f, enemy, { id, kind: 'wild' }) };
}
export async function encounterAct(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); await rate(db, 'ea:' + u.id, 120, 60000);
  const row = await db.prepare(`SELECT * FROM fights WHERE id=? AND user_id=?`).bind(str(b.id, 40), u.id).first(); if (!row) bad('Fight not found', 404);
  const enemy = JSON.parse(row.enemy); const f = JSON.parse(row.state);
  if (row.status !== 'active') return { fight: fightView(f, enemy, { id: row.id, kind: row.kind }), result: null };
  if (now - row.updated_at > R.FIGHT_TTL) { await db.prepare(`UPDATE fights SET status='expired' WHERE id=?`).bind(row.id).run(); bad('This fight timed out.', 410); }
  const action = str(b.action, 12); if (!['strike', 'power', 'guard', 'bind', 'flee'].includes(action)) bad('Unknown action');
  R.fightAct(f, action, b.tb); const done = f.status !== 'active';
  const upd = await db.prepare(`UPDATE fights SET state=?, version=version+1, updated_at=?, status=? WHERE id=? AND version=? AND status='active'`).bind(JSON.stringify(f), now, done ? f.status : 'active', row.id, row.version).run();
  if (!upd.meta.changes) bad('Please try again', 409);
  let result = null; if (done) result = await finishFight(db, ctx, u, row, f, enemy, now);
  return { fight: fightView(f, enemy, { id: row.id, kind: row.kind }), result };
}
async function finishFight(db, ctx, u, row, f, enemy, now) {
  if (f.status === 'fled' || f.status === 'lost') return { outcome: f.status };
  const kind = row.kind; const day = dayOf(u, now);
  if (kind === 'wild') {
    const dup = await db.prepare(`INSERT OR IGNORE INTO consumed (user_id, k, ts) VALUES (?,?,?)`).bind(u.id, row.ref, now).run(); if (!dup.meta.changes) return { outcome: 'won', duplicate: true };
    const bountySp = R.bountyForDay(day, ctx.custom); let bonus = 1, bounty = false;
    if (enemy.sp === bountySp && (await db.prepare(`INSERT OR IGNORE INTO consumed (user_id, k, ts) VALUES (?,?,?)`).bind(u.id, 'bounty:' + day, now).run()).meta.changes) { bonus = 2; bounty = true; }
    const rw = R.rewardFor(enemy.level, enemy.r, 'wild', rewardMods(ctx, u, bonus)); const ps = await pstatsOf(db, ctx, u);
    const extracted = f.status === 'captured' || R.extractRoll(f.seed, enemy.r, ps.luck); let shadow = null;
    if (extracted) { const id = uid(8); await db.prepare(`INSERT INTO shadows (id, user_id, sp, level, stage, r, source, at) VALUES (?,?,?,?,?,?,?,?)`).bind(id, u.id, enemy.sp, Math.max(1, Math.round(enemy.level * 0.6)), 1, enemy.r, 'wild', now).run(); shadow = shadowView(ctx, { id, sp: enemy.sp, level: Math.max(1, Math.round(enemy.level * 0.6)), stage: 1, r: enemy.r }); }
    const levelUp = await applyReward(db, u, rw, now);
    await db.prepare(`UPDATE users SET wins=wins+1, caught=caught+?, best_rarity=MAX(best_rarity, ?), bounties=bounties+? WHERE id=?`).bind(extracted ? 1 : 0, extracted ? enemy.r : -1, bounty ? 1 : 0, u.id).run();
    await progress(db, u, 'win', 1, now); if (extracted) { await progress(db, u, 'catch', 1, now); await progress(db, u, 'rare', 1, now, enemy.r); }
    return { outcome: extracted ? 'extracted' : 'defeated', ...rw, shadow, levelUp, bounty, ach: await checkAch(db, u.id, now) };
  }
  if (kind === 'zone') return await claimZone(db, ctx, u, row, enemy, f, now);
  return { outcome: f.status };
}
function rewardMods(ctx, u, bonus = 1) { const m = rewardMods0(ctx, u); return { xp: m.xp * bonus, essence: m.essence * bonus }; }
const rewardMods0 = (ctx, u) => { const demo = u.demo ? ctx.settings.demoRewardPct / 100 : 1; return { xp: ctx.settings.xpMult * ctx.events.xpMult * demo, essence: ctx.settings.essenceMult * ctx.events.essenceMult * demo }; };
export { rewardMods };

// ---------- territory claim (guardian fight) ----------
export async function zoneChallenge(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); await rate(db, 'zc:' + u.id, 20, 3600000);
  if ((u.lock_until || 0) > now) bad('Arrival cooldown — try again in ' + Math.ceil((u.lock_until - now) / 60000) + ' min.', 423);
  if (!u.pos_ts || now - u.pos_ts > 180000) bad('Your position is out of date — wait for a GPS fix and try again.', 409);
  if (effSpeed(u, now) > 7) bad('You are moving too fast — slow down and stay safe.', 409);
  if (zoneInfo(ctx, u.lat, u.lng).blocked) bad('This area is a no-play zone.', 403);
  const open = await db.prepare(`SELECT * FROM fights WHERE user_id=? AND status='active' AND updated_at>?`).bind(u.id, now - R.FIGHT_TTL).first();
  if (open) return { fight: fightView(JSON.parse(open.state), JSON.parse(open.enemy), { id: open.id, kind: open.kind }), resumed: true };
  const z = R.zoneOf(u.lat, u.lng), zid = R.zoneId(z.cx, z.cy); const row = await db.prepare(`SELECT * FROM territories WHERE zone=?`).bind(zid).first(); const active = R.territoryActive(row, now);
  if (active && row.owner_id !== u.id && now - row.claimed_at < R.ZONE_COOLDOWN) bad('This zone was just claimed — it is protected for a few minutes.', 409);
  const g = R.zoneGuardian(z.cx, z.cy, now, active ? R.territoryPower(row, now) : 0, ctx.custom); const spec = speciesOf(ctx, g.sp);
  const ps = await pstatsOf(db, ctx, u); const f = R.newFight(ps, { hp: g.hp, atk: g.atk, def: g.def, r: g.r }, uid(8), { kind: 'zone' }); const id = uid(8);
  const enemy = { sp: g.sp, name: spec.name + ' (Guardian)', level: g.level, r: g.r, rarity: R.RARITIES[g.r].id, shape: spec.shape, hue: spec.hue, eyes: spec.eyes, horns: spec.horns, ab: spec.ab, zone: zid, reinforce: active && row.owner_id === u.id };
  await db.prepare(`INSERT INTO fights (id, user_id, kind, ref, state, enemy, status, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, u.id, 'zone', zid, JSON.stringify(f), JSON.stringify(enemy), 'active', 0, now, now).run();
  return { fight: fightView(f, enemy, { id, kind: 'zone' }) };
}
async function claimZone(db, ctx, u, row, enemy, f, now) {
  if (f.status === 'captured') f.status = 'won';
  const zid = row.ref; const [zx, zy] = zid.split(':').map(Number); const ex = await db.prepare(`SELECT * FROM territories WHERE zone=?`).bind(zid).first(); const wasMine = R.territoryActive(ex, now) && ex.owner_id === u.id;
  const guild = u.guild_id ? await db.prepare(`SELECT color FROM guilds WHERE id=?`).bind(u.guild_id).first() : null;
  await db.prepare(`INSERT INTO territories (zone, zx, zy, owner_id, owner_name, guild_id, guild_color, user_color, claimed_at, power, week) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(zone) DO UPDATE SET owner_id=excluded.owner_id, owner_name=excluded.owner_name, guild_id=excluded.guild_id, guild_color=excluded.guild_color, user_color=excluded.user_color, claimed_at=excluded.claimed_at, power=excluded.power, week=excluded.week`).bind(zid, zx, zy, u.id, u.username, u.guild_id || null, guild ? guild.color : null, u.color, now, R.ZONE_POWER, R.weekKey(now)).run();
  const rw = R.rewardFor(enemy.level, enemy.r, 'zone', rewardMods(ctx, u, wasMine ? 0.5 : 1)); const levelUp = await applyReward(db, u, rw, now);
  if (!wasMine) { await db.prepare(`UPDATE users SET zones=zones+1 WHERE id=?`).bind(u.id).run(); await progress(db, u, 'zone', 1, now); }
  return { outcome: wasMine ? 'reinforced' : 'claimed', zone: zid, ...rw, levelUp, ach: await checkAch(db, u.id, now) };
}
export async function territories(db, u) { const now = Date.now(); const rows = (await db.prepare(`SELECT * FROM territories WHERE week=?`).bind(R.weekKey(now)).all()).results.filter(r => R.territoryActive(r, now)); const mine = rows.filter(r => r.owner_id === u.id).map(r => ({ zone: r.zone, power: R.territoryPower(r, now), since: r.claimed_at })); const byOwner = {}; for (const r of rows) byOwner[r.owner_name] = (byOwner[r.owner_name] || 0) + 1; const board = Object.entries(byOwner).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, zones: n })); return { mine, board, total: rows.length, resetsAt: (R.weekKey(now) + 1) * R.WEEK - 3 * R.DAY, decayPerDay: R.ZONE_DECAY_PER_DAY }; }

// ---------- army ----------
export async function army(db, u) { const ctx = await getCtx(db); const rows = await armyOf(db, u.id); const list = rows.map(r => shadowView(ctx, r)).sort((a, b) => b.power - a.power); const ps = await pstatsOf(db, ctx, u); return { army: list, player: ps, legionPower: list.slice(0, 5).reduce((a, b) => a + b.power, 0) }; }
async function ownShadow(db, u, id) { const r = await db.prepare(`SELECT * FROM shadows WHERE id=? AND user_id=?`).bind(str(id, 40), u.id).first(); if (!r) bad('Shadow not found', 404); return r; }
export async function armyLevel(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); const r = await ownShadow(db, u, b.id); const max = R.MAX_LEVEL_BY_STAGE[r.stage]; if (r.level >= max) bad(r.stage < 3 ? 'Evolve this shadow to raise its level cap.' : 'Max level reached.'); const cost = R.levelUpCost(r.level);
  const p = await db.prepare(`UPDATE users SET essence=essence-? WHERE id=? AND essence>=?`).bind(cost, u.id, cost).run(); if (!p.meta.changes) bad(`Not enough essence (need ${cost}).`, 402);
  await db.prepare(`UPDATE shadows SET level=level+1 WHERE id=? AND level=?`).bind(r.id, r.level).run(); await progress(db, u, 'levelup', 1, now);
  const nr = await ownShadow(db, u, r.id); const ess = (await db.prepare(`SELECT essence FROM users WHERE id=?`).bind(u.id).first()).essence; return { shadow: shadowView(ctx, nr), essence: ess };
}
export async function armyEvolve(db, u, b) {
  const ctx = await getCtx(db); const r = await ownShadow(db, u, b.id); if (r.stage >= 3) bad('Already fully evolved.'); if (r.level < R.MAX_LEVEL_BY_STAGE[r.stage]) bad(`Reach level ${R.MAX_LEVEL_BY_STAGE[r.stage]} first.`); const cost = R.evolveCost(r.stage);
  const p = await db.prepare(`UPDATE users SET essence=essence-? WHERE id=? AND essence>=?`).bind(cost, u.id, cost).run(); if (!p.meta.changes) bad(`Not enough essence (need ${cost}).`, 402);
  await db.prepare(`UPDATE shadows SET stage=stage+1 WHERE id=? AND stage=?`).bind(r.id, r.stage).run(); const nr = await ownShadow(db, u, r.id); const ess = (await db.prepare(`SELECT essence FROM users WHERE id=?`).bind(u.id).first()).essence; return { shadow: shadowView(ctx, nr), essence: ess };
}
export async function armyRelease(db, u, b) { const r = await ownShadow(db, u, b.id); if (r.fav) bad('Unfavourite this shadow first.'); const v = R.releaseValue(r); const d = await db.prepare(`DELETE FROM shadows WHERE id=? AND user_id=?`).bind(r.id, u.id).run(); if (!d.meta.changes) bad('Already released'); await db.prepare(`UPDATE users SET essence=essence+? WHERE id=?`).bind(v, u.id).run(); return { essence: (await db.prepare(`SELECT essence FROM users WHERE id=?`).bind(u.id).first()).essence, gained: v }; }
export async function armyFav(db, u, b) { const r = await ownShadow(db, u, b.id); await db.prepare(`UPDATE shadows SET fav=? WHERE id=?`).bind(r.fav ? 0 : 1, r.id).run(); return { fav: !r.fav }; }
export async function armyRename(db, u, b) { const r = await ownShadow(db, u, b.id); const nick = str(b.nick, 20).replace(/[<>]/g, ''); await db.prepare(`UPDATE shadows SET nick=? WHERE id=?`).bind(nick || null, r.id).run(); return { nick: nick || null }; }

// ---------- quests ----------
export async function questClaim(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); const day = dayOf(u, now); const q = R.questsForDay(day).find(x => x.id === str(b.qid, 20)); if (!q) bad('Quest not found', 404);
  const row = await db.prepare(`SELECT progress, claimed FROM quest_progress WHERE user_id=? AND day=? AND qid=?`).bind(u.id, day, q.id).first(); if (!row || row.progress < q.target) bad('Quest not finished yet'); if (row.claimed) bad('Already claimed', 409);
  const up = await db.prepare(`UPDATE quest_progress SET claimed=1 WHERE user_id=? AND day=? AND qid=? AND claimed=0`).bind(u.id, day, q.id).run(); if (!up.meta.changes) bad('Already claimed', 409);
  const m = rewardMods0(ctx, { ...u, demo: 0 }); const rw = { xp: Math.round(q.xp * m.xp), essence: Math.round(q.essence * m.essence), shards: q.type === 'gate' || q.type === 'zone' ? 1 : 0 }; const levelUp = await applyReward(db, u, rw, now); return { ...rw, levelUp, ach: await checkAch(db, u.id, now) };
}

// ---------- relics ----------
export async function inventory(db, u) { return { relics: await relicsOf(db, u.id), shards: u.shards, essence: u.essence, cost: R.CRAFT_COST }; }
export async function relicCraft(db, u) {
  const now = Date.now(); await rate(db, 'cr:' + u.id, 30, 3600000); const c = R.CRAFT_COST;
  const p = await db.prepare(`UPDATE users SET shards=shards-?, essence=essence-?, crafted=crafted+1 WHERE id=? AND shards>=? AND essence>=?`).bind(c.shards, c.essence, u.id, c.shards, c.essence).run(); if (!p.meta.changes) bad(`Crafting needs ${c.shards} relic shards and ${c.essence} essence.`, 402);
  const cnt = (await db.prepare(`SELECT crafted FROM users WHERE id=?`).bind(u.id).first()).crafted; const rl = R.craftRelic(u.id + '|' + cnt, u.level); const id = uid(8);
  await db.prepare(`INSERT INTO relics (id, user_id, slot, name, tier, bonus, equipped, at) VALUES (?,?,?,?,?,?,0,?)`).bind(id, u.id, rl.slot, rl.name, rl.tier, JSON.stringify(rl.bonus), now).run();
  return { relic: { id, ...rl, equipped: false }, ach: await checkAch(db, u.id, now), ...(await inventory(db, { ...u, id: u.id, shards: 0, essence: 0 })) };
}
export async function relicEquip(db, u, b) {
  const r = await db.prepare(`SELECT * FROM relics WHERE id=? AND user_id=?`).bind(str(b.id, 40), u.id).first(); if (!r) bad('Relic not found', 404);
  if (b.off) { await db.prepare(`UPDATE relics SET equipped=0 WHERE id=?`).bind(r.id).run(); return { relics: await relicsOf(db, u.id) }; }
  await db.batch([db.prepare(`UPDATE relics SET equipped=0 WHERE user_id=? AND slot=?`).bind(u.id, r.slot), db.prepare(`UPDATE relics SET equipped=1 WHERE id=?`).bind(r.id)]); return { relics: await relicsOf(db, u.id) };
}

// ---------- beacons ----------
export async function beaconCheckin(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); await rate(db, 'bc:' + u.id, 20, 3600000); const code = str(b.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (!code) bad('Enter a beacon code');
  const bc = await db.prepare(`SELECT * FROM beacons WHERE code=? AND active=1`).bind(code).first(); if (!bc) bad('Unknown or inactive beacon code', 404);
  if (bc.lat != null) { if (!u.pos_ts || now - u.pos_ts > 300000) bad('Turn on location so we can confirm you are at the beacon.', 409); const d = R.distM(u, bc); if (d > bc.radius) bad(`You must be at the beacon (within ${bc.radius} m; you are ${Math.round(d)} m away).`, 403); }
  const day = dayOf(u, now); const ins = await db.prepare(`INSERT OR IGNORE INTO beacon_checkins (user_id, code, day) VALUES (?,?,?)`).bind(u.id, code, day).run(); if (!ins.meta.changes) bad('You already checked in here today.', 409);
  const m = rewardMods0(ctx, { demo: 0 }); const rw = { xp: Math.round(30 * m.xp), essence: Math.round(bc.reward * m.essence), shards: 0 }; const levelUp = await applyReward(db, u, rw, now);
  await db.prepare(`UPDATE users SET beacons=beacons+1 WHERE id=?`).bind(u.id).run(); await progress(db, u, 'beacon', 1, now); return { name: bc.name, ...rw, levelUp, ach: await checkAch(db, u.id, now) };
}

// ---------- ghost trail ----------
export async function trail(db, u, b) { const now = Date.now(); const since = now - 24 * 3600000; const rows = (await db.prepare(`SELECT ts, lat, lng FROM trail WHERE user_id=? AND ts>? ORDER BY ts LIMIT 600`).bind(u.id, since).all()).results; return { points: rows.map(r => [Math.round(r.lat * 1e6) / 1e6, Math.round(r.lng * 1e6) / 1e6, r.ts]) }; }

// ---------- leaderboards ----------
export async function leaderboard(db, u, b) {
  const now = Date.now(); const scope = ['global', 'weekly', 'guilds'].includes(b.scope) ? b.scope : 'global'; const wk = R.weekKey(now);
  if (scope === 'guilds') { const rows = (await db.prepare(`SELECT g.id, g.name, g.tag, g.color, COALESCE(SUM(d.dmg),0) dmg, (SELECT COUNT(*) FROM users m WHERE m.guild_id=g.id) members, (SELECT COUNT(*) FROM territories t WHERE t.guild_id=g.id AND t.week=?) zones FROM guilds g LEFT JOIN guild_dmg d ON d.guild_id=g.id AND d.week=? GROUP BY g.id ORDER BY dmg DESC, members DESC LIMIT 30`).bind(wk, wk).all()).results; return { scope, rows: rows.map((r, i) => ({ rank: i + 1, ...r, mine: r.id === u.guild_id })) }; }
  if (scope === 'weekly') { const rows = (await db.prepare(`SELECT id, username, level, weekly_xp score, color FROM users WHERE role='player' AND active=1 AND weekly_week=? AND weekly_xp>0 ORDER BY weekly_xp DESC, username LIMIT 50`).bind(wk).all()).results; const my = u.weekly_week === wk ? u.weekly_xp : 0; const pos = my > 0 ? 1 + (await db.prepare(`SELECT COUNT(*) n FROM users WHERE role='player' AND active=1 AND weekly_week=? AND weekly_xp>?`).bind(wk, my).first()).n : null; return { scope, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, username: r.username, level: r.level, rankId: R.rankOf(r.level).id, score: r.score, color: r.color, me: r.id === u.id })), me: { score: my, pos } }; }
  const rows = (await db.prepare(`SELECT id, username, level, xp score, caught, color FROM users WHERE role='player' AND active=1 ORDER BY xp DESC, username LIMIT 50`).all()).results; const pos = 1 + (await db.prepare(`SELECT COUNT(*) n FROM users WHERE role='player' AND active=1 AND xp>?`).bind(u.xp).first()).n;
  return { scope, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, username: r.username, level: r.level, rankId: R.rankOf(r.level).id, score: r.score, caught: r.caught, color: r.color, me: r.id === u.id })), me: { score: u.xp, pos } };
}

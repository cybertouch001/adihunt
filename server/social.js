// AdiHunt — social API: guilds + guild boss, friends, trading, dungeon gates (solo / co-op raid)
import * as R from './rules.js';
import { bad, str, uid, audit, rate, getCtx, speciesOf, zoneInfo } from './db.js';
import { applyReward, rewardMods, progress, checkAch, pstatsOf, dayOf, shadowView, effSpeed } from './game.js';

// ---------- guilds ----------
const gview = (g) => ({ id: g.id, name: g.name, tag: g.tag, color: g.color, descr: g.descr || '' });
export async function guildCreate(db, u, b) {
  if (u.guild_id) bad('Leave your current guild first.'); const name = str(b.name, 24).replace(/[<>]/g, ''), tag = str(b.tag, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name.length < 3) bad('Guild name must be at least 3 characters'); if (tag.length < 2) bad('Tag must be 2–4 letters/numbers'); if (u.level < 3) bad('Reach hunter level 3 to found a guild.', 403);
  if (await db.prepare(`SELECT 1 FROM guilds WHERE name=? COLLATE NOCASE`).bind(name).first()) bad('That guild name is taken', 409);
  const id = uid(6), now = Date.now(), color = R.GUILD_COLORS[R.h32(name) % R.GUILD_COLORS.length];
  await db.batch([db.prepare(`INSERT INTO guilds (id, name, tag, leader, color, created_at, descr) VALUES (?,?,?,?,?,?,?)`).bind(id, name, tag, u.id, color, now, str(b.descr, 120)), db.prepare(`UPDATE users SET guild_id=? WHERE id=?`).bind(id, u.id)]);
  await checkAch(db, u.id, now); return { guild: { id, name, tag, color } };
}
export async function guildList(db, u, b) { const q = '%' + str(b.q, 30) + '%'; const rows = (await db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM users m WHERE m.guild_id=g.id) members, (SELECT username FROM users WHERE id=g.leader) leader_name FROM guilds g WHERE g.name LIKE ? ORDER BY members DESC LIMIT 30`).bind(q).all()).results; return { guilds: rows.map(g => ({ ...gview(g), members: g.members, leader: g.leader_name, full: g.members >= 30 })) }; }
export async function guildJoin(db, u, b) {
  if (u.guild_id) bad('Leave your current guild first.'); const g = await db.prepare(`SELECT * FROM guilds WHERE id=?`).bind(str(b.id, 20)).first(); if (!g) bad('Guild not found', 404);
  const n = (await db.prepare(`SELECT COUNT(*) n FROM users WHERE guild_id=?`).bind(g.id).first()).n; if (n >= 30) bad('That guild is full'); await db.prepare(`UPDATE users SET guild_id=? WHERE id=?`).bind(g.id, u.id).run(); await checkAch(db, u.id, Date.now()); return { guild: gview(g) };
}
export async function guildLeave(db, u) {
  if (!u.guild_id) bad('You are not in a guild'); const g = await db.prepare(`SELECT * FROM guilds WHERE id=?`).bind(u.guild_id).first(); await db.prepare(`UPDATE users SET guild_id=NULL WHERE id=?`).bind(u.id).run();
  if (g && g.leader === u.id) { const nl = await db.prepare(`SELECT id FROM users WHERE guild_id=? ORDER BY level DESC, created_at LIMIT 1`).bind(g.id).first(); if (nl) await db.prepare(`UPDATE guilds SET leader=? WHERE id=?`).bind(nl.id, g.id).run(); else await db.batch([db.prepare(`DELETE FROM guilds WHERE id=?`).bind(g.id), db.prepare(`DELETE FROM guild_boss WHERE guild_id=?`).bind(g.id), db.prepare(`DELETE FROM guild_dmg WHERE guild_id=?`).bind(g.id)]); }
  return {};
}
async function ensureBoss(db, ctx, g, now) {
  const wk = R.weekKey(now); let boss = await db.prepare(`SELECT * FROM guild_boss WHERE guild_id=? AND week=?`).bind(g.id, wk).first();
  if (!boss) { const n = (await db.prepare(`SELECT COUNT(*) n FROM users WHERE guild_id=?`).bind(g.id).first()).n; const p = R.guildBossPlan(g.id, wk, n, ctx.custom); await db.prepare(`INSERT OR IGNORE INTO guild_boss (guild_id, week, sp, hp, max, level) VALUES (?,?,?,?,?,?)`).bind(g.id, wk, p.sp, p.hp, p.max, p.level).run(); boss = await db.prepare(`SELECT * FROM guild_boss WHERE guild_id=? AND week=?`).bind(g.id, wk).first(); }
  return boss;
}
export async function guildInfo(db, u) {
  if (!u.guild_id) return { guild: null }; const ctx = await getCtx(db), now = Date.now(), wk = R.weekKey(now); const g = await db.prepare(`SELECT * FROM guilds WHERE id=?`).bind(u.guild_id).first(); const boss = await ensureBoss(db, ctx, g, now);
  const members = (await db.prepare(`SELECT u.id, u.username, u.level, u.color, COALESCE(d.dmg,0) dmg, COALESCE(d.claimed,0) claimed FROM users u LEFT JOIN guild_dmg d ON d.user_id=u.id AND d.guild_id=? AND d.week=? WHERE u.guild_id=? ORDER BY dmg DESC, u.level DESC`).bind(g.id, wk, g.id).all()).results;
  const mine = await db.prepare(`SELECT * FROM guild_dmg WHERE guild_id=? AND week=? AND user_id=?`).bind(g.id, wk, u.id).first(); const day = dayOf(u, now); const used = mine && mine.att_day === day ? mine.att_n : 0; const sp = speciesOf(ctx, boss.sp);
  return { guild: { ...gview(g), leader: g.leader === u.id ? 'you' : (members.find(m => m.id === g.leader) || {}).username, isLeader: g.leader === u.id }, boss: { sp: boss.sp, name: sp.name, shape: sp.shape, hue: sp.hue, eyes: sp.eyes, horns: sp.horns, hp: boss.hp, max: boss.max, level: boss.level, defeated: !!boss.defeated_at }, attacksLeft: R.GUILD_ATTACKS_PER_DAY - used, members: members.map(m => ({ id: m.id, username: m.username, level: m.level, color: m.color, dmg: m.dmg, me: m.id === u.id, claimed: !!m.claimed })), canClaim: !!boss.defeated_at && !!mine && mine.dmg > 0 && !mine.claimed, totalDmg: members.reduce((a, m) => a + m.dmg, 0) };
}
export async function guildBossAttack(db, u) {
  if (!u.guild_id) bad('Join a guild first'); const ctx = await getCtx(db), now = Date.now(), wk = R.weekKey(now); await rate(db, 'gba:' + u.id, 30, 3600000);
  const g = await db.prepare(`SELECT * FROM guilds WHERE id=?`).bind(u.guild_id).first(); const boss = await ensureBoss(db, ctx, g, now); if (boss.hp <= 0) bad('The guild boss is already down this week — claim your reward!', 409);
  const day = dayOf(u, now); await db.prepare(`INSERT OR IGNORE INTO guild_dmg (guild_id, week, user_id) VALUES (?,?,?)`).bind(g.id, wk, u.id).run();
  const claim = await db.prepare(`UPDATE guild_dmg SET att_n = CASE WHEN att_day=? THEN att_n+1 ELSE 1 END, att_day=? WHERE guild_id=? AND week=? AND user_id=? AND (att_day<>? OR att_n<?)`).bind(day, day, g.id, wk, u.id, day, R.GUILD_ATTACKS_PER_DAY).run();
  if (!claim.meta.changes) bad(`No attacks left today (${R.GUILD_ATTACKS_PER_DAY} per day). Come back tomorrow.`, 429);
  const cur = await db.prepare(`SELECT att_n FROM guild_dmg WHERE guild_id=? AND week=? AND user_id=?`).bind(g.id, wk, u.id).first(); const ps = await pstatsOf(db, ctx, u);
  const dmg = R.guildAttackDamage(ps, `${u.id}|${day}|${cur.att_n}`); const d = Math.min(dmg, boss.hp);
  await db.prepare(`UPDATE guild_boss SET hp=MAX(0,hp-?) WHERE guild_id=? AND week=? AND hp>0`).bind(dmg, g.id, wk).run(); await db.prepare(`UPDATE guild_dmg SET dmg=dmg+? WHERE guild_id=? AND week=? AND user_id=?`).bind(d, g.id, wk, u.id).run();
  const nb = await db.prepare(`SELECT hp FROM guild_boss WHERE guild_id=? AND week=?`).bind(g.id, wk).first(); let defeated = false; if (nb.hp <= 0) { const up = await db.prepare(`UPDATE guild_boss SET defeated_at=? WHERE guild_id=? AND week=? AND defeated_at IS NULL`).bind(now, g.id, wk).run(); defeated = !!up.meta.changes; }
  const small = rewardMods(ctx, { ...u, demo: 0 }, 1); await applyReward(db, u, { xp: Math.round(15 * small.xp), essence: Math.round(10 * small.essence) }, now);
  return { damage: d, bossHp: nb.hp, defeated, attacksLeft: R.GUILD_ATTACKS_PER_DAY - cur.att_n };
}
export async function guildBossClaim(db, u) {
  if (!u.guild_id) bad('Join a guild first'); const ctx = await getCtx(db), now = Date.now(), wk = R.weekKey(now); const boss = await db.prepare(`SELECT * FROM guild_boss WHERE guild_id=? AND week=?`).bind(u.guild_id, wk).first(); if (!boss || !boss.defeated_at) bad('The guild boss has not been defeated yet.');
  const mine = await db.prepare(`SELECT * FROM guild_dmg WHERE guild_id=? AND week=? AND user_id=?`).bind(u.guild_id, wk, u.id).first(); if (!mine || mine.dmg <= 0) bad('You did not damage the boss this week.', 403);
  const up = await db.prepare(`UPDATE guild_dmg SET claimed=1 WHERE guild_id=? AND week=? AND user_id=? AND claimed=0`).bind(u.guild_id, wk, u.id).run(); if (!up.meta.changes) bad('Already claimed', 409);
  const m = rewardMods(ctx, { ...u, demo: 0 }, 1); const share = Math.min(1, mine.dmg / (boss.max * 0.25)); const rw = { xp: Math.round((300 + 500 * share) * m.xp), essence: Math.round((200 + 300 * share) * m.essence), shards: 2 + (share > 0.5 ? 1 : 0) }; const levelUp = await applyReward(db, u, rw, now); return { ...rw, levelUp };
}

// ---------- friends + trading ----------
export async function friendAdd(db, u, b) {
  await rate(db, 'fa:' + u.id, 20, 3600000); const code = str(b.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''); const f = await db.prepare(`SELECT id, username, active, role FROM users WHERE friend_code=?`).bind(code).first();
  if (!f || f.role !== 'player' || !f.active) bad('No hunter has that friend code', 404); if (f.id === u.id) bad('That is your own code'); const n = (await db.prepare(`SELECT COUNT(*) n FROM friends WHERE user_id=?`).bind(u.id).first()).n; if (n >= 100) bad('Friend list is full');
  await db.batch([db.prepare(`INSERT OR IGNORE INTO friends (user_id, friend_id, at) VALUES (?,?,?)`).bind(u.id, f.id, Date.now()), db.prepare(`INSERT OR IGNORE INTO friends (user_id, friend_id, at) VALUES (?,?,?)`).bind(f.id, u.id, Date.now())]); return { friend: { id: f.id, username: f.username } };
}
export async function friendRemove(db, u, b) { await db.batch([db.prepare(`DELETE FROM friends WHERE user_id=? AND friend_id=?`).bind(u.id, str(b.id, 40)), db.prepare(`DELETE FROM friends WHERE user_id=? AND friend_id=?`).bind(str(b.id, 40), u.id)]); return {}; }
const fresh = (x, now) => x.pos_ts && now - x.pos_ts < 600000 && x.lat != null;
export async function friendList(db, u) {
  const now = Date.now(); const rows = (await db.prepare(`SELECT x.id, x.username, x.level, x.color, x.lat, x.lng, x.pos_ts, x.guild_id FROM friends f JOIN users x ON x.id=f.friend_id WHERE f.user_id=? AND x.active=1 ORDER BY x.username`).bind(u.id).all()).results;
  return { code: u.friend_code, friends: rows.map(x => { const d = fresh(u, now) && fresh(x, now) ? R.distM(u, x) : null; return { id: x.id, username: x.username, level: x.level, rank: R.rankOf(x.level).id, color: x.color, nearby: d != null && d <= R.TRADE_RANGE_M, dist: d == null ? null : Math.round(d) }; }) };
}
export async function friendArmy(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); const f = await db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).bind(str(b.id, 40)).first(); if (!f || !(await areFriends(db, u.id, f.id))) bad('Friends only', 403);
  if (!fresh(u, now) || !fresh(f, now) || R.distM(u, f) > R.TRADE_RANGE_M) bad('Friend is not nearby', 403);
  const rows = (await db.prepare(`SELECT * FROM shadows WHERE user_id=? AND fav=0 ORDER BY level DESC LIMIT 60`).bind(f.id).all()).results; return { army: rows.map(r => shadowView(ctx, r)) };
}
async function areFriends(db, a, b) { return !!(await db.prepare(`SELECT 1 FROM friends WHERE user_id=? AND friend_id=?`).bind(a, b).first()); }
async function tradeCountToday(db, uidv, now) { return (await db.prepare(`SELECT COUNT(*) n FROM trades WHERE (from_id=? OR to_id=?) AND status='accepted' AND updated_at>?`).bind(uidv, uidv, now - 86400000).first()).n; }
export async function tradeOffer(db, u, b) {
  const now = Date.now(); await rate(db, 'to:' + u.id, 20, 3600000); const to = await db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).bind(str(b.to, 40)).first(); if (!to || !(await areFriends(db, u.id, to.id))) bad('You can only trade with friends', 403);
  if (!fresh(u, now) || !fresh(to, now)) bad('Both hunters need a recent GPS position to trade.', 409); const d = R.distM(u, to); if (d > R.TRADE_RANGE_M) bad(`You must be within ${R.TRADE_RANGE_M} m of each other (now ${Math.round(d)} m).`, 403);
  const give = await db.prepare(`SELECT * FROM shadows WHERE id=? AND user_id=?`).bind(str(b.give, 40), u.id).first(); if (!give) bad('Pick one of your shadows to give', 404); if (give.fav) bad('Unfavourite that shadow before trading it.');
  let want = null; if (b.want) { want = await db.prepare(`SELECT * FROM shadows WHERE id=? AND user_id=?`).bind(str(b.want, 40), to.id).first(); if (!want) bad('That shadow is not in your friend’s legion', 404); }
  if ((await tradeCountToday(db, u.id, now)) >= R.TRADES_PER_DAY) bad('Daily trade limit reached.', 429);
  const pend = (await db.prepare(`SELECT COUNT(*) n FROM trades WHERE from_id=? AND status='pending' AND created_at>?`).bind(u.id, now - R.TRADE_TTL).first()).n; if (pend >= 5) bad('Too many pending offers — wait for replies.');
  const id = uid(6); await db.prepare(`INSERT INTO trades (id, from_id, to_id, give_sid, want_sid, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id, u.id, to.id, give.id, want ? want.id : null, 'pending', now, now).run(); return { id, gift: !want };
}
export async function tradeList(db, u) {
  const ctx = await getCtx(db), now = Date.now(); const rows = (await db.prepare(`SELECT t.*, fu.username fname, tu.username tname FROM trades t JOIN users fu ON fu.id=t.from_id JOIN users tu ON tu.id=t.to_id WHERE (t.from_id=? OR t.to_id=?) ORDER BY t.created_at DESC LIMIT 30`).bind(u.id, u.id).all()).results; const out = [];
  for (const t of rows) { const gs = await db.prepare(`SELECT * FROM shadows WHERE id=?`).bind(t.give_sid).first(); const ws = t.want_sid ? await db.prepare(`SELECT * FROM shadows WHERE id=?`).bind(t.want_sid).first() : null; const status = t.status === 'pending' && now - t.created_at > R.TRADE_TTL ? 'expired' : t.status; out.push({ id: t.id, status, incoming: t.to_id === u.id, from: t.fname, to: t.tname, give: gs ? shadowView(ctx, gs) : null, want: ws ? shadowView(ctx, ws) : null, at: t.created_at }); }
  return { trades: out };
}
export async function tradeRespond(db, u, b) {
  const now = Date.now(); const t = await db.prepare(`SELECT * FROM trades WHERE id=?`).bind(str(b.id, 20)).first(); if (!t) bad('Trade not found', 404);
  if (b.cancel) { if (t.from_id !== u.id) bad('Not your offer', 403); await db.prepare(`UPDATE trades SET status='cancelled', updated_at=? WHERE id=? AND status='pending'`).bind(now, t.id).run(); return { status: 'cancelled' }; }
  if (t.to_id !== u.id) bad('This offer is not for you', 403); if (t.status !== 'pending' || now - t.created_at > R.TRADE_TTL) bad('This offer is no longer open', 410);
  if (!b.accept) { await db.prepare(`UPDATE trades SET status='declined', updated_at=? WHERE id=? AND status='pending'`).bind(now, t.id).run(); return { status: 'declined' }; }
  const from = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(t.from_id).first(); if (!fresh(u, now) || !fresh(from, now) || R.distM(u, from) > R.TRADE_RANGE_M) bad(`You must be within ${R.TRADE_RANGE_M} m of each other to complete the trade.`, 403);
  if ((await tradeCountToday(db, u.id, now)) >= R.TRADES_PER_DAY || (await tradeCountToday(db, from.id, now)) >= R.TRADES_PER_DAY) bad('Daily trade limit reached.', 429);
  const g = await db.prepare(`SELECT * FROM shadows WHERE id=? AND user_id=?`).bind(t.give_sid, t.from_id).first(); const w = t.want_sid ? await db.prepare(`SELECT * FROM shadows WHERE id=? AND user_id=?`).bind(t.want_sid, u.id).first() : null;
  if (!g || (t.want_sid && !w)) { await db.prepare(`UPDATE trades SET status='failed', updated_at=? WHERE id=?`).bind(now, t.id).run(); bad('One of the shadows is no longer available.', 409); }
  const gate = await db.prepare(`UPDATE trades SET status='accepted', updated_at=? WHERE id=? AND status='pending'`).bind(now, t.id).run(); if (!gate.meta.changes) bad('This offer is no longer open', 410);
  const st = [db.prepare(`UPDATE shadows SET user_id=?, traded=1, fav=0 WHERE id=? AND user_id=?`).bind(u.id, g.id, t.from_id)]; if (w) st.push(db.prepare(`UPDATE shadows SET user_id=?, traded=1, fav=0 WHERE id=? AND user_id=?`).bind(t.from_id, w.id, u.id));
  st.push(db.prepare(`UPDATE users SET trades=trades+1 WHERE id IN (?,?)`).bind(u.id, t.from_id)); await db.batch(st); await checkAch(db, u.id, now); await checkAch(db, t.from_id, now); return { status: 'accepted' };
}

// ---------- dungeon gates ----------
const GATE_RADIUS = 60, JOIN_RADIUS = 150, MAX_PARTY = 4;
async function memberStats(db, ctx, uidv) { const x = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(uidv).first(); const ps = await pstatsOf(db, ctx, x); return { id: x.id, name: x.username, hp: ps.hp, atk: ps.atk, def: ps.def, luck: ps.luck }; }
const dview = (row, d, me) => ({ id: row.id, code: row.code, gate: row.gate_id, rank: R.RARITIES[row.rank].id, status: d.status, wave: d.wave, waves: d.waves.length, enemies: (d.waves[Math.min(d.wave, d.waves.length - 1)] || []).map(e => ({ sp: e.sp, name: (R.SPECIES_BY_ID[e.sp] || { name: 'Shadow' }).name, hp: e.hp, max: e.max, level: e.level, boss: e.boss, shape: (R.SPECIES_BY_ID[e.sp] || {}).shape, hue: (R.SPECIES_BY_ID[e.sp] || {}).hue })), members: Object.entries(d.members).map(([id, m]) => ({ id, name: m.name, hp: m.hp, max: m.max, dmg: m.dmg, down: m.down, me: id === me })), deadline: d.deadline, log: d.log, host: row.host === me, started: d.turn > 0, reward: (d.rewards || {})[me] || null, horn: !!(row.horn_at && Date.now() - row.horn_at < 600000), glat: row.glat, glng: row.glng });
async function activeRunOf(db, uidv, now) { return await db.prepare(`SELECT d.* FROM dungeons d JOIN dungeon_members m ON m.run_id=d.id WHERE m.user_id=? AND d.status='active' AND d.updated_at>?`).bind(uidv, now - 30 * 60000).first(); }
export async function gateStart(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); await rate(db, 'gs:' + u.id, 20, 3600000); const gp = R.parseGateId(b.gateId); if (!gp) bad('Gate not found', 404);
  if ((u.lock_until || 0) > now) bad('Arrival cooldown — try again in ' + Math.ceil((u.lock_until - now) / 60000) + ' min.', 423); if (!u.pos_ts || now - u.pos_ts > 180000) bad('Your position is out of date — wait for a GPS fix.', 409); if (effSpeed(u, now) > 7) bad('You are moving too fast — slow down and stay safe.', 409);
  const gate = R.gatesForCell(gp.gx, gp.gy, gp.w * R.GATE_WINDOW + 1, { settings: ctx.settings, events: ctx.events }).find(g => g.id === b.gateId); if (!gate || gate.expires <= now) bad('That gate has closed.', 404);
  const d0 = R.distM(u, gate); if (d0 > GATE_RADIUS) bad(`Walk up to the gate first (within ${GATE_RADIUS} m; you are ${Math.round(d0)} m away).`, 403, { dist: Math.round(d0) });
  if (await db.prepare(`SELECT 1 FROM consumed WHERE user_id=? AND k=?`).bind(u.id, gate.id).first()) bad('You already cleared this gate.', 409);
  const open = await activeRunOf(db, u.id, now); if (open) { const st = JSON.parse(open.state); return { run: dview(open, st, u.id), resumed: true }; }
  const ms = await memberStats(db, ctx, u.id); const state = R.newDungeon(gate.id, gate.rank, [ms], now, ctx.custom); const id = uid(8), code = uid(3).toUpperCase();
  await db.batch([db.prepare(`INSERT INTO dungeons (id, gate_id, host, code, state, status, version, glat, glng, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?,?,?,?)`).bind(id, gate.id, u.id, code, JSON.stringify(state), 'active', gate.lat, gate.lng, gate.rank, now, now), db.prepare(`INSERT INTO dungeon_members (run_id, user_id) VALUES (?,?)`).bind(id, u.id)]);
  return { run: dview({ id, code, gate_id: gate.id, rank: gate.rank, host: u.id, glat: gate.lat, glng: gate.lng }, state, u.id) };
}
export async function gateHorn(db, u, b) { const now = Date.now(); const row = await db.prepare(`SELECT d.* FROM dungeons d WHERE d.id=? AND d.host=? AND d.status='active'`).bind(str(b.id, 20), u.id).first(); if (!row) bad('Only the raid host can blow the horn', 403); const st = JSON.parse(row.state); if (st.turn > 0) bad('The raid has already begun.'); await db.prepare(`UPDATE dungeons SET horn_at=? WHERE id=?`).bind(now, row.id).run(); return { code: row.code }; }
export async function gateJoin(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); await rate(db, 'gj:' + u.id, 30, 3600000); const code = str(b.code, 10).toUpperCase(); const row = await db.prepare(`SELECT * FROM dungeons WHERE code=? AND status='active'`).bind(code).first(); if (!row) bad('No open raid with that code', 404);
  const st = JSON.parse(row.state); if (st.members[u.id]) return { run: dview(row, st, u.id), resumed: true }; if (st.turn > 0) bad('That raid has already begun.', 409); if (Object.keys(st.members).length >= MAX_PARTY) bad('The raid party is full.', 409);
  if (!u.pos_ts || now - u.pos_ts > 180000) bad('Your position is out of date — wait for a GPS fix.', 409); const d = R.distM(u, { lat: row.glat, lng: row.glng }); if (d > JOIN_RADIUS) bad(`Get to the gate first (within ${JOIN_RADIUS} m; you are ${Math.round(d)} m away).`, 403);
  if (await db.prepare(`SELECT 1 FROM consumed WHERE user_id=? AND k=?`).bind(u.id, row.gate_id).first()) bad('You already cleared this gate.', 409); if (await activeRunOf(db, u.id, now)) bad('Finish your current dungeon first.', 409);
  const ms = await memberStats(db, ctx, u.id); const members = [...Object.entries(st.members).map(([id, m]) => ({ id, name: m.name, hp: m.max, atk: m.atk, def: m.def, luck: m.luck })), ms]; const ns = R.newDungeon(row.gate_id, row.rank, members, now, ctx.custom);
  const up = await db.prepare(`UPDATE dungeons SET state=?, version=version+1, updated_at=? WHERE id=? AND version=? AND status='active'`).bind(JSON.stringify(ns), now, row.id, row.version).run(); if (!up.meta.changes) bad('Please try again', 409);
  await db.prepare(`INSERT OR IGNORE INTO dungeon_members (run_id, user_id) VALUES (?,?)`).bind(row.id, u.id).run(); return { run: dview(row, ns, u.id) };
}
export async function dungeonState(db, u, b) {
  const now = Date.now(); const row = await db.prepare(`SELECT d.* FROM dungeons d JOIN dungeon_members m ON m.run_id=d.id WHERE d.id=? AND m.user_id=?`).bind(str(b.id, 20), u.id).first(); if (!row) bad('Raid not found', 404); const st = JSON.parse(row.state);
  if (st.status === 'active' && now > st.deadline) { st.status = 'failed'; st.log.push('Time ran out — the gate collapses.'); await db.prepare(`UPDATE dungeons SET state=?, status='failed', updated_at=? WHERE id=? AND status='active'`).bind(JSON.stringify(st), now, row.id).run(); }
  return { run: dview(row, st, u.id) };
}
export async function dungeonAct(db, u, b) {
  const ctx = await getCtx(db), now = Date.now(); await rate(db, 'da:' + u.id, 150, 60000); const row = await db.prepare(`SELECT d.* FROM dungeons d JOIN dungeon_members m ON m.run_id=d.id WHERE d.id=? AND m.user_id=?`).bind(str(b.id, 20), u.id).first(); if (!row) bad('Raid not found', 404);
  const st = JSON.parse(row.state); const action = str(b.action, 12); if (!['strike', 'power', 'guard'].includes(action)) bad('Unknown action');
  if (row.status !== 'active') return { run: dview(row, st, u.id), result: null };
  const before = st.status; R.dungeonAct(st, u.id, action, b.tb, now);
  const up = await db.prepare(`UPDATE dungeons SET state=?, version=version+1, updated_at=?, status=? WHERE id=? AND version=? AND status='active'`).bind(JSON.stringify(st), now, st.status, row.id, row.version).run(); if (!up.meta.changes) bad('Please try again', 409);
  let result = null; if (st.status === 'cleared') { const all = await finishDungeon(db, ctx, row, st, now, u.id); if (all) { st.rewards = all; await db.prepare(`UPDATE dungeons SET state=? WHERE id=?`).bind(JSON.stringify(st), row.id).run(); result = all[u.id] || null; } }
  return { run: dview({ ...row, status: st.status }, st, u.id), result };
}
async function finishDungeon(db, ctx, row, st, now, actor) {
  const claim = await db.prepare(`UPDATE dungeons SET rewarded=1 WHERE id=? AND rewarded=0`).bind(row.id).run(); if (!claim.meta.changes) return null; const out = {}; const rk = st.rank; const bossE = st.waves[st.waves.length - 1][0];
  for (const mid of Object.keys(st.members)) {
    const u = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(mid).first(); await db.prepare(`INSERT OR IGNORE INTO consumed (user_id, k, ts) VALUES (?,?,?)`).bind(mid, row.gate_id, now).run();
    const rw0 = R.rewardFor(bossE.level, rk, 'gate', rewardMods(ctx, u, 1)); const rw = { ...rw0, xp: Math.round(rw0.xp * 2.5), essence: Math.round(rw0.essence * 2.5), shards: 1 + (rk >= 2 ? 1 : 0) + (rk >= 4 ? 1 : 0) };
    const levelUp = await applyReward(db, u, rw, now); let shadow = null; const chance = Math.min(0.95, 0.55 + rk * 0.07); if (R.rng(`${row.id}|x|${mid}`)() < chance) { const id = uid(8), br = bossE.r; const lvl = Math.max(1, Math.round(bossE.level * 0.6)); await db.prepare(`INSERT INTO shadows (id, user_id, sp, level, stage, r, source, at) VALUES (?,?,?,?,?,?,?,?)`).bind(id, mid, bossE.sp, lvl, 1, br, 'gate', now).run(); await db.prepare(`UPDATE users SET caught=caught+1, best_rarity=MAX(best_rarity,?) WHERE id=?`).bind(br, mid).run(); shadow = shadowView(ctx, { id, sp: bossE.sp, level: lvl, stage: 1, r: br }); }
    await db.prepare(`UPDATE users SET gates=gates+1 WHERE id=?`).bind(mid).run(); await progress(db, u, 'gate', 1, now); const ach = await checkAch(db, mid, now); out[mid] = { ...rw, shadow, levelUp, ach };
  }
  return out;
}
export async function dungeonResult(db, u, b) { // gives a member their result view even if another member finished the raid
  const row = await db.prepare(`SELECT d.* FROM dungeons d JOIN dungeon_members m ON m.run_id=d.id WHERE d.id=? AND m.user_id=?`).bind(str(b.id, 20), u.id).first(); if (!row) bad('Raid not found', 404); return { run: dview(row, JSON.parse(row.state), u.id) };
}

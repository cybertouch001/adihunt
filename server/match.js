// AdiHunt — Live Match API (v1.1): hide & seek / last-survivor rooms, live (real GPS) and virtual (3D arena).
// The server keeps every position; the Seeker only ever receives the 2-minute ping snapshot, radar readouts,
// the hiders' names that are in tag reach, and (virtual arena only) the hiders inside the Seeker's field of view.
import * as R from './rules.js';
import * as MR from './matchrules.js';
const M = MR.M;
import { ApiError, bad, str, num, uid, rate } from './db.js';
import { applyReward } from './game.js';

import { MATCH_SCHEMA } from './db.js';
export { MATCH_SCHEMA };
const ACTIVE = `status IN ('lobby','running')`;

// ---------- loading ----------
async function loadMatch(db, id) { return db.prepare(`SELECT * FROM matches WHERE id=?`).bind(String(id || '')).first(); }
async function playersOf(db, mid) { return (await db.prepare(`SELECT p.*, u.username AS name FROM match_players p JOIN users u ON u.id = p.user_id WHERE p.match_id=? ORDER BY p.joined_at, p.user_id`).bind(mid).all()).results; }
async function playerOf(db, mid, uidv) { return db.prepare(`SELECT p.*, u.username AS name FROM match_players p JOIN users u ON u.id = p.user_id WHERE p.match_id=? AND p.user_id=?`).bind(mid, uidv).first(); }
async function myCurrent(db, uidv, now) {
  return db.prepare(`SELECT m.* FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id=? AND p.state NOT IN ('left') AND (m.${ACTIVE} OR (m.status='ended' AND m.ended_at > ?)) ORDER BY m.created_at DESC LIMIT 1`).bind(uidv, now - 15 * 60000).first();
}
async function myActive(db, uidv) {
  return db.prepare(`SELECT m.* FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id=? AND p.state NOT IN ('left') AND m.${ACTIVE} LIMIT 1`).bind(uidv).first();
}
async function resolveMatch(db, u, b, now) {
  const m = b && b.match ? await loadMatch(db, b.match) : await myCurrent(db, u.id, now);
  if (!m) bad('You are not in a match.', 404);
  const p = await playerOf(db, m.id, u.id); if (!p) bad('You are not in that match.', 403);
  return { m, p };
}
const isVirtual = (m) => m.mode === 'virtual';
const minRadiusFor = (m) => isVirtual(m) ? M.MIN_RADIUS_VIRT_M : M.MIN_RADIUS_LIVE_M;
const arenaHalf = (m) => (m.radius0 || 100) + 40;

// ---------- events and pings ----------
async function event(db, mid, kind, data, now) { await db.prepare(`INSERT INTO match_events (match_id, at, kind, data) VALUES (?,?,?,?)`).bind(mid, now, kind, data ? JSON.stringify(data) : null).run(); }
async function trailPoint(db, mid, p, now) {
  if (p.trail_ts != null && now - p.trail_ts < 3000) return;
  await db.batch([db.prepare(`INSERT INTO match_trail (match_id, user_id, at, x, y) VALUES (?,?,?,?,?)`).bind(mid, p.user_id, now, p.x, p.y),
    db.prepare(`UPDATE match_players SET trail_ts=? WHERE match_id=? AND user_id=?`).bind(now, mid, p.user_id)]);
}
function snapshotPing(m, ps, now, stages) {
  const sec = (now - m.release_at) / 1000; const zone = MR.zoneAt(stages, Math.max(0, sec));
  const hiders = ps.filter(p => p.role === 'hider').map(p => {
    const decoy = p.decoy_until && p.decoy_until >= m.next_ping_at && p.decoy_x != null;   // a decoy stands in for the next ping only
    const fresh = p.pos_ts != null && now - p.pos_ts <= M.POS_FRESH_S * 1000;
    const pt = decoy ? { x: p.decoy_x, y: p.decoy_y } : { x: p.x, y: p.y };
    return { uid: p.user_id, name: p.name, state: p.state, x: (fresh || decoy) && p.state === 'alive' ? round1(pt.x) : null, y: (fresh || decoy) && p.state === 'alive' ? round1(pt.y) : null, seen: fresh ? Math.round((now - p.pos_ts) / 1000) : null };
  });
  return { at: now, zone: { x: round1(zone.x), y: round1(zone.y), r: round1(zone.r) }, alive: hiders.filter(h => h.state === 'alive').length, hiders };
}
const round1 = (v) => v == null ? null : Math.round(v * 10) / 10;

// ---------- eliminations and ends ----------
async function eliminate(db, m, p, state, now, by) {
  const upd = await db.prepare(`UPDATE match_players SET state=?, out_at=?, caught_by=?, outside_since=NULL WHERE match_id=? AND user_id=? AND state='alive'`).bind(state, now, by || null, m.id, p.user_id).run();
  if (!upd.meta.changes) return false;
  if (by) { await db.prepare(`UPDATE match_players SET points=points+? WHERE match_id=? AND user_id=?`).bind(M.PTS.CATCH, m.id, by).run(); }
  await event(db, m.id, 'out', { uid: p.user_id, name: p.name, how: state, by: by || null }, now);
  return true;
}
async function endMatch(db, m, ps, now, winner, reason, winners) {
  const upd = await db.prepare(`UPDATE matches SET status='ended', ended_at=?, result=?, version=version+1 WHERE id=? AND status='running'`).bind(now, JSON.stringify({ winner, reason, winners }), m.id).run();
  if (!upd.meta.changes) return false;
  for (const p of ps) {
    const won = winners.includes(p.user_id);
    const pts = (won ? M.PTS.WIN : 0) + M.PTS.PLAY;
    await db.batch([
      db.prepare(`UPDATE match_players SET points=points+?, x=NULL, y=NULL, heading=NULL, decoy_x=NULL, decoy_y=NULL, pos_ts=NULL, outside_since=NULL WHERE match_id=? AND user_id=?`).bind(won ? M.PTS.WIN : 0, m.id, p.user_id),
      db.prepare(`INSERT INTO match_stats (user_id, plays, wins, catches, points) VALUES (?,1,?,0,?) ON CONFLICT(user_id) DO UPDATE SET plays=plays+1, wins=wins+excluded.wins, points=points+excluded.points`).bind(p.user_id, won ? 1 : 0, pts),
    ]);
    await applyReward(db, { id: p.user_id }, { xp: M.XP.PLAY + (won ? M.XP.WIN : 0) }, now);
  }
  // catches per seeker (points from catches are already on the row; count them into match_stats)
  for (const p of ps) { const c = ps.filter(q => q.caught_by === p.user_id).length; if (c) await db.prepare(`UPDATE match_stats SET catches=catches+? WHERE user_id=?`).bind(c, p.user_id).run(); }
  // live positions only exist during the match: clear them (the replay keeps the trail for a day)
  await event(db, m.id, 'end', { winner, reason, winners: winners.map(w => (ps.find(p => p.user_id === w) || {}).name).filter(Boolean) }, now);
  await db.prepare(`DELETE FROM match_trail WHERE at < ?`).bind(now - 24 * 3600000).run();
  return true;
}

// Advance the match clock: pings, zone exposure, eliminations, end conditions. Idempotent; runs on every read or write.
export async function advance(db, m, now) {
  if (!m || m.status !== 'running') return m;
  const stages = JSON.parse(m.zone || '[]'); if (!stages.length) return m;
  let ps = await playersOf(db, m.id);
  // 1) pings to the Seeker
  let guard = 0;
  while (MR.pingDue(m.next_ping_at, now, m.ends_at) && guard++ < 10) {
    const at = m.next_ping_at, next = at + M.PING_SEC * 1000;
    const upd = await db.prepare(`UPDATE matches SET next_ping_at=?, version=version+1 WHERE id=? AND next_ping_at=?`).bind(next, m.id, at).run();
    m.next_ping_at = next; if (!upd.meta.changes) continue;
    const snap = snapshotPing({ ...m, next_ping_at: at }, ps, at, stages);
    await db.batch([db.prepare(`INSERT INTO match_pings (match_id, at, data) VALUES (?,?,?)`).bind(m.id, at, JSON.stringify(snap)),
      db.prepare(`INSERT INTO match_events (match_id, at, kind, data) VALUES (?,?,?,?)`).bind(m.id, at, 'ping', JSON.stringify({ alive: snap.alive }))]);
    await db.prepare(`UPDATE match_players SET points=points+? WHERE match_id=? AND role='hider' AND state='alive'`).bind(M.PTS.SURVIVE_PING, m.id).run();
    ps = await playersOf(db, m.id);
  }
  // 2) safe zone: a hider outside it with a fresh position gets a grace period, then is out
  const sec = (now - m.release_at) / 1000; const zone = MR.zoneAt(stages, Math.max(0, sec));
  for (const p of ps) {
    if (p.role !== 'hider' || p.state !== 'alive' || p.pos_ts == null || now - p.pos_ts > M.POS_FRESH_S * 1000 || sec < 0) continue;
    const inside = MR.inZone(zone, { x: p.x, y: p.y });
    if (inside) { if (p.outside_since != null) await db.prepare(`UPDATE match_players SET outside_since=NULL WHERE match_id=? AND user_id=?`).bind(m.id, p.user_id).run(); }
    else if (p.outside_since == null) await db.prepare(`UPDATE match_players SET outside_since=? WHERE match_id=? AND user_id=?`).bind(now, m.id, p.user_id).run();
    else if (now - p.outside_since >= M.EXPOSE_GRACE_S * 1000) await eliminate(db, m, p, 'zone', now, null);
  }
  // 3) end conditions
  ps = await playersOf(db, m.id);
  const seeker = ps.find(p => p.role === 'seeker');
  const hiders = ps.filter(p => p.role === 'hider'); const alive = hiders.filter(p => p.state === 'alive');
  if (seeker && seeker.state !== 'alive' && seeker.state !== 'joined') { await endMatch(db, m, ps, now, 'hiders', 'seeker_left', alive.map(p => p.user_id)); return loadMatch(db, m.id); }
  if (hiders.length && alive.length === 0) { await endMatch(db, m, ps, now, 'seeker', 'all_caught', seeker ? [seeker.user_id] : []); return loadMatch(db, m.id); }
  if (hiders.length >= 2 && alive.length === 1) { await endMatch(db, m, ps, now, 'hider', 'last_survivor', [alive[0].user_id]); return loadMatch(db, m.id); }
  if (now >= m.ends_at) { await endMatch(db, m, ps, now, alive.length ? 'hiders' : 'seeker', 'time', alive.length ? alive.map(p => p.user_id) : (seeker ? [seeker.user_id] : [])); return loadMatch(db, m.id); }
  return loadMatch(db, m.id);
}

// ---------- the view of one player ----------
async function friendIds(db, uidv) { return new Set((await db.prepare(`SELECT friend_id FROM friends WHERE user_id=?`).bind(uidv).all()).results.map(r => r.friend_id)); }
async function stateFor(db, m, me0, now) {
  const me = { ...me0, user_id: me0.user_id || me0.id };
  m = await advance(db, m, now);
  const ps = await playersOf(db, m.id); const p = ps.find(x => x.user_id === me.user_id); if (!p) bad('You are not in that match.', 403);
  const stages = JSON.parse(m.zone || '[]'); const sec = m.release_at ? (now - m.release_at) / 1000 : -1;
  const zone = stages.length ? MR.zoneAt(stages, Math.max(0, sec)) : null; const nxt = stages.length && sec >= 0 ? MR.nextStageAt(stages, sec) : null;
  const ended = m.status === 'ended';
  const friends = m.visibility === 'friends' ? await friendIds(db, me.user_id) : new Set();
  const seekerRow = ps.find(x => x.role === 'seeker');
  const virt = isVirtual(m);
  const freshOf = (q) => q.pos_ts != null && now - q.pos_ts <= M.POS_FRESH_S * 1000;
  const seen = (!ended && m.status === 'running' && p.role === 'seeker' && p.state === 'alive' && virt && p.pos_ts != null)
    ? MR.seenBy({ x: p.x, y: p.y }, p.heading, ps.filter(q => q.role === 'hider').map(q => ({ uid: q.user_id, x: q.x, y: q.y, state: q.state }))) : [];
  const nearby = (!ended && m.status === 'running' && p.role === 'seeker' && p.state === 'alive' && !virt && freshOf(p))
    ? ps.filter(q => q.role === 'hider' && q.state === 'alive' && freshOf(q) && MR.dXY(p, q) <= M.TAG_LIVE_M).map(q => ({ uid: q.user_id, name: q.name })) : [];
  const players = ps.map(q => {
    const v = { uid: q.user_id, name: q.name, role: m.status === 'lobby' ? null : q.role, state: q.state, isMe: q.user_id === me.user_id, points: q.points };
    if (ended) return v;
    if (q.user_id === me.user_id) { if (q.x != null) Object.assign(v, { x: round1(q.x), y: round1(q.y), heading: q.heading }); return v; }
    if (q.state !== 'alive' && p.role === 'hider') return v;
    if (p.role === 'seeker') { if (virt && seen.includes(q.user_id)) Object.assign(v, { x: round1(q.x), y: round1(q.y), seen: true }); return v; }
    if (q.role === 'seeker') return v;                                    // hiders never see the Seeker's live position
    const mates = p.role === 'hider' && q.role === 'hider';
    if (mates && (m.visibility === 'teammates' || (m.visibility === 'friends' && friends.has(q.user_id))) && freshOf(q) && q.state === 'alive') Object.assign(v, { x: round1(q.x), y: round1(q.y) });
    if (mates && m.visibility === 'friends' && friends.has(q.user_id) && q.state === 'alive' && freshOf(q)) v.friend = true;
    return v;
  });
  const lastPing = ps.length && p.role === 'seeker' ? await db.prepare(`SELECT at, data FROM match_pings WHERE match_id=? ORDER BY at DESC LIMIT 1`).bind(m.id).first() : null;
  const evs = (await db.prepare(`SELECT at, kind, data FROM match_events WHERE match_id=? AND kind IN ('start','ping','out','end','join','leave') ORDER BY id DESC LIMIT 14`).bind(m.id).all()).results.reverse()
    .map(e => ({ at: e.at, kind: e.kind, data: e.data ? JSON.parse(e.data) : null }));
  const stats = await db.prepare(`SELECT plays, wins, catches, points FROM match_stats WHERE user_id=?`).bind(me.user_id).first();
  const pts = stats ? stats.points : 0;
  return {
    match: {
      id: m.id, code: m.code, mode: m.mode, status: m.status, host: ps.find(x => x.user_id === m.host_id) ? m.host_id : null, isHost: m.host_id === me.user_id,
      origin: m.lat0 != null ? { lat: m.lat0, lng: m.lng0 } : null, radius0: m.radius0, arenaHalf: arenaHalf(m),
      zone: zone ? { x: round1(zone.x), y: round1(zone.y), r: round1(zone.r) } : null, zoneNextAt: nxt != null ? m.release_at + nxt * 1000 : null,
      zoneStage: zone ? stages.indexOf(zone) + 1 : 0, zoneStages: stages.length,
      releaseAt: m.release_at, endsAt: m.ends_at, nextPingAt: m.next_ping_at, pingSec: M.PING_SEC, timeLimit: m.time_limit, headStart: m.head_start, visibility: m.visibility,
      tagRange: MR.tagRange(virt), now, version: m.version, players: ps.length, maxPlayers: M.MAX_PLAYERS, minPlayers: M.MIN_PLAYERS,
      seekerName: seekerRow ? seekerRow.name : null,
    },
    me: {
      uid: me.user_id, role: m.status === 'lobby' ? null : p.role, state: p.state, points: p.points, rankPoints: pts, rank: MR.rankForPoints(pts),
      decoysLeft: p.decoys_left, radarLeft: p.radar_left, decoyActive: !!(p.decoy_until && m.next_ping_at && p.decoy_until >= m.next_ping_at),
      outside: !!(zone && p.role === 'hider' && p.state === 'alive' && freshOf(p) && !MR.inZone(zone, { x: p.x, y: p.y })),
      stats: stats || { plays: 0, wins: 0, catches: 0, points: 0 },
    },
    players, seen, nearby,
    ping: lastPing && p.role === 'seeker' ? { at: lastPing.at, ...JSON.parse(lastPing.data) } : null,
    events: evs, result: m.result ? JSON.parse(m.result) : null,
    arena: virt ? { half: arenaHalf(m), radius: m.radius0 } : null,
  };
}
const viewOrNull = async (db, m, u, now) => m ? stateFor(db, m, u, now) : { match: null };

// ---------- API methods ----------
export async function matchState(db, u, b) {
  const now = Date.now(); const m = b && b.match ? await loadMatch(db, b.match) : await myCurrent(db, u.id, now);
  if (!m) return { match: null };
  if (!(await playerOf(db, m.id, u.id))) return { match: null };
  return stateFor(db, m, u, now);
}
export async function matchCreate(db, u, b) {
  const now = Date.now();
  await rate(db, 'mc:' + u.id, 30, 3600000);
  if (await myActive(db, u.id)) bad('You are already in a match. Leave it first.', 409);
  const mode = b.mode === 'virtual' ? 'virtual' : b.mode === 'live' ? 'live' : null; if (!mode) bad('Pick Live or Virtual.');
  const st = { radius: num(b.radius), headStart: num(b.headStart, 0), timeLimit: num(b.timeLimit), visibility: str(b.visibility, 12) || 'none' };
  const errs = MR.checkSettings(mode, st); if (errs.length) bad('Those match settings are not allowed (' + errs.join(', ') + ').');
  let lat, lng;
  if (mode === 'live') { if (!u.pos_ts || now - u.pos_ts > 10 * 60000) bad('Turn on location first, the match needs your position to start.'); lat = u.lat; lng = u.lng; }
  else { lat = num(b.lat); lng = num(b.lng); if (!R.validPos(lat, lng)) bad('Virtual arena needs the real place (send your location).'); }
  let code = null;
  for (let i = 0; i < 8 && !code; i++) { const c = MR.roomCode(Math.random); if (!(await db.prepare(`SELECT 1 FROM matches WHERE code=? AND ${ACTIVE}`).bind(c).first())) code = c; }
  if (!code) bad('Could not make a room code, try again.', 503);
  const id = uid(12);
  await db.batch([
    db.prepare(`INSERT INTO matches (id, code, host_id, mode, status, lat0, lng0, radius0, head_start, time_limit, visibility, zone, created_at, version) VALUES (?,?,?,?,'lobby',?,?,?,?,?,?,'[]',?,0)`).bind(id, code, u.id, mode, lat, lng, st.radius, st.headStart, st.timeLimit, st.visibility, now),
    db.prepare(`INSERT INTO match_players (match_id, user_id, role, state, joined_at) VALUES (?,?, 'hider', 'joined', ?)`).bind(id, u.id, now),
  ]);
  await event(db, id, 'join', { uid: u.id, name: u.username }, now);
  return viewOrNull(db, await loadMatch(db, id), u, now);
}
export async function matchJoin(db, u, b) {
  const now = Date.now(); await rate(db, 'mj:' + u.id, 30, 3600000);
  const code = str(b.code, 6).toUpperCase(); if (!MR.validCode(code)) bad('Room codes are 6 letters or numbers.');
  const m = await db.prepare(`SELECT * FROM matches WHERE code=? AND status='lobby'`).bind(code).first();
  if (!m) bad('No open lobby with that code. Check the code with the host.', 404);
  const cur = await myActive(db, u.id); if (cur && cur.id !== m.id) bad('You are already in a match. Leave it first.', 409);
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM match_players WHERE match_id=? AND state!='left'`).bind(m.id).first()).n;
  if (n >= M.MAX_PLAYERS) bad('That room is full.', 409);
  const ins = await db.prepare(`INSERT OR IGNORE INTO match_players (match_id, user_id, role, state, joined_at) VALUES (?,?, 'hider', 'joined', ?)`).bind(m.id, u.id, now).run();
  if (ins.meta.changes) await event(db, m.id, 'join', { uid: u.id, name: u.username }, now);
  else await db.prepare(`UPDATE match_players SET state='joined' WHERE match_id=? AND user_id=? AND state='left'`).bind(m.id, u.id).run();
  return viewOrNull(db, m, u, now);
}
export async function matchStart(db, u, b) {
  const now = Date.now(); const m = await loadMatch(db, b.match); if (!m) bad('No such match.', 404);
  if (m.host_id !== u.id) bad('Only the host can start the match.', 403);
  if (m.status !== 'lobby') bad('This match has already started.', 409);
  const ps = (await playersOf(db, m.id)).filter(p => p.state !== 'left');
  if (ps.length < M.MIN_PLAYERS) bad(`Need at least ${M.MIN_PLAYERS} players: one Seeker and two or more hiders.`);
  const pick = R.rng('seeker|' + m.id + '|' + now)(); const seeker = ps[Math.floor(pick * ps.length)];
  const stages = MR.buildZone({ radius0: m.radius0, minRadius: minRadiusFor(m), stageSec: m.mode === 'virtual' ? M.STAGE_SEC_VIRT : M.STAGE_SEC_LIVE, seed: m.id + '|' + now });
  const release = now + m.head_start * 1000, ends = MR.endsAtFor(release, m.time_limit);
  const upd = await db.prepare(`UPDATE matches SET status='running', started_at=?, release_at=?, ends_at=?, next_ping_at=?, zone=?, version=version+1 WHERE id=? AND status='lobby'`).bind(now, release, ends, release, JSON.stringify(stages), m.id).run();
  if (!upd.meta.changes) bad('This match has already started.', 409);
  await db.batch([
    db.prepare(`UPDATE match_players SET role=CASE WHEN user_id=? THEN 'seeker' ELSE 'hider' END, state='alive', outside_since=NULL WHERE match_id=? AND state!='left'`).bind(seeker.user_id, m.id),
  ]);
  await event(db, m.id, 'start', { seeker: seeker.name, players: ps.length, headStart: m.head_start, timeLimit: m.time_limit }, now);
  return viewOrNull(db, await loadMatch(db, m.id), u, now);
}
export async function matchLeave(db, u, b) {
  const now = Date.now(); const { m, p } = await resolveMatch(db, u, b, now);
  if (m.status === 'lobby') {
    if (m.host_id === u.id) { await db.prepare(`UPDATE matches SET status='ended', ended_at=?, result=? WHERE id=? AND status='lobby'`).bind(now, JSON.stringify({ winner: 'none', reason: 'host_left', winners: [] }), m.id).run(); return { match: null }; }
    await db.prepare(`DELETE FROM match_players WHERE match_id=? AND user_id=?`).bind(m.id, u.id).run(); await event(db, m.id, 'leave', { uid: u.id, name: u.username }, now); return { match: null };
  }
  if (m.status === 'running') {
    await db.prepare(`UPDATE match_players SET state='left', out_at=?, outside_since=NULL, x=NULL, y=NULL WHERE match_id=? AND user_id=?`).bind(now, m.id, u.id).run();
    await event(db, m.id, 'leave', { uid: u.id, name: u.username }, now);
    return viewOrNull(db, await loadMatch(db, m.id), u, now);
  }
  return { match: null };
}
export async function matchPos(db, u, b) {
  const now = Date.now(); const { m, p } = await resolveMatch(db, u, b, now);
  if (m.status !== 'running' || p.state !== 'alive') return viewOrNull(db, m, u, now);
  const virt = isVirtual(m);
  await rate(db, 'mp:' + u.id, virt ? 150 : 90, 60000);
  let next;
  if (!virt) {
    const lat = num(b.lat), lng = num(b.lng), acc = num(b.acc, 0);
    if (!R.validPos(lat, lng)) bad('Invalid position');
    if (acc > 80) return { ...(await stateFor(db, m, u, now)), warning: 'GPS is too rough right now, position ignored.' };
    next = MR.xyOf({ lat: m.lat0, lng: m.lng0 }, lat, lng);
  } else {
    const h = arenaHalf(m); next = { x: clampN(num(b.x, 0), -h, h), y: clampN(num(b.y, 0), -h, h) };
  }
  const mv = MR.moveOk(p.pos_ts != null ? { x: p.x, y: p.y, ts: p.pos_ts } : null, next, now, virt);
  if (!mv.ok) return { ...(await stateFor(db, m, u, now)), warning: 'That move was too fast, position ignored.' };
  const heading = virt && num(b.heading) != null ? num(b.heading) : p.heading;
  await db.prepare(`UPDATE match_players SET x=?, y=?, pos_ts=?, heading=? WHERE match_id=? AND user_id=?`).bind(next.x, next.y, now, heading, m.id, u.id).run();
  await trailPoint(db, m.id, { user_id: u.id, x: next.x, y: next.y, trail_ts: p.trail_ts }, now);
  return viewOrNull(db, m, u, now);
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
export async function matchTag(db, u, b) {
  const now = Date.now(); const { m, p } = await resolveMatch(db, u, b, now);
  if (m.status !== 'running') bad('The match is not running.', 409);
  if (now < m.release_at) bad('Hiders still have their head start.', 409);
  if (p.role !== 'seeker') bad('Only the Seeker can tag.', 403);
  const target = await playerOf(db, m.id, String(b.uid || ''));
  if (!target) bad('No such player in this match.', 404);
  const why = MR.canTag(p, target, isVirtual(m), now);
  if (!why.ok) {
    const msg = { no_fresh_position: 'Their position is stale, wait for their next ping.', too_far: `Too far: get within ${MR.tagRange(isVirtual(m))} m.`, not_a_live_hider: 'That player is already out.', seeker_out: 'You are out of the match.' }[why.reason] || 'Cannot tag that player now.';
    bad(msg, 409);
  }
  await eliminate(db, m, target, 'caught', now, u.id);
  return viewOrNull(db, await loadMatch(db, m.id), u, now);
}
export async function matchDecoy(db, u, b) {
  const now = Date.now(); const { m, p } = await resolveMatch(db, u, b, now);
  if (m.status !== 'running' || p.role !== 'hider' || p.state !== 'alive') bad('Decoys are for hiders still in the match.', 409);
  if (p.decoys_left <= 0) bad('No decoys left.', 409);
  if (p.pos_ts == null || now - p.pos_ts > M.POS_FRESH_S * 1000) bad('Send your location first.', 409);
  if (p.decoy_until && p.decoy_until >= (m.next_ping_at || 0)) bad('A decoy is already set for the next ping.', 409);
  const d = MR.decoyPoint(p, isVirtual(m), m.id + '|' + u.id + '|' + m.next_ping_at);
  const r = await db.prepare(`UPDATE match_players SET decoys_left=decoys_left-1, decoy_x=?, decoy_y=?, decoy_until=? WHERE match_id=? AND user_id=? AND decoys_left>0`).bind(d.x, d.y, m.next_ping_at + 5000, m.id, u.id).run();
  if (!r.meta.changes) bad('No decoys left.', 409);
  return viewOrNull(db, m, u, now);
}
export async function matchRadar(db, u, b) {
  const now = Date.now(); const { m, p } = await resolveMatch(db, u, b, now);
  if (m.status !== 'running' || p.role !== 'seeker' || p.state !== 'alive') bad('Radar is for the Seeker.', 409);
  if (p.radar_left <= 0) bad('No radar pings left.', 409);
  if (p.pos_ts == null || now - p.pos_ts > M.POS_FRESH_S * 1000) bad('Send your location first.', 409);
  await db.prepare(`UPDATE match_players SET radar_left=radar_left-1 WHERE match_id=? AND user_id=? AND radar_left>0`).bind(m.id, u.id).run();
  const ps = await playersOf(db, m.id);
  const readout = MR.radarReadout(p, ps.filter(q => q.role === 'hider' && q.pos_ts != null && now - q.pos_ts <= M.POS_FRESH_S * 1000));
  return { ...(await viewOrNull(db, m, u, now)), radar: readout };
}
export async function matchEnd(db, u, b) {
  const now = Date.now(); const m = await loadMatch(db, b.match); if (!m) bad('No such match.', 404);
  if (m.host_id !== u.id) bad('Only the host can end the match.', 403);
  if (m.status === 'lobby') { await db.prepare(`UPDATE matches SET status='ended', ended_at=?, result=? WHERE id=? AND status='lobby'`).bind(now, JSON.stringify({ winner: 'none', reason: 'host_ended', winners: [] }), m.id).run(); return { match: null }; }
  if (m.status === 'running') { await endMatch(db, m, await playersOf(db, m.id), now, 'none', 'host_ended', []); }
  return viewOrNull(db, await loadMatch(db, m.id), u, now);
}
export async function matchReplay(db, u, b) {
  const now = Date.now(); const m = await loadMatch(db, b.match); if (!m) bad('No such match.', 404);
  if (!(await playerOf(db, m.id, u.id))) bad('Only players of that match can see its replay.', 403);
  if (m.status !== 'ended') bad('The replay opens when the match ends.', 409);
  const ps = await playersOf(db, m.id);
  const trail = (await db.prepare(`SELECT user_id, at, x, y FROM match_trail WHERE match_id=? ORDER BY at LIMIT 6000`).bind(m.id).all()).results;
  const pings = (await db.prepare(`SELECT at, data FROM match_pings WHERE match_id=? ORDER BY at LIMIT 200`).bind(m.id).all()).results.map(p => ({ at: p.at, ...JSON.parse(p.data) }));
  const events = (await db.prepare(`SELECT at, kind, data FROM match_events WHERE match_id=? ORDER BY id LIMIT 300`).bind(m.id).all()).results.map(e => ({ at: e.at, kind: e.kind, data: e.data ? JSON.parse(e.data) : null }));
  const byUid = {}; for (const t of trail) (byUid[t.user_id] = byUid[t.user_id] || []).push([round1(t.x), round1(t.y), t.at - m.release_at]);
  return {
    match: { id: m.id, mode: m.mode, origin: m.lat0 != null ? { lat: m.lat0, lng: m.lng0 } : null, radius0: m.radius0, arenaHalf: arenaHalf(m), releaseAt: m.release_at, endsAt: m.ends_at, endedAt: m.ended_at, result: m.result ? JSON.parse(m.result) : null, zoneStages: JSON.parse(m.zone || '[]') },
    players: ps.map(p => ({ uid: p.user_id, name: p.name, role: p.role, state: p.state, points: p.points, caughtBy: p.caught_by, trail: byUid[p.user_id] || [] })),
    pings, events, now,
  };
}
// Short-poll from the client (every 2 s while a match is on screen) is matchState; positions are posted with matchPos.
export const MATCH_METHODS = { match_state: matchState, match_create: matchCreate, match_join: matchJoin, match_start: matchStart, match_leave: matchLeave, match_pos: matchPos, match_tag: matchTag, match_decoy: matchDecoy, match_radar: matchRadar, match_end: matchEnd, match_replay: matchReplay };

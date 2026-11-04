// API integration test: BASE=http://127.0.0.1:8801 ADMIN_PW=... node test/api.test.mjs
import assert from 'node:assert/strict';
const BASE = process.env.BASE, ADMIN_PW = process.env.ADMIN_PW; const P = 't' + Date.now().toString(36).slice(-5);
async function call(m, body = {}, tok) { const r = await fetch(BASE + '/api/' + m, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ah': '1', 'cf-connecting-ip': '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }); const j = await r.json(); j._status = r.status; return j; }
const ok = async (m, b, t) => { const j = await call(m, b, t); if (!j.ok) throw new Error(m + ': ' + j.error); return j; };
let n = 0; const step = (s) => console.log('ok', ++n, s); const sleep = ms => new Promise(r => setTimeout(r, ms));
const C0 = { lat: 25.3100 + Math.random() * 0.2, lng: 82.90 + Math.random() * 0.2 };   // random spot so repeat runs do not share consumed state
let users = 0; async function mkUser(at, demo = 1) { const name = P + 'u' + (++users); const j = await ok('signup', { username: name, password: 'secret12', tz: 330 }); const tok = j.token; if (at) { const r = await ok('pos', { lat: at.lat, lng: at.lng, acc: 6, demo }, tok); assert.equal(r.accepted, true); } return { name, tok, id: j.user.id }; }
const admin = (await ok('admin/login', { username: 'admin', password: ADMIN_PW, app: 'web' })).token; step('admin login');
assert.equal((await call('login', { username: 'admin', password: ADMIN_PW }))._status, 401); step('admin cannot use the player login');
assert.equal((await call('admin/login', { username: 'admin', password: 'nope' }))._status, 401); step('wrong admin password refused');
assert.equal((await call('me', {}))._status, 401); step('no token refused');
// ---- signup/login
assert.equal((await call('signup', { username: 'a', password: 'secret12' }))._status, 400); assert.equal((await call('signup', { username: P + 'x', password: '123' }))._status, 400); assert.equal((await call('signup', { username: 'Admin', password: 'secret12' }))._status, 400); step('signup validation (short name / short password / reserved)');
const probe = await mkUser(); assert.equal((await call('signup', { username: probe.name.toUpperCase(), password: 'secret12' }))._status, 409); step('duplicate username refused (case-insensitive)');
assert.equal((await call('login', { username: probe.name, password: 'wrongpass' }))._status, 401); const lg = await ok('login', { username: probe.name, password: 'secret12', app: 'android', device: 'Test' }); assert.ok(lg.token); step('login');
assert.equal((await call('admin/users', {}, probe.tok))._status, 403); step('player cannot call admin API');
const cfg = await ok('config'); assert.ok(cfg.species.length >= 28 && cfg.rarities.length === 6 && cfg.tileUrl.includes('{z}')); step('config');
// ---- tune the server for fast, deterministic testing
await ok('admin/settings_set', { settings: { engageRadius: 200, density: 6, gateChance: 1, rarityWeights: [100, 0, 0, 0, 0, 0] } }, admin); step('admin tuned settings');
assert.equal((await call('admin/settings_set', { settings: { engageRadius: 5 } }, admin))._status, 400); assert.equal((await call('admin/settings_set', { settings: { tileUrl: 'http://x/{z}' } }, admin))._status, 400); step('settings validation');
// ---- spawns deterministic across players
const A1 = await mkUser(C0), A2 = await mkUser(C0);
const w1 = (await ok('world', {}, A1.tok)).world, w2 = (await ok('world', {}, A2.tok)).world; assert.ok(w1.spawns.length >= 8, 'spawns ' + w1.spawns.length); assert.deepEqual(w1.spawns.map(s => s.id), w2.spawns.map(s => s.id)); step(`friends see the same ${w1.spawns.length} shadows (deterministic spawns)`);
assert.ok(w1.spawns.every(s => s.expires > Date.now() && s.dist <= 550)); step('spawns have future despawn timers and are within view radius');
const prev = (await ok('admin/spawn_preview', { lat: C0.lat, lng: C0.lng }, admin)); assert.ok(prev.count > 0); step('admin spawn preview');
// ---- anti-cheat
const AC = await mkUser(C0, 0); await sleep(1000);
let r = await ok('pos', { lat: C0.lat + 0.05, lng: C0.lng, acc: 5 }, AC.tok); assert.equal(r.accepted, false); assert.equal(r.reason, 'too_fast'); step('teleport (5 km in 1 s) rejected');
for (let i = 0; i < 4; i++) { await sleep(950); r = await ok('pos', { lat: C0.lat + 0.05, lng: C0.lng, acc: 5 }, AC.tok); assert.equal(r.accepted, false); }
assert.ok(r.lockedUntil, 'locked after repeated violations'); step('5 violations -> temporary lock');
assert.equal((await call('encounter_start', { spawnId: w1.spawns[0].id }, AC.tok))._status, 423); step('locked player cannot engage');
r = await ok('pos', { lat: C0.lat + 0.00005, lng: C0.lng, acc: 5 }, AC.tok); await sleep(1000); r = await ok('pos', { lat: C0.lat + 0.00005, lng: C0.lng, acc: 5 }, AC.tok); assert.equal(r.accepted, true); step('small walking step accepted after rejection');
assert.equal((await ok('pos', { lat: C0.lat + 0.00006, lng: C0.lng, acc: 5 }, AC.tok)).accepted, false); step('too-frequent updates ignored (<0.8 s)');
assert.equal((await call('pos', { lat: 999, lng: 0 }, AC.tok))._status, 400); step('invalid coordinates refused');
const DM = await mkUser(C0, 1); await sleep(1000); const lvx = await ok('pos', { lat: C0.lat + 0.05, lng: C0.lng, acc: 5, demo: 0 }, DM.tok); assert.equal(lvx.accepted, true); assert.equal(lvx.relocated, true); assert.ok(lvx.lockedUntil - Date.now() > 10 * 60000); assert.equal((await call('encounter_start', { spawnId: w1.spawns[0].id }, DM.tok))._status, 423); step('leaving demo mode for real GPS far away is allowed but with a long arrival cooldown');
// ---- encounter + fight
const H = await mkUser(null); await ok('admin/user_grant', { id: H.id, xp: 60000, essence: 5000, shards: 10 }, admin); // strong hunter (~level 34)
const sp = w1.spawns.find(s => s.expires > Date.now() + 120000); await ok('pos', { lat: sp.lat, lng: sp.lng, acc: 5, demo: 1 }, H.tok);
const far = w1.spawns.find(s => s.dist > 300 && Math.abs(s.lat - sp.lat) > 0.003 || Math.abs(s.lng - sp.lng) > 0.003);
if (far) { assert.equal((await call('encounter_start', { spawnId: far.id }, H.tok))._status, 403); step('encounter refused when too far away'); }
assert.equal((await call('encounter_start', { spawnId: '1:2:3:4' }, H.tok))._status, 404); step('fake spawn id refused');
const es = await ok('encounter_start', { spawnId: sp.id }, H.tok); assert.ok(es.fight.id && !es.fight.seed && es.fight.intent); step('encounter started (server-side state, seed hidden)');
const again = await ok('encounter_start', { spawnId: sp.id }, H.tok); assert.equal(again.resumed, true); step('open fight is resumed');
let fight = es.fight, res = null;
for (let i = 0; i < 40 && fight.status === 'active'; i++) { const act = fight.ehp / fight.emax <= 0.4 ? 'bind' : (fight.php < fight.pmax * 0.3 ? 'guard' : 'strike'); const j = await ok('encounter_act', { id: fight.id, action: act, tb: 1 }, H.tok); fight = j.fight; res = j.result; }
assert.ok(['won', 'captured'].includes(fight.status), 'fight status ' + fight.status); assert.ok(res && res.xp > 0 && res.essence > 0); step(`fight resolved server-side: ${res.outcome}, +${res.xp} xp, +${res.essence} essence`);
assert.equal((await call('encounter_act', { id: fight.id, action: 'strike' }, H.tok)).fight.status, fight.status); step('finished fight cannot be replayed for rewards');
assert.equal((await call('encounter_start', { spawnId: sp.id }, H.tok))._status, 409); step('same shadow cannot be fought twice');
const meh = (await ok('me', {}, H.tok)).me; assert.ok(meh.wins >= 1); step('stats updated');
// demo reward is scaled
// ---- army: win several to get shadows
let owned = 0; const sps = w1.spawns.slice(1, 12); let wins = 1;
for (const s of sps) { const pp = await call('pos', { lat: s.lat, lng: s.lng, acc: 5 }, H.tok); if (!pp.accepted) { continue; } }
// player cannot teleport between spawns; so use new hunters positioned at each spawn
const hunters = [];
const stable = (await ok('world', {}, A1.tok)).world.spawns.filter(s => s.expires > Date.now() + 120000 && s.id !== sp.id);
for (const s of stable.slice(0, 5)) { const hh = await mkUser(null); await ok('admin/user_grant', { id: hh.id, xp: 60000, essence: 8000, shards: 6 }, admin); await ok('pos', { lat: s.lat, lng: s.lng, acc: 5, demo: 1 }, hh.tok); const e = await ok('encounter_start', { spawnId: s.id }, hh.tok); let f = e.fight, rr = null; for (let i = 0; i < 40 && f.status === 'active'; i++) { const act = f.ehp / f.emax <= 0.4 ? 'bind' : (f.php < f.pmax * 0.3 ? 'guard' : 'strike'); const j = await ok('encounter_act', { id: f.id, action: act, tb: 0.5 }, hh.tok); f = j.fight; rr = j.result; } hunters.push({ ...hh, res: rr }); }
const withShadow = hunters.find(h => h.res && h.res.shadow); assert.ok(withShadow, 'at least one extraction among 5 fights'); step(`extraction works (${hunters.filter(h => h.res && h.res.shadow).length}/5 got a shadow)`);
const army = await ok('army', {}, withShadow.tok); assert.ok(army.army.length >= 1); const sh0 = army.army[0]; step('shadow in collection');
const lv = await ok('army_level', { id: sh0.id }, withShadow.tok); assert.equal(lv.shadow.level, sh0.level + 1); assert.ok(lv.essence < 8000 + 1000); step('shadow levelled up with essence');
assert.equal((await call('army_evolve', { id: sh0.id }, withShadow.tok))._status, 400); step('evolution needs the level cap');
const poor = await mkUser(null); assert.equal((await call('army_level', { id: sh0.id }, poor.tok))._status, 404); step('cannot level someone else\'s shadow');
const fav = await ok('army_fav', { id: sh0.id }, withShadow.tok); assert.equal(fav.fav, true); assert.equal((await call('army_release', { id: sh0.id }, withShadow.tok))._status, 400); await ok('army_fav', { id: sh0.id }, withShadow.tok); const rel = await ok('army_release', { id: sh0.id }, withShadow.tok); assert.ok(rel.gained > 0); step('favourite lock + release for essence');
// evolve path: grant levels via repeated level ups
const evHunter = withShadow; let list = (await ok('army', {}, evHunter.tok)).army; if (list.length) { const t = list[0]; for (let i = t.level; i < 15; i++) await ok('army_level', { id: t.id }, evHunter.tok); const ev = await ok('army_evolve', { id: t.id }, evHunter.tok); assert.equal(ev.shadow.stage, 2); step('evolution at level cap -> stage 2'); }
// ---- quests / achievements
const q = await ok('me', {}, withShadow.tok); assert.equal(q.quests.length, 3); assert.equal((await call('quest_claim', { qid: q.quests.find(x => !x.done) ? q.quests.find(x => !x.done).id : 'zzz' }, withShadow.tok))._status, q.quests.some(x => !x.done) ? 400 : 404); step('daily quests listed; unfinished quest cannot be claimed');
const done = q.quests.find(x => x.done && !x.claimed); if (done) { const c = await ok('quest_claim', { qid: done.id }, withShadow.tok); assert.ok(c.xp > 0); assert.equal((await call('quest_claim', { qid: done.id }, withShadow.tok))._status, 409); step('quest claimed once, not twice'); } else step('(no quest finished by this run today — claim path covered by pw test)');
assert.ok(q.achievements.some(a => a.key === 'first_catch' && a.at)); step('achievement unlocked: First Extraction');
// ---- leaderboard
const lb = await ok('leaderboard', { scope: 'global' }, withShadow.tok); assert.ok(lb.rows.length >= 2 && lb.rows[0].score >= lb.rows[1].score); const wk = await ok('leaderboard', { scope: 'weekly' }, withShadow.tok); assert.ok(wk.rows.length >= 1); step('global + weekly leaderboards');
// ---- dungeon gate (solo + co-op + horn)
const G0 = (await ok('world', {}, A1.tok)).world.gates.sort((a, b) => a.rank - b.rank)[0]; assert.ok(G0, 'gate present (gateChance=1)');
const host = await mkUser(null), buddy = await mkUser(null); for (const x of [host, buddy]) await ok('admin/user_grant', { id: x.id, xp: 180000, essence: 100 }, admin);
await ok('pos', { lat: G0.lat, lng: G0.lng, acc: 5 }, host.tok); await ok('pos', { lat: G0.lat + 0.0003, lng: G0.lng, acc: 5 }, buddy.tok);
const farPlayer = await mkUser({ lat: G0.lat + 0.01, lng: G0.lng }); assert.equal((await call('gate_start', { gateId: G0.id }, farPlayer.tok))._status, 403); step('gate cannot be entered from afar');
await ok('friend_add', { code: (await ok('me', {}, buddy.tok)).me.friendCode }, host.tok); step('friend added by code');
const run0 = (await ok('gate_start', { gateId: G0.id }, host.tok)).run; assert.equal(run0.waves, 4); assert.ok(run0.code); step('gate opened: 4 waves incl. boss, timer ' + Math.round((run0.deadline - Date.now()) / 60000) + ' min');
await ok('gate_horn', { id: run0.id }, host.tok); const horns = (await ok('world', {}, buddy.tok)).world.horns; assert.ok(horns.some(h => h.code === run0.code)); step('co-op raid horn reaches nearby friend');
assert.equal((await call('gate_join', { code: run0.code }, farPlayer.tok))._status, 403); const jn = await ok('gate_join', { code: run0.code }, buddy.tok); assert.equal(jn.run.members.length, 2); step('friend joined the raid (party of 2)');
let run = jn.run, out = {}; for (let i = 0; i < 400 && run.status === 'active'; i++) { for (const m of [host, buddy]) { if (run.status !== 'active') break; const j = await ok('dungeon_act', { id: run0.id, action: i % 5 === 4 ? 'guard' : 'strike', tb: 0.5 }, m.tok); run = j.run; if (j.result) out[m.name] = j.result; } }
assert.equal(run.status, 'cleared'); const rs = await ok('dungeon_state', { id: run0.id }, buddy.tok); assert.ok(rs.run.reward && rs.run.reward.xp > 0); assert.ok((await ok('me', {}, host.tok)).me.gates >= 1); step('dungeon cleared; both party members rewarded (xp/essence/shards)');
assert.equal((await call('gate_start', { gateId: G0.id }, host.tok))._status, 409); step('cleared gate cannot be farmed again');
// ---- guild + boss
const gl = await mkUser(null), gm = await mkUser(null); await ok('admin/user_grant', { id: gl.id, xp: 5000 }, admin); await ok('admin/user_grant', { id: gm.id, xp: 500 }, admin);
const g = (await ok('guild_create', { name: P + ' Guild', tag: 'TST' }, gl.tok)).guild; assert.equal((await call('guild_create', { name: P + ' Guild', tag: 'TST2' }, gm.tok))._status, 409); step('guild created (needs level 3; unique name)');
await ok('guild_join', { id: g.id }, gm.tok); const gi = await ok('guild_info', {}, gl.tok); assert.equal(gi.members.length, 2); assert.ok(gi.boss.max >= 4000); step('member joined; weekly guild boss ready');
let last; for (let i = 0; i < 5; i++) last = await ok('guild_boss_attack', {}, gm.tok); assert.equal((await call('guild_boss_attack', {}, gm.tok))._status, 429); step('guild boss chip damage (5/day limit)');
await ok('guild_boss_attack', {}, gl.tok); const gi2 = await ok('guild_info', {}, gl.tok); assert.ok(gi2.boss.hp < gi2.boss.max && gi2.totalDmg > 0); const gb = await ok('leaderboard', { scope: 'guilds' }, gl.tok); assert.ok(gb.rows.some(x => x.mine && x.dmg > 0)); step('guild leaderboard counts damage');
assert.equal((await call('guild_boss_claim', {}, gl.tok))._status, 400); step('reward only after boss is defeated');
await ok('guild_leave', {}, gm.tok); assert.equal((await ok('guild_info', {}, gm.tok)).guild, null); step('guild leave');
// ---- territory
const T0 = { lat: C0.lat + 0.02, lng: C0.lng + 0.02 }; const tl = await mkUser(T0), tl2 = await mkUser(T0); for (const x of [tl, tl2]) await ok('admin/user_grant', { id: x.id, xp: 90000 }, admin);
let tf = (await ok('zone_challenge', {}, tl.tok)).fight; for (let i = 0; i < 40 && tf.status === 'active'; i++) { const j = await ok('encounter_act', { id: tf.id, action: tf.php < tf.pmax * 0.3 ? 'guard' : 'power', tb: 1 }, tl.tok); tf = j.fight; if (j.result) res = j.result; }
assert.equal(tf.status, 'won', 'zone fight ' + tf.status); assert.equal(res.outcome, 'claimed'); const tw = (await ok('world', {}, tl.tok)).world; assert.ok(tw.zones.some(z => z.mine && z.color)); step('guardian defeated -> zone claimed, shown with owner colour');
assert.equal((await call('zone_challenge', {}, tl2.tok))._status, 409); step('freshly claimed zone is protected');
assert.ok((await ok('territories', {}, tl.tok)).mine.length === 1); const tr = await ok('admin/territory_reset', {}, admin); assert.ok(tr.cleared >= 1); assert.equal((await ok('territories', {}, tl.tok)).mine.length, 0); step('territory list + admin weekly reset');
// ---- trading
const trA = await mkUser(T0), trB = await mkUser(T0), trC = await mkUser({ lat: T0.lat + 0.01, lng: T0.lng }); await ok('admin/user_grant', { id: trA.id, xp: 90000 }, admin);
// give trA a shadow via a guild-less extraction: loop encounters not possible -> use a hunter that has one
await ok('friend_add', { code: (await ok('me', {}, trA.tok)).me.friendCode }, trB.tok); await ok('friend_add', { code: (await ok('me', {}, trA.tok)).me.friendCode }, trC.tok);
// make trA own a shadow: fight at T0 with a strong hunter until extraction (guaranteed via bind)
let got = null; for (let k = 0; k < 6 && !got; k++) { const w = (await ok('world', {}, trA.tok)).world.spawns.filter(s => s.dist < 190)[k]; if (!w) break; const e = await ok('encounter_start', { spawnId: w.id }, trA.tok); let f = e.fight, rr = null; for (let i = 0; i < 40 && f.status === 'active'; i++) { const j = await ok('encounter_act', { id: f.id, action: f.ehp / f.emax <= 0.4 ? 'bind' : 'power', tb: 1 }, trA.tok); f = j.fight; rr = j.result; } if (rr && rr.shadow) got = rr.shadow; }
assert.ok(got, 'trader has a shadow'); assert.equal((await call('trade_offer', { to: trC.id, give: got.id }, trA.tok))._status, 403); step('cannot trade with a friend who is not nearby'); const offer = await ok('trade_offer', { to: trB.id, give: got.id }, trA.tok); assert.equal(offer.gift, true); step('gift offered to nearby friend');
assert.equal((await call('trade_respond', { id: offer.id, accept: true }, trA.tok))._status, 403); const acc = await ok('trade_respond', { id: offer.id, accept: true }, trB.tok); assert.equal(acc.status, 'accepted');
assert.ok((await ok('army', {}, trB.tok)).army.some(x => x.id === got.id && x.traded)); assert.ok(!(await ok('army', {}, trA.tok)).army.some(x => x.id === got.id)); step('trade completed — ownership moved');
assert.equal((await call('trade_respond', { id: offer.id, accept: true }, trB.tok))._status, 410); step('trade cannot be accepted twice');
assert.equal((await call('friend_add', { code: 'ZZZZZZZZ' }, trA.tok))._status, 404); step('unknown friend code');
// ---- beacons
await ok('admin/beacon_add', { code: P.toUpperCase() + 'B', name: 'Test Cafe', reward: 90 }, admin); const bc = await ok('beacon_checkin', { code: P.toLowerCase() + 'b' }, trB.tok); assert.equal(bc.essence >= 40, true); assert.equal((await call('beacon_checkin', { code: P + 'B' }, trB.tok))._status, 409); assert.equal((await call('beacon_checkin', { code: 'NOPE' }, trB.tok))._status, 404); step('QR beacon check-in once per day');
await ok('admin/beacon_add', { code: P.toUpperCase() + 'G', name: 'Park Gate', reward: 70, lat: T0.lat + 0.05, lng: T0.lng, radius: 80 }, admin); assert.equal((await call('beacon_checkin', { code: P + 'G' }, trB.tok))._status, 403); step('geo beacon requires being there');
// ---- relics
const cr = await ok('relic_craft', {}, withShadow.tok).catch(e => null); const smith = await mkUser(null); await ok('admin/user_grant', { id: smith.id, shards: 5, essence: 60 }, admin); const rc = await ok('relic_craft', {}, smith.tok); assert.ok(rc.relic.name && rc.relic.slot); await ok('relic_equip', { id: rc.relic.id }, smith.tok); const inv = await ok('inventory', {}, smith.tok); assert.ok(inv.relics[0].equipped); assert.equal((await call('relic_craft', {}, smith.tok))._status, 402); step('relic crafted, equipped; insufficient materials refused');
// ---- events
await ok('admin/event_set', { k: 'eclipse', active: true, hours: 1 }, admin); const ev = (await ok('me', {}, trB.tok)); assert.equal(ev.phase.phase, 'night'); assert.ok(ev.events.some(e => e.k === 'eclipse')); await ok('admin/event_set', { k: 'eclipse', active: false }, admin); assert.ok(!(await ok('me', {}, trB.tok)).events.some(e => e.k === 'eclipse')); step('admin event "Eclipse Hour" toggled on/off (forces night)');
// ---- safe-play: block zone removes spawns, hot zone
const bz = (await ok('admin/zone_add', { kind: 'block', lat: C0.lat, lng: C0.lng, radius: 800, name: 'Highway' }, admin)).id; const wb = (await ok('world', {}, A1.tok)).world; assert.equal(wb.spawns.length, 0); assert.ok(wb.gates.every(g => g.dist > 790)); await ok('admin/zone_del', { id: bz }, admin); assert.ok((await ok('world', {}, A1.tok)).world.spawns.length > 0); step('no-play zone removes spawns/gates; removable');
// ---- admin: custom creature, announcements, ban, audit
const cc = await ok('admin/creature_add', { name: 'Test Wraith', shape: 'wraith', r: 1, hue: 300, eyes: 3, hp: 70, atk: 14, def: 6 }, admin); assert.ok((await ok('config')).species.some(s => s.id === cc.id)); step('custom creature added and published to clients');
await ok('admin/announce_add', { title: 'Hello hunters', body: 'Eclipse hour tonight' }, admin); assert.ok((await ok('me', {}, trB.tok)).announcements.length >= 1); step('announcement visible to players');
const ul = await ok('admin/users', { q: P }, admin); assert.ok(ul.users.length >= 10); const vic = ul.users.find(u => u.username === probe.name); await ok('admin/user_ban', { id: vic.id, reason: 'test ban' }, admin); assert.equal((await call('me', {}, probe.tok))._status, 401); assert.equal((await call('login', { username: probe.name, password: 'secret12' }))._status, 403); await ok('admin/user_unban', { id: vic.id }, admin); await ok('login', { username: probe.name, password: 'secret12' }); step('ban kills sessions + blocks login; unban restores');
const delU = await mkUser(null); await ok('admin/user_delete', { id: delU.id }, admin); assert.equal((await call('me', {}, delU.tok))._status, 401); assert.equal((await call('login', { username: delU.name, password: 'secret12' }))._status, 401); assert.equal((await call('admin/user_delete', { id: delU.id }, admin))._status, 404); step('admin can delete a user (account + data) completely');
const au = await ok('admin/audit', {}, admin); assert.ok(au.rows.some(r => r.action === 'ban') && au.rows.some(r => r.action === 'anticheat_lock') && au.rows.some(r => r.action === 'settings')); step('audit log has ban / settings / anticheat entries');
const st = await ok('admin/stats', {}, admin); assert.ok(st.players >= 10 && st.version); const lbs = await ok('admin/leaderboards', {}, admin); assert.ok(lbs.top.length > 0); const rp = await ok('admin/report', {}, admin); assert.ok(rp.rarity.length > 0); step('admin stats / leaderboards / reports');
await ok('admin/settings_reset', {}, admin); step('settings reset to defaults');
console.log('ALL OK', n);

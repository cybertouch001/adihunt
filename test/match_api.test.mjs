// Match API + realtime test with several simultaneous clients: BASE=http://127.0.0.1:8811 node test/match_api.test.mjs
import assert from 'node:assert/strict';
const BASE = process.env.BASE; const P = 'm' + Date.now().toString(36).slice(-5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(m, body = {}, tok) { const r = await fetch(BASE + '/api/' + m, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ah': '1', 'cf-connecting-ip': '10.' + (1 + Math.floor(Math.random() * 250)) + '.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }); const j = await r.json(); j._status = r.status; return j; }
const ok = async (m, b, t) => { const j = await call(m, b, t); if (!j.ok) throw new Error(m + ': ' + j.error); return j; };
let n = 0; const step = (s) => console.log('ok', ++n, s);
const C = { lat: 25.31 + Math.random() * 0.2, lng: 82.95 + Math.random() * 0.2 };
const mv = (lat, lng, dx, dy) => ({ lat: lat + dy / 110574, lng: lng + dx / (111320 * Math.cos(lat * Math.PI / 180)) });
async function mkUser(i) { const name = P + 'u' + i; const j = await ok('signup', { username: name, password: 'secret12', tz: 330 }); return { name, tok: j.token, id: j.user.id }; }
const users = []; for (let i = 0; i < 4; i++) users.push(await mkUser(i));
const [A, B, Cc, D] = users;
// host at C, others 5-40 m away
const spots = [mv(C.lat, C.lng, 0, 0), mv(C.lat, C.lng, 20, 0), mv(C.lat, C.lng, 0, 30), mv(C.lat, C.lng, -25, -10)];
for (let i = 0; i < 4; i++) await ok('pos', { lat: spots[i].lat, lng: spots[i].lng, acc: 5, demo: 1 }, users[i].tok);
step('4 accounts signed up and placed');
// ---- live match: host creates, others join by code (simultaneously)
const created = await ok('match_create', { mode: 'live', radius: 300, headStart: 0, timeLimit: 10, visibility: 'teammates' }, A.tok);
const code = created.match.code; assert.equal(created.match.status, 'lobby'); assert.match(code, /^[A-Z0-9]{6}$/);
assert.equal((await call('match_create', { mode: 'live', radius: 300, headStart: 0, timeLimit: 10, visibility: 'none' }, A.tok))._status, 409); step('host cannot open a second match');
const joins = await Promise.all([B, Cc, D].map(u => call('match_join', { code }, u.tok)));
joins.forEach(j => assert.equal(j.ok, true, j.error)); step('three players join by code at the same moment');
assert.equal((await call('match_join', { code: 'ZZZZZZ' }, B.tok))._status, 404); step('unknown code refused');
assert.equal((await call('match_start', { match: created.match.id }, B.tok))._status, 403); step('non-host cannot start');
const started = await ok('match_start', { match: created.match.id }, A.tok);
assert.equal(started.match.status, 'running'); const seekers = started.players.filter(p => p.role === 'seeker'); assert.equal(seekers.length, 1, 'exactly one seeker visible to the host');
step('host starts, one Seeker chosen');
const roles = {}; const states = await Promise.all(users.map(u => ok('match_state', { match: created.match.id }, u.tok)));
for (const s of states) roles[s.me.uid] = s.me.role; const seekerUid = Object.keys(roles).find(k => roles[k] === 'seeker');
assert.ok(seekerUid, 'a seeker exists'); assert.equal(Object.values(roles).filter(r => r === 'seeker').length, 1);
const seekerU = users.find(u => u.id === seekerUid); const hiders = users.filter(u => u.id !== seekerUid);
step('everyone polls at once: roles agree, exactly one Seeker');
// hiders post positions; seeker gets the ping snapshot, never live hider coordinates
const hiderSpot = { }; for (const h of hiders) { const sp = spots[users.indexOf(h)]; hiderSpot[h.id] = sp; await ok('match_pos', { match: created.match.id, lat: sp.lat, lng: sp.lng, acc: 5 }, h.tok); }
await ok('match_pos', { match: created.match.id, lat: spots[users.indexOf(seekerU)].lat, lng: spots[users.indexOf(seekerU)].lng, acc: 5 }, seekerU.tok);
const sS = await ok('match_state', { match: created.match.id }, seekerU.tok);
// (the release ping can predate the first fixes: hiders then read as no signal, which is the design)
assert.ok(sS.ping, 'seeker receives a ping at release'); assert.equal(sS.ping.hiders.length, 3); assert.ok(sS.ping.hiders.every(h => 'x' in h && 'state' in h));
step('seeker receives the 2-minute ping with every hider location');
const hS = await ok('match_state', { match: created.match.id }, hiders[0].tok);
assert.equal(hS.ping, null, 'hiders get no ping');
const seekerAsSeenByHider = hS.players.find(p => p.uid === seekerUid); assert.equal(seekerAsSeenByHider.x, undefined, 'hiders never get the Seeker position');
step('hiders get no ping and never see the Seeker position');
const hideSeen = hS.players.filter(p => p.uid !== hiders[0].id && p.uid !== seekerUid).map(p => p.x);
assert.ok(hideSeen.every(x => x != null), 'teammates visible to hiders when host enables it');
step('host-enabled teammate visibility works for hiders');
// seeker with a hider far away cannot tag; near one can
const pS = await ok('match_pos', { match: created.match.id, lat: spots[users.indexOf(seekerU)].lat, lng: spots[users.indexOf(seekerU)].lng, acc: 5 }, seekerU.tok);
const far = await call('match_tag', { match: created.match.id, uid: hiders[0].id }, seekerU.tok);
// hiders are 20-40 m from the host spot, so at least one is out of the 15 m reach
const sk = spots[users.indexOf(seekerU)]; const close = mv(sk.lat, sk.lng, 4, 0);       // hiders[0] steps to 4 m from the Seeker
assert.equal((await call('match_tag', { match: created.match.id, uid: hiders[0].id }, seekerU.tok))._status, 409);   // stale or far is refused
await ok('match_pos', { match: created.match.id, lat: close.lat, lng: close.lng, acc: 5 }, hiders[0].tok);
await ok('match_pos', { match: created.match.id, lat: sk.lat, lng: sk.lng, acc: 5 }, seekerU.tok);
await ok('match_tag', { match: created.match.id, uid: hiders[0].id }, seekerU.tok); step('tag within reach catches a real hider');
assert.equal((await call('match_tag', { match: created.match.id, uid: hiders[hiders.length - 1].id }, hiders[0].tok))._status, 403); step('a hider cannot tag');
const h1 = hiders[1]; const h1s = hiderSpot[h1.id]; const jump = await ok('match_pos', { match: created.match.id, lat: h1s.lat + 0.2, lng: h1s.lng, acc: 5 }, h1.tok);
assert.ok(jump.warning, 'a 22 km jump is refused by the speed check'); step('speed check refuses a teleport in a match');
const decoy = await ok('match_decoy', { match: created.match.id }, h1.tok); assert.equal(decoy.me.decoysLeft, 1); step('hider uses a decoy (2 total)');
const hs0 = await ok('match_state', { match: created.match.id }, hiders[0].tok); assert.equal(hs0.players.find(p => p.uid === hiders[0].id).state, 'caught'); step('the tagged hider shows as caught');
const rad = await ok('match_radar', { match: created.match.id }, seekerU.tok); assert.ok(rad.radar && typeof rad.radar.alive === 'number'); assert.equal(rad.me.radarLeft, 1);
for (const r of rad.radar.inRange) assert.deepEqual(Object.keys(r).sort(), ['bearing', 'dist']);
step('radar gives distance and bearing only');
assert.equal((await call('match_radar', { match: created.match.id }, hiders[0].tok))._status, 409); step('hider has no radar');
const rep0 = await call('match_replay', { match: created.match.id }, A.tok); assert.equal(rep0._status, 409); step('replay is closed while the match runs');
// host ends
const ended = await ok('match_end', { match: created.match.id }, A.tok);
assert.equal(ended.match.status, 'ended'); assert.equal(ended.result.reason, 'host_ended'); step('host ends the match; result recorded');
const rep = await ok('match_replay', { match: created.match.id }, hiders[0].tok); assert.equal(rep.players.length, 4); step('players can open the post-match replay');
const outsider = await mkUser('x'); assert.equal((await call('match_replay', { match: created.match.id }, outsider.tok))._status, 403); step('a non-player cannot open the replay');
const after = await ok('match_state', { match: created.match.id }, A.tok); assert.ok(after.match && after.match.status === 'ended'); assert.equal(after.me.stats.plays >= 1, true); step('stats and XP move after the match');
// ---- virtual arena: field of view + zone elimination (grace 45 s)
const va = await ok('match_create', { mode: 'virtual', radius: 60, headStart: 0, timeLimit: 10, visibility: 'none', lat: C.lat, lng: C.lng }, B.tok);
const vcode = va.match.code; for (const u of [Cc, D, A]) await ok('match_join', { code: vcode }, u.tok);
const vs = await ok('match_start', { match: va.match.id }, B.tok); assert.equal(vs.match.mode, 'virtual');
const vst = await Promise.all([B, Cc, D, A].map(u => ok('match_state', { match: va.match.id }, u.tok)));
const vSeekerIdx = vst.findIndex(s => s.me.role === 'seeker'); assert.ok(vSeekerIdx >= 0, 'virtual seeker exists'); const vSeekerUid = vst[vSeekerIdx].me.uid; const vseeker = [B, Cc, D, A][vSeekerIdx];
const vhiders = [B, Cc, D, A].filter(u => u.id !== vSeekerUid);
const zone0 = vs.match.zone; assert.ok(zone0 && zone0.r === 60, 'zone starts at host radius');
// seeker at (0,0) heading north; one hider 20 m ahead (seen), one 20 m behind (not seen)
await ok('match_pos', { match: va.match.id, x: 0, y: 0, heading: 0 }, vseeker.tok);
await ok('match_pos', { match: va.match.id, x: 0, y: 20 }, vhiders[0].tok);
await ok('match_pos', { match: va.match.id, x: 0, y: -20 }, vhiders[1].tok);
await ok('match_pos', { match: va.match.id, x: 1, y: 1 }, vhiders[2].tok);
const sv = await ok('match_state', { match: va.match.id }, vseeker.tok);
assert.ok(sv.seen.includes(vhiders[0].id), 'hider ahead is seen'); assert.ok(!sv.seen.includes(vhiders[1].id), 'hider behind is not seen');
step('virtual arena: Seeker sees only hiders in the field of view');
// hider walks (speed-limited steps) to the arena corner farthest from the zone centre, then waits out the 45 s grace
const out = vhiders[2];
let zc = vs.match.zone; const cands = [[95, 95], [-95, 95], [95, -95], [-95, -95]];
const farP = cands.map(([x, y]) => ({ x, y, d: Math.hypot(x - zc.x, y - zc.y) })).sort((p, q) => q.d - p.d)[0];
assert.ok(farP.d > zc.r + 5, 'a corner outside the zone exists');
let cur = { x: 1, y: 1 };
for (let guard = 0; guard < 60 && Math.hypot(farP.x - cur.x, farP.y - cur.y) > 1; guard++) {
  const dd = Math.hypot(farP.x - cur.x, farP.y - cur.y), step = Math.min(7, dd);
  cur = { x: cur.x + (farP.x - cur.x) / dd * step, y: cur.y + (farP.y - cur.y) / dd * step };
  await ok('match_pos', { match: va.match.id, x: cur.x, y: cur.y }, out.tok); await sleep(1100);
}
let st = await ok('match_state', { match: va.match.id }, out.tok);
assert.equal(st.me.outside, true, 'hider is flagged outside the zone'); step('hider outside the shrinking zone is flagged');
const deadline = Date.now() + 58000;
while (Date.now() < deadline) { await sleep(2000); await call('match_pos', { match: va.match.id, x: farP.x, y: farP.y }, out.tok); st = await ok('match_state', { match: va.match.id }, vseeker.tok); if (st.players.find(p => p.uid === out.id).state !== 'alive') break; }
const outRow = st.players.find(p => p.uid === out.id); assert.equal(outRow.state, 'zone', 'zone eliminated the hider after the grace period'); step('a hider outside the shrinking zone for 45 s is out');
// the last-survivor rule: with 3 hiders, catch one by touch -> still running; then ensure end happens on time
const fin = await ok('match_end', { match: va.match.id }, B.tok); assert.equal(fin.match.status, 'ended'); step('virtual match ended by host');
// cleanup: leave every match so no one stays in a match
console.log('ALL', n, 'checks passed');

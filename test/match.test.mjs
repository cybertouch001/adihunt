// Unit tests for the Live Match rules: node --test test/match.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import * as MR from '../server/matchrules.js';
const { M } = MR;

test('zone: first circle has the host radius, later circles only shrink and stay inside the previous one', () => {
  for (const seed of ['a', 'b', 'c', 'match-42|1700000000000']) {
    const st = MR.buildZone({ radius0: 300, minRadius: 20, stageSec: 120, seed });
    assert.equal(st[0].r, 300); assert.equal(st[0].t, 0);
    for (let i = 1; i < st.length; i++) {
      assert.ok(st[i].r < st[i - 1].r, 'radius shrinks');
      assert.ok(st[i].t > st[i - 1].t, 'time increases');
      const d = Math.hypot(st[i].x - st[i - 1].x, st[i].y - st[i - 1].y);
      assert.ok(d + st[i].r <= st[i - 1].r + 1e-6, `stage ${i} inside stage ${i - 1}`);
    }
    assert.ok(st[st.length - 1].r >= 20 - 1e-9, 'never below the minimum radius');
  }
});
test('zone: first centre is random inside the host radius (not always the origin), deterministic per seed', () => {
  const a = MR.buildZone({ radius0: 300, minRadius: 20, stageSec: 120, seed: 'x' }), b = MR.buildZone({ radius0: 300, minRadius: 20, stageSec: 120, seed: 'x' });
  assert.deepEqual(a, b);
  const c = MR.buildZone({ radius0: 300, minRadius: 20, stageSec: 120, seed: 'y' });
  assert.notDeepEqual(a[0], c[0]);
  for (const s of [a, c]) assert.ok(Math.hypot(s[0].x, s[0].y) <= 300 + 1e-6);
});
test('zone: zoneAt / nextStageAt pick the stage in force and hold the last one', () => {
  const st = MR.buildZone({ radius0: 150, minRadius: 12, stageSec: 90, seed: 'z' });
  assert.equal(MR.zoneAt(st, 0).r, 150); assert.equal(MR.zoneAt(st, 89).r, 150);
  assert.equal(MR.zoneAt(st, 90).r, st[1].r);
  assert.equal(MR.zoneAt(st, 10 ** 6).r, st[st.length - 1].r);
  assert.equal(MR.nextStageAt(st, 0), 90); assert.equal(MR.nextStageAt(st, 10 ** 6), null);
});
test('zone: inZone uses the circle radius', () => {
  const z = { x: 0, y: 0, r: 50 };
  assert.ok(MR.inZone(z, { x: 30, y: 40 })); assert.ok(!MR.inZone(z, { x: 40, y: 40 }));
});
test('pings: every 2 minutes, none after the match ends', () => {
  assert.equal(M.PING_SEC, 120);
  assert.ok(MR.pingDue(1000, 1000, 9999)); assert.ok(!MR.pingDue(1000, 999, 9999)); assert.ok(!MR.pingDue(1000, 2000, 900)); assert.ok(MR.pingDue(1000, 2000, 1500));
  assert.equal(MR.endsAtFor(0, 10), 600000);
});
test('tags: live reach is 15 m, virtual is touch range; only seeker tags a live hider with a fresh fix', () => {
  const now = 100000;
  const s = { x: 0, y: 0, role: 'seeker', state: 'alive', pos_ts: now };
  const hNear = { x: 12, y: 0, role: 'hider', state: 'alive', pos_ts: now };
  const hFar = { x: 16, y: 0, role: 'hider', state: 'alive', pos_ts: now };
  assert.equal(MR.canTag(s, hNear, false, now).ok, true);
  assert.equal(MR.canTag(s, hFar, false, now).reason, 'too_far');
  assert.equal(MR.canTag(s, { ...hNear, x: 6 }, true, now).reason, 'too_far');
  assert.equal(MR.canTag(s, { ...hNear, x: 3 }, true, now).ok, true);
  assert.equal(MR.canTag(hNear, s, false, now).reason, 'not_seeker');
  assert.equal(MR.canTag(s, { ...hNear, state: 'caught' }, false, now).reason, 'not_a_live_hider');
  assert.equal(MR.canTag(s, { ...hNear, pos_ts: now - 60000 }, false, now).reason, 'no_fresh_position');
});
test('movement: live 10 m/s + 30 m slack, virtual 8 m/s + 2 m slack; first fix always fine', () => {
  assert.equal(MR.moveOk(null, { x: 5000, y: 0 }, 1000, false).ok, true);
  assert.equal(MR.moveOk({ x: 0, y: 0, ts: 0 }, { x: 100, y: 0 }, 5000, false).ok, false);
  assert.equal(MR.moveOk({ x: 0, y: 0, ts: 0 }, { x: 60, y: 0 }, 5000, false).ok, true);     // 60 <= 80
  assert.equal(MR.moveOk({ x: 0, y: 0, ts: 0 }, { x: 40, y: 0 }, 1000, true).ok, false);     // 40 > 8+2
  assert.equal(MR.moveOk({ x: 0, y: 0, ts: 0 }, { x: 9, y: 0 }, 1000, true).ok, true);       // 9 <= 10
});
test('virtual field of view: hiders inside 60 deg either side and 35 m are seen, others are not', () => {
  const seeker = { x: 0, y: 0 };
  const hiders = [
    { uid: 'ahead', x: 0, y: 20, state: 'alive' },      // straight ahead (north), heading 0
    { uid: 'side', x: 20, y: 5, state: 'alive' },       // east-ish, ~76 deg off
    { uid: 'far', x: 0, y: 50, state: 'alive' },        // too far
    { uid: 'behind', x: 0, y: -10, state: 'alive' },    // behind
    { uid: 'dead', x: 0, y: 10, state: 'caught' },      // already caught
  ];
  assert.deepEqual(MR.seenBy(seeker, 0, hiders), ['ahead']);
  assert.ok(MR.seenBy(seeker, 90, hiders).includes('side'));
});
test('radar: distance and bearing only, no coordinates, live hiders only', () => {
  const seeker = { x: 0, y: 0 };
  const r = MR.radarReadout(seeker, [{ uid: 'a', x: 0, y: 103, state: 'alive' }, { uid: 'b', x: 900, y: 0, state: 'alive' }, { uid: 'c', x: 3, y: 3, state: 'caught' }]);
  assert.equal(r.alive, 2); assert.equal(r.beyond, 1); assert.equal(r.inRange.length, 1);
  assert.deepEqual(Object.keys(r.inRange[0]).sort(), ['bearing', 'dist']);
  assert.equal(r.inRange[0].dist, 105); assert.equal(r.inRange[0].bearing, 0);
});
test('decoy: a fake spot about 150 m away, deterministic per seed', () => {
  const p = { x: 10, y: -20 };
  const d = MR.decoyPoint(p, false, 'seed1'); const dist = Math.hypot(d.x - p.x, d.y - p.y);
  assert.ok(dist >= 90 - 1e-6 && dist <= 150 + 1e-6, 'offset 90-150 m');
  assert.deepEqual(MR.decoyPoint(p, false, 'seed1'), d);
});
test('plane <-> GPS round trip keeps metres', () => {
  const o = { lat: 25.31, lng: 82.97 };
  const p = MR.latLngOf(o, 120, -80); const back = MR.xyOf(o, p.lat, p.lng);
  assert.ok(Math.abs(back.x - 120) < 0.01 && Math.abs(back.y + 80) < 0.01);
});
test('room codes: 6 chars from the unambiguous alphabet, validated', () => {
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 50; i++) { const c = MR.roomCode(r); assert.equal(c.length, 6); assert.ok(MR.validCode(c)); assert.ok(!/[IO01]/.test(c)); }
  assert.equal(MR.validCode('ABC'), false); assert.equal(MR.validCode('ABCI23'), false);
});
test('settings: only offered radii, head starts, time limits and visibility', () => {
  assert.deepEqual(MR.checkSettings('live', { radius: 300, headStart: 60, timeLimit: 15, visibility: 'friends' }), []);
  assert.ok(MR.checkSettings('live', { radius: 9999, headStart: 60, timeLimit: 15, visibility: 'none' }).includes('radius'));
  assert.ok(MR.checkSettings('virtual', { radius: 300, headStart: 60, timeLimit: 15, visibility: 'none' }).includes('radius'));
  assert.ok(MR.checkSettings('live', { radius: 300, headStart: 60, timeLimit: 15, visibility: 'everyone' }).includes('visibility'));
});
test('ranks: points map to Bronze..Diamond', () => {
  assert.equal(MR.rankForPoints(0), 'Bronze'); assert.equal(MR.rankForPoints(199), 'Bronze'); assert.equal(MR.rankForPoints(200), 'Silver');
  assert.equal(MR.rankForPoints(2500), 'Diamond');
});

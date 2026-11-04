// AdiHunt Live Match rules (v1.1) — pure functions (no I/O). Shared by the server and the unit tests.
// Coordinates inside a match are metres on a flat plane (x = east, y = north) measured from the match origin.
// Live mode converts real GPS fixes to that plane; virtual mode uses the plane directly as the arena.
import { rng, clamp, distM } from './rules.js';

export const M = {
  TAG_LIVE_M: 15,            // real-world tag reach (the mission's 10-15 m)
  TAG_VIRTUAL_M: 4,          // virtual arena: catch by touch
  SEEK_VIEW_M: 35,           // virtual arena: how far the Seeker sees (field of view)
  SEEK_HALF_FOV: 60,         // degrees either side of the heading
  PING_SEC: 120,             // Seeker receives everyone's location every 2 minutes
  EXPOSE_GRACE_S: 45,        // a hider outside the safe zone for this long is out
  POS_FRESH_S: 30,           // a last position older than this does not count for tags or zone checks
  SPEED_LIVE_MS: 10, SPEED_VIRT_MS: 8, SLACK_LIVE_M: 30, SLACK_VIRT_M: 2,
  RADIUS_OPTIONS: [150, 300, 500, 800], VIRT_RADIUS_OPTIONS: [60, 100, 150],
  HEAD_START_OPTIONS: [0, 60, 120, 300], TIME_OPTIONS: [10, 15, 20, 30],
  MIN_PLAYERS: 3, MAX_PLAYERS: 12,
  DECOYS: 2, RADARS: 2, DECOY_OFFSET_M: 150, RADAR_RANGE_M: 400,
  SHRINK: 0.7, MIN_RADIUS_LIVE_M: 20, MIN_RADIUS_VIRT_M: 12, MAX_STAGES: 14,
  STAGE_SEC_LIVE: 120, STAGE_SEC_VIRT: 90,
  VISIBILITY: ['none', 'teammates', 'friends'],
  ROOM_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  PTS: { CATCH: 30, SURVIVE_PING: 10, WIN: 50, PLAY: 10 },
  XP: { WIN: 80, PLAY: 20 },
};

// ---------- plane <-> GPS ----------
export function xyOf(origin, lat, lng) {
  const k = Math.cos(origin.lat * Math.PI / 180);
  return { x: (lng - origin.lng) * 111320 * k, y: (lat - origin.lat) * 110574 };
}
export function latLngOf(origin, x, y) {
  const k = Math.max(0.01, Math.cos(origin.lat * Math.PI / 180));
  return { lat: origin.lat + y / 110574, lng: origin.lng + x / (111320 * k) };
}
export const dXY = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// bearing in degrees clockwise from north (+y) from a to b
export function bearingDeg(a, b) { const d = Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI; return (d + 360) % 360; }
export const angleDiff = (a, b) => { let d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

// ---------- zone: nested shrinking circles ----------
// The first circle has the host's radius with a random centre inside that radius (around the origin).
// Each next circle has a smaller radius and its centre lies inside the previous circle, so the zone only ever shrinks.
function randDisk(r, R) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R; return { x: Math.cos(a) * d, y: Math.sin(a) * d }; }
export function buildZone({ radius0, minRadius, stageSec, seed, shrink = M.SHRINK, maxStages = M.MAX_STAGES }) {
  const r = rng('zone|' + seed);
  let c = randDisk(r, radius0), rad = radius0;
  const stages = [{ t: 0, x: c.x, y: c.y, r: rad }];
  for (let i = 1; i < maxStages && rad > minRadius; i++) {
    const nr = Math.max(minRadius, rad * shrink);
    const d = randDisk(r, rad - nr);            // centre stays inside the previous circle
    c = { x: c.x + d.x, y: c.y + d.y }; rad = nr;
    stages.push({ t: i * stageSec, x: c.x, y: c.y, r: rad });
  }
  return stages;
}
// the circle in force `sec` seconds after release (the last stage holds once reached)
export function zoneAt(stages, sec) {
  let cur = stages[0]; for (const s of stages) if (s.t <= sec) cur = s; return cur;
}
export function nextStageAt(stages, sec) { for (const s of stages) if (s.t > sec) return s.t; return null; }
export const inZone = (zone, p) => dXY(zone, p) <= zone.r;

// ---------- pings and timing ----------
export const pingDue = (nextPingAt, now, endsAt) => nextPingAt != null && now >= nextPingAt && nextPingAt < endsAt;
export const endsAtFor = (releaseAt, timeLimitMin) => releaseAt + timeLimitMin * 60000;

// ---------- movement and tags ----------
export function moveOk(prev, next, nowMs, virtual) {
  if (!prev || prev.ts == null) return { ok: true, speed: 0 };
  const dt = Math.max(0.001, (nowMs - prev.ts) / 1000);
  const dist = dXY(prev, next), speed = dist / dt;
  const max = (virtual ? M.SPEED_VIRT_MS : M.SPEED_LIVE_MS) * dt + (virtual ? M.SLACK_VIRT_M : M.SLACK_LIVE_M);
  return { ok: dist <= max, speed, dist };
}
export const tagRange = (virtual) => virtual ? M.TAG_VIRTUAL_M : M.TAG_LIVE_M;
export function canTag(seeker, hider, virtual, nowMs) {
  if (!seeker || !hider) return { ok: false, reason: 'no_target' };
  if (seeker.role !== 'seeker') return { ok: false, reason: 'not_seeker' };
  if (hider.role !== 'hider' || hider.state !== 'alive') return { ok: false, reason: 'not_a_live_hider' };
  if (seeker.state !== 'alive') return { ok: false, reason: 'seeker_out' };
  if (hider.pos_ts == null || nowMs - hider.pos_ts > M.POS_FRESH_S * 1000) return { ok: false, reason: 'no_fresh_position' };
  const d = dXY(seeker, hider); if (d > tagRange(virtual)) return { ok: false, reason: 'too_far', dist: d };
  return { ok: true, dist: d };
}
// virtual arena: hiders the Seeker can see right now (field of view and sight distance)
export function seenBy(seeker, heading, hiders) {
  const out = []; for (const h of hiders) {
    if (h.state !== 'alive' || h.x == null) continue;
    const d = dXY(seeker, h); if (d > M.SEEK_VIEW_M || d < 0.01) continue;
    if (angleDiff(bearingDeg(seeker, h), heading || 0) <= M.SEEK_HALF_FOV) out.push(h.uid);
  } return out;
}
// radar: distance and bearing only, never coordinates or names
export function radarReadout(seeker, hiders) {
  const near = [], far = []; let alive = 0;
  for (const h of hiders) {
    if (h.state !== 'alive' || h.x == null) continue; alive++;
    const d = dXY(seeker, h);
    if (d <= M.RADAR_RANGE_M) near.push({ dist: Math.round(d / 5) * 5, bearing: Math.round(bearingDeg(seeker, h) / 15) * 15 });
    else far.push(h.uid);
  }
  return { alive, inRange: near.sort((a, b) => a.dist - b.dist), beyond: far.length };
}
// decoy: a fake spot offset from the real one (used for the next ping only)
export function decoyPoint(p, virtual, seedStr) {
  const r = rng('decoy|' + seedStr); const a = r() * Math.PI * 2; const d = M.DECOY_OFFSET_M * (0.6 + 0.4 * r());
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
}

// ---------- scoring and ranks ----------
export const RANK_TIERS = [{ id: 'Bronze', min: 0 }, { id: 'Silver', min: 200 }, { id: 'Gold', min: 500 }, { id: 'Platinum', min: 1000 }, { id: 'Diamond', min: 2000 }];
export function rankForPoints(p) { let t = RANK_TIERS[0]; for (const x of RANK_TIERS) if (p >= x.min) t = x; return t.id; }

// ---------- room codes ----------
export function roomCode(r) { let s = ''; for (let i = 0; i < 6; i++) s += M.ROOM_ALPHABET[Math.floor(r() * M.ROOM_ALPHABET.length)]; return s; }
export const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{6}$/.test(c) && [...c].every(ch => M.ROOM_ALPHABET.includes(ch));

// ---------- settings check (host choices) ----------
export function checkSettings(mode, s) {
  const radii = mode === 'virtual' ? M.VIRT_RADIUS_OPTIONS : M.RADIUS_OPTIONS;
  const errs = [];
  if (!radii.includes(s.radius)) errs.push('radius'); if (!M.HEAD_START_OPTIONS.includes(s.headStart)) errs.push('headStart');
  if (!M.TIME_OPTIONS.includes(s.timeLimit)) errs.push('timeLimit'); if (!M.VISIBILITY.includes(s.visibility)) errs.push('visibility');
  return errs;
}
export { distM, clamp };

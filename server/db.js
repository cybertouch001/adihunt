// DB schema + shared helpers for AdiHunt (Cloudflare D1)
import * as R from './rules.js';
import { VERSION, ADMIN_BOOT } from './config.js';
export { VERSION };
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', active INTEGER NOT NULL DEFAULT 1, banned_reason TEXT, created_at INTEGER, level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0, essence INTEGER NOT NULL DEFAULT 60, shards INTEGER NOT NULL DEFAULT 0, color TEXT, friend_code TEXT UNIQUE, tz INTEGER NOT NULL DEFAULT 330, lat REAL, lng REAL, acc REAL, pos_ts INTEGER, speed REAL DEFAULT 0, demo INTEGER DEFAULT 0, lock_until INTEGER DEFAULT 0, strikes INTEGER DEFAULT 0, strike_at INTEGER DEFAULT 0, walked REAL DEFAULT 0, day_walk REAL DEFAULT 0, walk_day INTEGER DEFAULT 0, trail_m REAL DEFAULT 0, guild_id TEXT, streak INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0, streak_day INTEGER DEFAULT 0, weekly_xp INTEGER DEFAULT 0, weekly_week INTEGER DEFAULT 0, caught INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, gates INTEGER DEFAULT 0, zones INTEGER DEFAULT 0, trades INTEGER DEFAULT 0, crafted INTEGER DEFAULT 0, beacons INTEGER DEFAULT 0, bounties INTEGER DEFAULT 0, best_rarity INTEGER DEFAULT -1, safe_ack INTEGER DEFAULT 0, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, app TEXT, device TEXT, created_at INTEGER, last_seen INTEGER, revoked_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS shadows (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sp TEXT NOT NULL, level INTEGER NOT NULL, stage INTEGER NOT NULL DEFAULT 1, r INTEGER NOT NULL, nick TEXT, fav INTEGER DEFAULT 0, traded INTEGER DEFAULT 0, source TEXT, at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS sh_user ON shadows(user_id)`,
  `CREATE TABLE IF NOT EXISTS relics (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slot TEXT, name TEXT, tier INTEGER, bonus TEXT, equipped INTEGER DEFAULT 0, at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS rel_user ON relics(user_id)`,
  `CREATE TABLE IF NOT EXISTS consumed (user_id TEXT NOT NULL, k TEXT NOT NULL, ts INTEGER, PRIMARY KEY (user_id, k))`,
  `CREATE TABLE IF NOT EXISTS fights (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT, ref TEXT, state TEXT, enemy TEXT, status TEXT, version INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS fi_user ON fights(user_id, status)`,
  `CREATE TABLE IF NOT EXISTS cell_act (cx INTEGER, cy INTEGER, uid TEXT, day INTEGER, PRIMARY KEY (cx, cy, uid, day))`,
  `CREATE TABLE IF NOT EXISTS trail (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, ts INTEGER, lat REAL, lng REAL)`,
  `CREATE INDEX IF NOT EXISTS tr_user ON trail(user_id, ts)`,
  `CREATE TABLE IF NOT EXISTS dungeons (id TEXT PRIMARY KEY, gate_id TEXT, host TEXT, code TEXT UNIQUE, state TEXT, status TEXT, version INTEGER DEFAULT 0, rewarded INTEGER DEFAULT 0, glat REAL, glng REAL, rank INTEGER, horn_at INTEGER, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS dungeon_members (run_id TEXT, user_id TEXT, PRIMARY KEY (run_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS quest_progress (user_id TEXT, day INTEGER, qid TEXT, progress INTEGER DEFAULT 0, claimed INTEGER DEFAULT 0, PRIMARY KEY (user_id, day, qid))`,
  `CREATE TABLE IF NOT EXISTS achievements (user_id TEXT, key TEXT, at INTEGER, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE IF NOT EXISTS guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, tag TEXT, leader TEXT, color TEXT, created_at INTEGER, descr TEXT)`,
  `CREATE TABLE IF NOT EXISTS guild_boss (guild_id TEXT, week INTEGER, sp TEXT, hp INTEGER, max INTEGER, level INTEGER, defeated_at INTEGER, PRIMARY KEY (guild_id, week))`,
  `CREATE TABLE IF NOT EXISTS guild_dmg (guild_id TEXT, week INTEGER, user_id TEXT, dmg INTEGER DEFAULT 0, att_day INTEGER DEFAULT 0, att_n INTEGER DEFAULT 0, claimed INTEGER DEFAULT 0, PRIMARY KEY (guild_id, week, user_id))`,
  `CREATE TABLE IF NOT EXISTS territories (zone TEXT PRIMARY KEY, zx INTEGER, zy INTEGER, owner_id TEXT, owner_name TEXT, guild_id TEXT, guild_color TEXT, user_color TEXT, claimed_at INTEGER, power REAL, week INTEGER)`,
  `CREATE TABLE IF NOT EXISTS friends (user_id TEXT, friend_id TEXT, at INTEGER, PRIMARY KEY (user_id, friend_id))`,
  `CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, give_sid TEXT, want_sid TEXT, status TEXT, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS beacons (code TEXT PRIMARY KEY, name TEXT, reward INTEGER DEFAULT 80, lat REAL, lng REAL, radius INTEGER DEFAULT 100, active INTEGER DEFAULT 1, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS beacon_checkins (user_id TEXT, code TEXT, day INTEGER, PRIMARY KEY (user_id, code, day))`,
  `CREATE TABLE IF NOT EXISTS events (k TEXT PRIMARY KEY, name TEXT, descr TEXT, mods TEXT, active INTEGER DEFAULT 0, starts INTEGER, ends INTEGER)`,
  `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS creatures (id TEXT PRIMARY KEY, name TEXT, r INTEGER, shape TEXT, hue INTEGER, eyes INTEGER, horns INTEGER, hp INTEGER, atk INTEGER, def INTEGER, ab TEXT, active INTEGER DEFAULT 1, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, title TEXT, body TEXT, active INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, user_id TEXT, action TEXT, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS map_zones (id TEXT PRIMARY KEY, name TEXT, kind TEXT, lat REAL, lng REAL, radius INTEGER, mult REAL DEFAULT 1, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, w INTEGER, n INTEGER)`,
  `CREATE TABLE IF NOT EXISTS login_fail (k TEXT PRIMARY KEY, n INTEGER, first_at INTEGER)`,
];
export const EVENT_PRESETS = [
  ['eclipse', 'Eclipse Hour', 'The sun goes dark everywhere — it is night for every hunter and rarer shadows surface.', { forceNight: true, rarityMult: [1, 1, 1.2, 1.6, 2, 2] }],
  ['bloodmoon', 'Blood Moon', 'Legendary and Mythic shadows are much more likely to appear.', { rarityMult: [0.8, 0.9, 1, 1.5, 3, 3] }],
  ['goldrush', 'Essence Rush', 'All essence rewards are doubled.', { essenceMult: 2 }], ['doublexp', 'Double XP', 'All XP rewards are doubled.', { xpMult: 2 }],
  ['swarm', 'Shadow Swarm', 'Many more shadows spawn on the map.', { densityMult: 1.6 }], ['gatesurge', 'Gate Surge', 'Dungeon Gates open far more often.', { gateMult: 2.5 }],
];
let ready = null;
export async function init(db) {
  if (!ready) ready = (async () => {
    await db.batch(SCHEMA.map(q => db.prepare(q)));
    for (const [k, name, d, mods] of EVENT_PRESETS) await db.prepare(`INSERT OR IGNORE INTO events (k,name,descr,mods,active) VALUES (?,?,?,?,0)`).bind(k, name, d, JSON.stringify(mods)).run();
    if (ADMIN_BOOT && ADMIN_BOOT.username) {
      const has = await db.prepare(`SELECT id FROM users WHERE role='admin' LIMIT 1`).first();
      if (!has) await db.prepare(`INSERT INTO users (id, role, username, pw, active, created_at, friend_code, essence) VALUES (?, 'admin', ?, ?, 1, ?, ?, 0)`).bind(uid(), ADMIN_BOOT.username, ADMIN_BOOT.pw, Date.now(), 'ADM' + uid(3).toUpperCase()).run();
    }
  })().catch(e => { ready = null; throw e; });
  return ready;
}
export const enc = new TextEncoder();
export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export function uid(n = 12) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf2(pw, saltHex, iter) { const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']); const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16))); return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256)); }
export async function hashPw(pw) { const salt = uid(16); return `pbkdf2-sha256$100000$${salt}$${await pbkdf2(pw, salt, 100000)}`; }
export async function checkPw(pw, stored) { const [alg, it, salt, h] = String(stored || '').split('$'); if (alg !== 'pbkdf2-sha256') return false; const got = await pbkdf2(String(pw), salt, Number(it)); let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ got.charCodeAt(i); return d === 0 && got.length === h.length; }
export class ApiError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
export const bad = (m, st = 400, extra) => { throw new ApiError(st, m, extra); };
export const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
export const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
export const num = (v, d = null) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? d : Number(v);
export async function audit(db, uidv, action, detail) { await db.prepare(`INSERT INTO audit (at, user_id, action, detail) VALUES (?,?,?,?)`).bind(Date.now(), uidv || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail)).run(); }
export async function rate(db, key, limit, windowMs, now = Date.now()) {
  const w = Math.floor(now / windowMs);
  const r = await db.prepare(`INSERT INTO rl (k,w,n) VALUES (?,?,1) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN w = excluded.w THEN n + 1 ELSE 1 END, w = excluded.w RETURNING n`).bind(key, w).first();
  if (r && r.n > limit) throw new ApiError(429, 'Slow down a little — too many requests.');
}
// ---------- ctx: settings, events, custom creatures, map zones (cached 10 s per isolate) ----------
let ctxCache = null;
export function bustCtx() { ctxCache = null; }
export async function getCtx(db, now = Date.now()) {
  if (ctxCache && now - ctxCache.at < 10000 && now >= ctxCache.at) return ctxCache.v;
  const rows = (await db.prepare(`SELECT k, v FROM settings`).all()).results; const o = {}; for (const r of rows) { try { o[r.k] = JSON.parse(r.v); } catch { } }
  const settings = R.mergeSettings(o);
  const evRows = (await db.prepare(`SELECT * FROM events WHERE active=1 AND (starts IS NULL OR starts<=?) AND (ends IS NULL OR ends>=?)`).bind(now, now).all()).results;
  const ev = { rarityMult: [1, 1, 1, 1, 1, 1], densityMult: 1, xpMult: 1, essenceMult: 1, gateMult: 1, forceNight: false, names: [] };
  for (const e of evRows) { let m = {}; try { m = JSON.parse(e.mods); } catch { } ev.names.push({ k: e.k, name: e.name, descr: e.descr, ends: e.ends });
    if (m.rarityMult) ev.rarityMult = ev.rarityMult.map((x, i) => x * (m.rarityMult[i] || 1)); for (const k of ['densityMult', 'xpMult', 'essenceMult', 'gateMult']) if (m[k]) ev[k] *= m[k]; if (m.forceNight) ev.forceNight = true; }
  const custom = (await db.prepare(`SELECT * FROM creatures WHERE active=1`).all()).results.map(c => ({ id: 'c_' + c.id, name: c.name, r: c.r, shape: c.shape, base: { hp: c.hp, atk: c.atk, def: c.def }, hue: c.hue, eyes: c.eyes, horns: c.horns, ab: c.ab || 'Strike', custom: true }));
  const zones = (await db.prepare(`SELECT * FROM map_zones`).all()).results;
  const v = { settings, events: ev, custom, zones }; ctxCache = { at: now, v }; return v;
}
export const speciesOf = (ctx, id) => R.SPECIES_BY_ID[id] || ctx.custom.find(c => c.id === id) || null;
export function zoneInfo(ctx, lat, lng) { let blocked = false, mult = 1; for (const z of ctx.zones) { if (R.distM({ lat, lng }, z) <= z.radius) { if (z.kind === 'block') blocked = true; else mult = Math.max(mult, z.mult || 1); } } return { blocked, mult }; }
export function spawnOpts(ctx, density = 1) { return { settings: ctx.settings, density, customSpecies: ctx.custom, events: ctx.events }; }

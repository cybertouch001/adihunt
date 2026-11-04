// AdiHunt — hosted API (Cloudflare Worker + D1). Static files (landing page, web app, APK) come from ASSETS.
import { VERSION, APK } from './config.js';
import { init, json, ApiError, rate } from './db.js';
import * as G from './game.js';
import * as S from './social.js';
import { A } from './admin.js';

const needHdr = (req) => { if (req.headers.get('x-ah') !== '1') throw new ApiError(400, 'Missing client header'); };
const P = { // player methods: name -> handler(db, user, body)
  me: G.me, safe_ack: G.safeAck, set_color: G.setColor, logout: (db, u) => G.logout(db, u), change_password: G.changePassword,
  pos: G.pos, world: G.worldGet, encounter_start: G.encounterStart, encounter_act: G.encounterAct, zone_challenge: G.zoneChallenge, territories: G.territories,
  army: G.army, army_level: G.armyLevel, army_evolve: G.armyEvolve, army_release: G.armyRelease, army_fav: G.armyFav, army_rename: G.armyRename,
  quest_claim: G.questClaim, inventory: G.inventory, relic_craft: G.relicCraft, relic_equip: G.relicEquip, beacon_checkin: G.beaconCheckin, trail: G.trail, leaderboard: G.leaderboard,
  guild_create: S.guildCreate, guild_list: S.guildList, guild_join: S.guildJoin, guild_leave: S.guildLeave, guild_info: S.guildInfo, guild_boss_attack: S.guildBossAttack, guild_boss_claim: S.guildBossClaim,
  friend_add: S.friendAdd, friend_remove: S.friendRemove, friend_list: S.friendList, friend_army: S.friendArmy, trade_offer: S.tradeOffer, trade_list: S.tradeList, trade_respond: S.tradeRespond,
  gate_start: S.gateStart, gate_horn: S.gateHorn, gate_join: S.gateJoin, dungeon_state: S.dungeonState, dungeon_act: S.dungeonAct,
};
async function api(req, env, method) {
  const db = env.DB; await init(db);
  if (method === 'health') return { ok: true, app: 'adihunt', version: VERSION, time: Date.now() };
  if (method === 'config') return G.config(db);
  if (req.method !== 'POST') throw new ApiError(405, 'POST only'); needHdr(req);
  let b = {}; try { b = await req.json(); } catch { b = {}; }
  if (method === 'signup') return G.signup(db, b, req);
  if (method === 'login') return G.loginCommon(db, b, req, 'player');
  if (method === 'admin/login') return G.loginCommon(db, b, req, 'admin');
  if (method.startsWith('admin/')) { const a = await G.authUser(db, req, 'admin'); const fn = A[method.slice(6)]; if (!fn) throw new ApiError(404, 'Unknown action'); return fn(db, a, b); }
  const u = await G.authUser(db, req, 'player'); const fn = P[method]; if (!fn) throw new ApiError(404, 'Unknown action'); return fn(db, u, b);
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      const method = url.pathname.slice(5).replace(/\/+$/, '');
      try { return json({ ok: true, ...(await api(req, env, method)) }); }
      catch (e) { const st = e instanceof ApiError ? e.status : 500; if (st === 500) console.log('api error', method, e && e.stack); return json({ ok: false, error: st === 500 ? 'Server error, please try again' : e.message, ...(e.extra || {}) }, st); }
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') return Response.redirect(url.origin + '/app/admin.html', 302);
    if (APK && url.pathname === '/download/' + APK.name) {
      const r = await env.ASSETS.fetch(new Request(url.origin + '/files/' + APK.name, req)); if (!r.ok) return r;
      const h = new Headers(r.headers); h.set('content-type', 'application/vnd.android.package-archive'); h.set('content-disposition', `attachment; filename="${APK.name}"`); h.set('cache-control', 'no-cache'); return new Response(r.body, { status: 200, headers: h });
    }
    const r = await env.ASSETS.fetch(req);
    if (url.pathname.startsWith('/app/') || url.pathname === '/') { const h = new Headers(r.headers); h.set('cache-control', 'no-cache'); h.set('x-content-type-options', 'nosniff'); if (url.pathname.includes('admin')) { h.set('x-frame-options', 'DENY'); h.set('referrer-policy', 'no-referrer'); } return new Response(r.body, { status: r.status, headers: h }); }
    return r;
  },
};

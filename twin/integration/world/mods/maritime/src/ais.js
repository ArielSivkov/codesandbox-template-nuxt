/* ESH27 twin — maritime / ais.js — LIVE ship data: adapter interface + fixture adapter.
 *
 * NOTHING HERE IS LIVE. The sandbox has no network; only FixtureAIS works. Every adapter exposes
 * `status` ∈ {'fixture','connecting','live','stale','offline','error'} and the UI must show it.
 *
 * Sources researched (23.11.2026) — see README.txt for the full comparison:
 *   aisstream.io   free WebSocket API, API key via GitHub login; "Direct browser connections are not permitted" →
 *                  must run through OUR server (worker/proxy). Up to 3 connections per IP / account. Commercial use
 *                  not addressed on the home page → ask before production use.
 *   MarineTraffic  (Kpler) paid plans; API access only in Enterprise ("contact us"); terrestrial + satellite.
 *   VesselFinder   paid credits API.   Global Fishing Watch: non-commercial licence (fishing vessels).
 *
 * Vessel record (normalised): { mmsi, name, lat, lon, sog (kn), cog (deg true), heading (deg true|null),
 *   type ('cargo'|'tanker'|'passenger'|'pleasure'|'tug'|'other'), length (m|null), ts (ms UTC), src }
 */

export const AIS_STATUS_HE = {
  fixture: 'נתוני AIS לדוגמה (קובץ קבוע) – לא חי',
  connecting: 'מתחבר לשרת AIS…', live: 'AIS חי דרך השרת שלנו', stale: 'AIS – הנתונים ישנים', offline: 'AIS לא זמין – מוצג מצב לדוגמה', error: 'שגיאת AIS',
};

/** AIS ship type code (ITU-R M.1371) → our class */
export function shipClass(code) {
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code === 36 || code === 37) return 'pleasure';
  if (code === 31 || code === 32 || code === 52) return 'tug';
  return 'other';
}

/** dead reckoning on a flat local frame (fine for minutes and a few km) */
export function deadReckon(v, tMs) {
  const dt = Math.max(0, Math.min(600, (tMs - v.ts) / 1000));
  const sp = (v.sog || 0) * 0.514444, c = (v.cog || 0) * Math.PI / 180;
  const dN = Math.cos(c) * sp * dt, dE = Math.sin(c) * sp * dt;
  return { lat: v.lat + dN / 111320, lon: v.lon + dE / (111320 * Math.cos(v.lat * Math.PI / 180)) };
}

/** base class: subclasses call this._emit(list) */
export class AISAdapter {
  constructor() { this.status = 'offline'; this.listeners = new Set(); this.vessels = new Map(); this.lastUpdate = 0; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(list, status) {
    for (const v of list) this.vessels.set(v.mmsi, v);
    if (status) this.status = status; this.lastUpdate = Date.now();
    for (const fn of this.listeners) fn([...this.vessels.values()], this.status);
  }
  get label() { return AIS_STATUS_HE[this.status] || this.status; }
  get isLive() { return this.status === 'live'; }
  start() {} stop() {}
}

/** Replays a fixture file. Timestamps are re-based to "now" so dead reckoning moves the ships; always status 'fixture'. */
export class FixtureAIS extends AISAdapter {
  constructor(fixture, { now = () => Date.now() } = {}) { super(); this.fixture = fixture; this.now = now; this.status = 'fixture'; }
  start() {
    const t0 = this.now(), base = this.fixture.t0 || 0;
    const list = this.fixture.vessels.map(v => ({ ...v, ts: t0 + ((v.ts || base) - base), src: 'fixture' }));
    this._emit(list, 'fixture');
  }
}

/**
 * Design only (cannot be tested here): our server keeps the aisstream.io key and re-publishes a filtered,
 * rate-limited feed for the Ashdod box on wss://<our-worker>/ais. The browser NEVER sees the key.
 * Upstream subscription message (aisstream.io documented shape):
 *   { "APIKey": "<server-side secret>", "BoundingBoxes": [[[31.70, 34.45], [31.95, 34.72]]],
 *     "FilterMessageTypes": ["PositionReport", "ShipStaticData"] }
 * Our server → browser message: { "t": <ms>, "vessels": [ <normalised records> ] } every ≤ 10 s.
 */
export class ServerProxyAIS extends AISAdapter {
  constructor(url, { WebSocketImpl = globalThis.WebSocket, staleMs = 120e3 } = {}) { super(); this.url = url; this.WS = WebSocketImpl; this.staleMs = staleMs; }
  start() {
    if (!this.url || !this.WS) { this.status = 'offline'; this._emit([], 'offline'); return; }
    this.status = 'connecting';
    try {
      const ws = this.ws = new this.WS(this.url);
      ws.onmessage = ev => { try { const m = JSON.parse(ev.data); if (Array.isArray(m.vessels)) this._emit(m.vessels.map(v => ({ ...v, src: 'live' })), 'live'); } catch { /* ignore bad frame */ } };
      ws.onerror = () => { this._emit([], 'error'); };
      ws.onclose = () => { if (this.status !== 'error') this._emit([], 'offline'); };
      this.timer = setInterval(() => { if (this.status === 'live' && Date.now() - this.lastUpdate > this.staleMs) this._emit([], 'stale'); }, 5000);
    } catch { this._emit([], 'error'); }
  }
  stop() { if (this.ws) this.ws.close(); clearInterval(this.timer); }
}

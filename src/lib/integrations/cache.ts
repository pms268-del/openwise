import { createHash } from "node:crypto";
import { sql } from "../db";

export type Sourced<T> = { data: T; source: string; status: "live" | "mock" | "unavailable"; cached: boolean; fetchedAt: string; license?: string; error?: string };

export const hashKey = (parts: unknown) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

/** Read-through cache for external data. TTL must respect each source's terms
 *  (Google Places content: <= 30 days; public datasets: longer). */
export async function cached<T>(opts: {
  key: string; source: string; ttlDays: number; engagementId?: string | null; license?: string;
  live: (() => Promise<T>) | null; mock: () => T;
}): Promise<Sourced<T>> {
  const [hit] = await sql`select payload, is_mock, fetched_at from data_cache where key = ${opts.key} and expires_at > now()`;
  if (hit) {
    await logApi(opts.source, opts.key, true, hit.is_mock, opts.engagementId);
    return { data: hit.payload as T, source: opts.source, status: hit.is_mock ? "mock" : "live", cached: true, fetchedAt: new Date(hit.fetched_at).toISOString(), license: opts.license };
  }
  let data: T; let isMock = false; let error: string | undefined;
  if (opts.live) {
    try { data = await opts.live(); }
    catch (e) { error = (e as Error).message; data = opts.mock(); isMock = true; }
  } else { data = opts.mock(); isMock = true; }
  // Mock results are cached briefly so that switching on a live key takes effect quickly.
  const ttl = isMock ? 1 : opts.ttlDays;
  await sql`
    insert into data_cache (key, source, payload, is_mock, license_note, expires_at)
    values (${opts.key}, ${opts.source}, ${sql.json(data as never)}, ${isMock}, ${opts.license ?? null}, now() + ${ttl + " days"}::interval)
    on conflict (key) do update set payload = excluded.payload, is_mock = excluded.is_mock, fetched_at = now(), expires_at = excluded.expires_at`;
  await logApi(opts.source, opts.key, false, isMock, opts.engagementId);
  return { data, source: opts.source, status: isMock ? "mock" : "live", cached: false, fetchedAt: new Date().toISOString(), license: opts.license, error };
}

async function logApi(provider: string, endpoint: string, isCached: boolean, isMock: boolean, engagementId?: string | null) {
  const unitCost: Record<string, number> = { google_places: 0.032, google_geocoding: 0.005 };
  const cost = isCached || isMock ? 0 : (unitCost[provider] ?? 0);
  await sql`insert into api_usage (engagement_id, provider, endpoint, cached, is_mock, cost_usd)
            values (${engagementId ?? null}, ${provider}, ${endpoint}, ${isCached}, ${isMock}, ${cost})`;
}

/** Deterministic PRNG seeded from a string, used only by mock adapters so mock output is stable. */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

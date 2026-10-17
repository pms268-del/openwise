// Property-lead source adapters. Only authorized sources are wired:
//  - broker_api: licensed brokerage / listing partner feed (requires partner credentials + data license)
//  - public_record: NYC MapPLUTO lots with ground-floor retail area (off-market LEADS only — no rent/availability)
//  - owner_submission / licensed_broker / manual_research: entered through portals (no adapter needed)
// We never scrape listing websites; a public listing does not grant scraping or reuse rights.
import { env, integrations } from "../env";
import { seeded } from "./cache";

export type Lead = { sourceType: "broker_api" | "public_record" | "mock"; sourceRef: string; address: string; borough?: string; bbl?: string; lat: number; lng: number; sqft: number | null; zoning?: string | null; licenseNote: string; isMock: boolean };
export type SourceStatus = { source: string; status: "live" | "mock" | "not_configured"; count: number; note: string };

export async function discoverLeads(center: { lat: number; lng: number }, radiusM: number): Promise<{ leads: Lead[]; statuses: SourceStatus[] }> {
  const statuses: SourceStatus[] = [];
  const leads: Lead[] = [];

  const brokerUrl = process.env.BROKER_FEED_URL, brokerKey = process.env.BROKER_FEED_API_KEY;
  if (brokerUrl && brokerKey) {
    try {
      const u = new URL(brokerUrl);
      u.searchParams.set("lat", String(center.lat)); u.searchParams.set("lng", String(center.lng)); u.searchParams.set("radius_m", String(radiusM));
      const r = await fetch(u, { headers: { Authorization: `Bearer ${brokerKey}` }, cache: "no-store" });
      const items = (await r.json()) as { id: string; address: string; lat: number; lng: number; sqft?: number }[];
      for (const i of items) leads.push({ sourceType: "broker_api", sourceRef: i.id, address: i.address, lat: i.lat, lng: i.lng, sqft: i.sqft ?? null, licenseNote: "Partner listing feed under data license", isMock: false });
      statuses.push({ source: "Partner broker feed", status: "live", count: items.length, note: "Licensed partner listings" });
    } catch (e) { statuses.push({ source: "Partner broker feed", status: "not_configured", count: 0, note: `Error: ${(e as Error).message}` }); }
  } else statuses.push({ source: "Partner broker feed", status: "not_configured", count: 0, note: "No licensed brokerage API credentials (BROKER_FEED_URL / BROKER_FEED_API_KEY)" });

  if (integrations.nycOpenData()) {
    const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
    const u = new URL("https://data.cityofnewyork.us/resource/64uk-42ks.json");
    u.searchParams.set("$select", "bbl,address,borough,latitude,longitude,retailarea,zonedist1,landuse");
    u.searchParams.set("$where", `latitude between ${center.lat - dLat} and ${center.lat + dLat} and longitude between ${center.lng - dLng} and ${center.lng + dLng} and retailarea > 600 and retailarea < 4000`);
    u.searchParams.set("$limit", "25");
    try {
      const r = await fetch(u, { headers: env.nycOpenDataToken ? { "X-App-Token": env.nycOpenDataToken } : {}, cache: "no-store" });
      const rows = (await r.json()) as { bbl: string; address: string; borough: string; latitude: string; longitude: string; retailarea: string; zonedist1: string }[];
      for (const p of rows) leads.push({ sourceType: "public_record", sourceRef: `BBL ${p.bbl}`, bbl: p.bbl, address: `${p.address}, ${p.borough}`, borough: p.borough, lat: Number(p.latitude), lng: Number(p.longitude), sqft: Math.round(Number(p.retailarea)), zoning: p.zonedist1, licenseNote: "NYC MapPLUTO (public). Lot has retail floor area; availability unknown.", isMock: false });
      statuses.push({ source: "NYC MapPLUTO retail lots", status: "live", count: rows.length, note: "Off-market leads: retail floor area exists; availability must be confirmed via outreach" });
    } catch (e) { statuses.push({ source: "NYC MapPLUTO retail lots", status: "not_configured", count: 0, note: `Error: ${(e as Error).message}` }); }
  } else {
    const rnd = seeded(`leads:${center.lat.toFixed(3)},${center.lng.toFixed(3)}`);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const ang = rnd() * 2 * Math.PI, d = 100 + rnd() * radiusM;
      leads.push({
        sourceType: "mock", sourceRef: `MOCK-PLUTO-${Math.floor(rnd() * 1e6)}`, address: `[MOCK] ${100 + Math.floor(rnd() * 800)} Sample Ave (simulated lead)`,
        lat: center.lat + (d * Math.cos(ang)) / 111320, lng: center.lng + (d * Math.sin(ang)) / (111320 * Math.cos((center.lat * Math.PI) / 180)),
        sqft: Math.round(700 + rnd() * 1500), zoning: null, licenseNote: "SIMULATED lead — live NYC Open Data disabled", isMock: true,
      });
    }
    statuses.push({ source: "NYC MapPLUTO retail lots", status: "mock", count: n, note: "Simulated leads (ENABLE_LIVE_NYC_OPEN_DATA=false)" });
  }
  return { leads, statuses };
}

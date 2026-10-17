// NYC Open Data (Socrata) adapters. Public datasets under NYC Open Data terms of use.
//  - DOHMH Restaurant Inspection Results (43nn-pn8j): permitted Coffee/Tea food-service establishments
//  - MapPLUTO (64uk-42ks): tax-lot land use & commercial/retail floor area (neighborhood character)
import { env, integrations } from "../env";
import { cached, seeded } from "./cache";

export type NeighborhoodLandUse = {
  lots: number; mixedResCommercialPct: number; commercialOfficePct: number; residentialPct: number;
  retailAreaSqft: number; dominantZoning: string[]; isMock: boolean;
};
export type PermittedFoodService = { coffeeTeaEstablishments: number; allFoodEstablishments: number; isMock: boolean };

function bbox(p: { lat: number; lng: number }, radiusM: number) {
  const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return { s: p.lat - dLat, n: p.lat + dLat, w: p.lng - dLng, e: p.lng + dLng };
}

async function soql<T>(dataset: string, params: Record<string, string>): Promise<T> {
  const u = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: env.nycOpenDataToken ? { "X-App-Token": env.nycOpenDataToken } : {}, cache: "no-store" });
  if (!r.ok) throw new Error(`NYC Open Data ${dataset} ${r.status}`);
  return r.json();
}

export async function landUseNear(p: { lat: number; lng: number }, radiusM: number, engagementId?: string) {
  const key = `pluto:${p.lat.toFixed(3)},${p.lng.toFixed(3)}:${radiusM}`;
  return cached<NeighborhoodLandUse>({
    key, source: "nyc_mappluto", ttlDays: 90, engagementId, license: "NYC Department of City Planning MapPLUTO via NYC Open Data.",
    live: integrations.nycOpenData()
      ? async () => {
          const b = bbox(p, radiusM);
          const where = `latitude between ${b.s} and ${b.n} and longitude between ${b.w} and ${b.e}`;
          const byUse = await soql<{ landuse: string; n: string; retail: string }[]>("64uk-42ks", {
            $select: "landuse, count(*) as n, sum(retailarea) as retail", $where: where, $group: "landuse",
          });
          const zones = await soql<{ zonedist1: string; n: string }[]>("64uk-42ks", {
            $select: "zonedist1, count(*) as n", $where: where, $group: "zonedist1", $order: "n desc", $limit: "5",
          });
          const total = byUse.reduce((s, r) => s + Number(r.n), 0) || 1;
          const pct = (codes: string[]) => Math.round((byUse.filter((r) => codes.includes(String(Number(r.landuse)))).reduce((s, r) => s + Number(r.n), 0) / total) * 1000) / 10;
          return {
            lots: total, mixedResCommercialPct: pct(["4"]), commercialOfficePct: pct(["5"]), residentialPct: pct(["1", "2", "3"]),
            retailAreaSqft: Math.round(byUse.reduce((s, r) => s + Number(r.retail ?? 0), 0)), dominantZoning: zones.map((z) => z.zonedist1).filter(Boolean),
            isMock: false,
          };
        }
      : null,
    mock: () => {
      const r = seeded(key);
      const mixed = Math.round((10 + r() * 30) * 10) / 10, com = Math.round((3 + r() * 15) * 10) / 10;
      return { lots: Math.round(300 + r() * 900), mixedResCommercialPct: mixed, commercialOfficePct: com, residentialPct: Math.round((100 - mixed - com - 8) * 10) / 10, retailAreaSqft: Math.round(150000 + r() * 900000), dominantZoning: ["[SIM] R6", "[SIM] C4-3"], isMock: true };
    },
  });
}

export async function permittedFoodService(p: { lat: number; lng: number }, radiusM: number, engagementId?: string) {
  const key = `dohmh:${p.lat.toFixed(3)},${p.lng.toFixed(3)}:${radiusM}`;
  return cached<PermittedFoodService>({
    key, source: "nyc_dohmh_inspections", ttlDays: 30, engagementId, license: "NYC DOHMH Restaurant Inspection Results via NYC Open Data.",
    live: integrations.nycOpenData()
      ? async () => {
          const b = bbox(p, radiusM);
          const where = `latitude between ${b.s} and ${b.n} and longitude between ${b.w} and ${b.e}`;
          const [coffee] = await soql<{ n: string }[]>("43nn-pn8j", { $select: "count(distinct camis) as n", $where: `${where} and cuisine_description='Coffee/Tea'` });
          const [all] = await soql<{ n: string }[]>("43nn-pn8j", { $select: "count(distinct camis) as n", $where: where });
          return { coffeeTeaEstablishments: Number(coffee?.n ?? 0), allFoodEstablishments: Number(all?.n ?? 0), isMock: false };
        }
      : null,
    mock: () => { const r = seeded(key); const c = Math.round(8 + r() * 30); return { coffeeTeaEstablishments: c, allFoodEstablishments: Math.round(c * (5 + r() * 6)), isMock: true }; },
  });
}

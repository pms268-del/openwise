// US Census adapters: Census Geocoder (point -> tract, incl. land area) + ACS 5-year detailed tables.
// Public data, no storage restriction. Enabled with ENABLE_LIVE_CENSUS=true (CENSUS_API_KEY recommended).
import { env, integrations } from "../env";
import { cached, seeded } from "./cache";

export type Demographics = {
  geography: string;            // e.g. "Census Tract 551, Kings County"
  tractGeoid: string | null;
  population: number | null;
  landAreaKm2: number | null;
  populationDensityPerKm2: number | null;
  medianHouseholdIncome: number | null;
  medianAge: number | null;
  bachelorsOrHigherPct: number | null;
  transitCommutePct: number | null;
  medianGrossRent: number | null;
  acsVintage: string;
  isMock: boolean;
};

const VARS = ["NAME", "B01003_001E", "B19013_001E", "B01002_001E", "B15003_001E", "B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E", "B08301_001E", "B08301_010E", "B25064_001E"];
const ACS_YEAR = "2023";
const num = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

export async function demographicsAt(p: { lat: number; lng: number }, engagementId?: string) {
  const key = `acs:${ACS_YEAR}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  return cached<Demographics>({
    key, source: "us_census_acs5", ttlDays: 180, engagementId,
    license: "U.S. Census Bureau ACS 5-year estimates (public domain). Estimates carry margins of error.",
    live: integrations.census()
      ? async () => {
          const g = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
          g.search = new URLSearchParams({ x: String(p.lng), y: String(p.lat), benchmark: "Public_AR_Current", vintage: "Current_Current", layers: "Census Tracts", format: "json" }).toString();
          const gj = await (await fetch(g, { cache: "no-store" })).json();
          const tract = gj.result?.geographies?.["Census Tracts"]?.[0];
          if (!tract) throw new Error("Census geocoder: no tract");
          const a = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5`);
          a.searchParams.set("get", VARS.join(","));
          a.searchParams.set("for", `tract:${tract.TRACT}`);
          a.searchParams.set("in", `state:${tract.STATE} county:${tract.COUNTY}`);
          if (env.censusApiKey) a.searchParams.set("key", env.censusApiKey);
          const rows: string[][] = await (await fetch(a, { cache: "no-store" })).json();
          const r = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
          const pop = num(r.B01003_001E);
          const area = tract.AREALAND ? Number(tract.AREALAND) / 1e6 : null;
          const edu = num(r.B15003_001E);
          const bach = ["B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"].reduce((s, k) => s + (num(r[k]) ?? 0), 0);
          const commute = num(r.B08301_001E);
          return {
            geography: r.NAME, tractGeoid: tract.GEOID, population: pop, landAreaKm2: area,
            populationDensityPerKm2: pop && area ? Math.round(pop / area) : null,
            medianHouseholdIncome: num(r.B19013_001E), medianAge: num(r.B01002_001E),
            bachelorsOrHigherPct: edu ? Math.round((bach / edu) * 1000) / 10 : null,
            transitCommutePct: commute ? Math.round(((num(r.B08301_010E) ?? 0) / commute) * 1000) / 10 : null,
            medianGrossRent: num(r.B25064_001E), acsVintage: `ACS 5-year ${ACS_YEAR}`, isMock: false,
          };
        }
      : null,
    mock: () => {
      const rnd = seeded(key);
      const pop = Math.round(2500 + rnd() * 6000), area = Math.round((0.15 + rnd() * 0.35) * 100) / 100;
      return {
        geography: "[SIMULATED] Census tract near target", tractGeoid: null, population: pop, landAreaKm2: area,
        populationDensityPerKm2: Math.round(pop / area), medianHouseholdIncome: Math.round(45000 + rnd() * 110000),
        medianAge: Math.round((28 + rnd() * 14) * 10) / 10, bachelorsOrHigherPct: Math.round((25 + rnd() * 50) * 10) / 10,
        transitCommutePct: Math.round((40 + rnd() * 35) * 10) / 10, medianGrossRent: Math.round(1400 + rnd() * 2200),
        acsVintage: "SIMULATED (live Census disabled)", isMock: true,
      };
    },
  });
}

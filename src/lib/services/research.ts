import { sql } from "../db";
import { hashKey } from "../integrations/cache";
import { geocode, nearbyCompetitors } from "../integrations/google";
import { demographicsAt } from "../integrations/census";
import { landUseNear, permittedFoodService } from "../integrations/nycOpenData";
import { computeMarketMetrics } from "../market/analysis";
import { industryConfig } from "../industries";
import { marketNarrative } from "../ai/tasks";
import { unsupportedNumbers } from "../ai/client";
import { advanceEngagement } from "./common";

export async function runMarketResearch(engagementId: string) {
  const [e] = await sql`
    select e.id, e.status, bp.id as profile_id, bp.*, st_y(bp.target_location::geometry) as lat, st_x(bp.target_location::geometry) as lng
    from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${engagementId}`;
  if (!e) throw new Error("Engagement not found");
  await advanceEngagement(engagementId, "researching");

  let center = e.lat != null ? { lat: Number(e.lat), lng: Number(e.lng) } : null;
  const geo = center ? null : await geocode(e.target_area, engagementId);
  if (!center) {
    if (!geo?.data) throw new Error(`Could not geocode "${e.target_area}". Try a neighborhood name or street address in NYC.`);
    center = { lat: geo.data.lat, lng: geo.data.lng };
    await sql`update business_profiles set target_location = st_setsrid(st_makepoint(${center.lng}, ${center.lat}), 4326)::geography,
              geocode_source = ${geo.status === "live" ? "google_geocoding" : "approximate_gazetteer"} where id = ${e.profile_id}`;
  }
  const cfg = industryConfig(e.industry_code);
  const radius = Number(e.target_radius_m);
  const [comp, demo, land, food] = await Promise.all([
    nearbyCompetitors(center, radius, cfg.googlePlaceTypes, engagementId),
    demographicsAt(center, engagementId),
    landUseNear(center, radius, engagementId),
    permittedFoodService(center, radius, engagementId),
  ]);
  // Proprietary rent comparables (approved/verified terms) reused across engagements.
  const [bench] = await sql`
    select percentile_cont(0.5) within group (order by coalesce(t.rent_monthly, t.rent_annual / 12)) as median, count(*)::int as n
    from properties p join lateral (
      select * from lease_terms lt where lt.property_id = p.id and lt.status in ('approved','verified') order by lt.created_at desc limit 1) t on true
    where st_dwithin(p.location, st_setsrid(st_makepoint(${center.lng}, ${center.lat}), 4326)::geography, ${radius * 2})
      and coalesce(t.rent_monthly, t.rent_annual) is not null`;
  const rentBenchmark = bench?.median ? { medianMonthlyRent: Math.round(Number(bench.median)), sampleSize: bench.n } : null;

  const metrics = computeMarketMetrics({
    radiusM: radius, competitors: comp.data, demographics: demo.data, landUse: land.data, foodService: food.data,
    maxMonthlyRent: Number(e.max_monthly_rent), rentBenchmark,
  });
  const sources = [
    geo && { source: "Google Geocoding", status: geo.status, cached: geo.cached, fetchedAt: geo.fetchedAt, license: geo.status === "live" ? geo.license : "Approximate built-in neighborhood centroid (Google key not configured)" },
    { source: "Google Places (competitors)", status: comp.status, cached: comp.cached, fetchedAt: comp.fetchedAt, license: comp.license, error: comp.error },
    { source: "US Census ACS 5-year", status: demo.status, cached: demo.cached, fetchedAt: demo.fetchedAt, license: demo.license, error: demo.error },
    { source: "NYC MapPLUTO (land use)", status: land.status, cached: land.cached, fetchedAt: land.fetchedAt, license: land.license, error: land.error },
    { source: "NYC DOHMH inspections (permitted cafés)", status: food.status, cached: food.cached, fetchedAt: food.fetchedAt, license: food.license, error: food.error },
    { source: "SiteIQ verified lease comparables", status: rentBenchmark ? "live" : "unavailable", cached: false, fetchedAt: new Date().toISOString(), license: "Proprietary" },
  ].filter(Boolean) as { source: string; status: string }[];

  const limitations = [
    "Suitability score is a transparent heuristic over the listed indicators — it is not a probability of business success.",
    comp.status === "live" ? "Google Places Nearby Search returns at most 20 results per query; dense areas may have more competitors than shown." : "Competitor data is SIMULATED because Google Maps is not configured.",
    "Census ACS figures are 5-year tract estimates with margins of error and describe residents, not daytime/visitor foot traffic.",
    "No direct foot-traffic counts are used; transit commuting share and competitor review volume are proxies.",
    ...sources.filter((s) => s.status === "mock").map((s) => `${s.source}: SIMULATED data — do not rely on these values.`),
    ...(rentBenchmark ? [] : ["No verified rent comparables in radius yet; rent fit excluded from the score."]),
  ];
  const competitorsCompact = comp.data.slice(0, 40).map((c) => ({ placeId: c.placeId, name: c.name, lat: c.lat, lng: c.lng, rating: c.rating, reviews: c.userRatingCount, distanceM: c.distanceM, isMock: c.isMock }));

  // Compact AI input; identical inputs reuse the previous narrative (no new tokens).
  const aiInput = {
    business: { concept: e.concept, targetArea: e.target_area, targetCustomers: e.target_customers, maxMonthlyRent: Number(e.max_monthly_rent), startupBudget: Number(e.startup_budget) },
    metrics: { ...metrics, demographics: metrics.demographics, components: metrics.components },
    nearestCompetitors: competitorsCompact.slice(0, 8).map(({ name, rating, reviews, distanceM }) => ({ name, rating, reviews, distanceM })),
    dataSources: sources.map((s) => ({ source: s.source, status: s.status })),
    limitations,
  };
  const inputHash = hashKey(aiInput);
  const [prev] = await sql`select version, input_hash, narrative from market_reports where engagement_id = ${engagementId} order by version desc limit 1`;
  let narrative = prev?.input_hash === inputHash ? prev.narrative : null;
  if (!narrative) {
    try {
      const r = await marketNarrative(aiInput, engagementId);
      const flagged = unsupportedNumbers(JSON.stringify(r.data), aiInput);
      narrative = { ...r.data, _meta: { model: r.model, isMock: r.isMock, unsupportedNumbers: flagged } };
    } catch (err) {
      narrative = { _meta: { error: (err as Error).message } };
    }
  }
  const version = (prev?.version ?? 0) + 1;
  await sql`insert into market_reports (org_id, engagement_id, version, input_hash, metrics, competitors, narrative, data_sources, limitations)
            select org_id, id, ${version}, ${inputHash}, ${sql.json(metrics as never)}, ${sql.json(competitorsCompact as never)},
                   ${sql.json(narrative)}, ${sql.json(sources as never)}, ${sql.json(limitations)} from engagements where id = ${engagementId}`;
  await advanceEngagement(engagementId, "free_report_ready");
  return { version, suitability: metrics.suitabilityScore };
}

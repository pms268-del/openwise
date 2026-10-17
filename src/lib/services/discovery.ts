import { sql } from "../db";
import { discoverLeads } from "../integrations/listings";
import { matchProperty } from "../matching";
import { advanceEngagement, latestTerms, monthlyRent } from "./common";

/** Pull leads from authorized sources into the CRM, then match CRM properties near the target. */
export async function discoverProperties(engagementId: string) {
  const [e] = await sql`select e.*, bp.market_code, bp.target_radius_m, bp.max_monthly_rent, bp.min_sqft, bp.max_sqft, bp.required_facilities,
    st_y(bp.target_location::geometry) as lat, st_x(bp.target_location::geometry) as lng
    from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${engagementId}`;
  if (!e || e.lat == null) throw new Error("Run market research first (target location unknown)");
  if (e.tier !== "paid") throw new Error("Property discovery requires an active paid engagement");
  const center = { lat: Number(e.lat), lng: Number(e.lng) };
  const radius = Number(e.target_radius_m);

  const { leads, statuses } = await discoverLeads(center, radius * 1.5);
  let created = 0;
  for (const l of leads) {
    const exists = await sql`select id from properties where source_ref = ${l.sourceRef} and source_type = ${l.sourceType}`;
    if (exists.length) continue;
    await sql`insert into properties (market_code, source_type, source_ref, source_license_note, address, borough, bbl, location, sqft, zoning, is_mock, off_market)
      values (${e.market_code}, ${l.sourceType}, ${l.sourceRef}, ${l.licenseNote}, ${l.address}, ${l.borough ?? null}, ${l.bbl ?? null},
              st_setsrid(st_makepoint(${l.lng}, ${l.lat}), 4326)::geography, ${l.sqft}, ${l.zoning ?? null}, ${l.isMock}, ${l.sourceType !== "broker_api"})`;
    created++;
  }

  // Candidate pool: CRM properties within 2.5× radius that are not dead, incl. owner submissions the owner chose to share.
  const props = await sql`
    select p.*, round(st_distance(p.location, st_setsrid(st_makepoint(${center.lng}, ${center.lat}), 4326)::geography))::int as distance_m
    from properties p
    where p.market_code = ${e.market_code}
      and st_dwithin(p.location, st_setsrid(st_makepoint(${center.lng}, ${center.lat}), 4326)::geography, ${radius * 2.5})
      and p.status not in ('unavailable','rejected')
      and (p.source_type <> 'owner_submission' or coalesce((p.owner_permissions->>'share_with_smes')::boolean, false))
    order by distance_m limit 60`;
  for (const p of props) await scoreCandidate(engagementId, p, e);
  await advanceEngagement(engagementId, "discovery");
  return { leadsCreated: created, candidates: props.length, sources: statuses };
}

export async function scoreCandidate(engagementId: string, p: Record<string, any>, e: Record<string, any>) {
  const terms = (await latestTerms(p.id, ["verified", "approved", "extracted"])) as Record<string, any> | null;
  const trusted = terms && ["approved", "verified"].includes(terms.status) ? terms : null;
  const m = matchProperty({
    distanceM: p.distance_m, radiusM: Number(e.target_radius_m), rentMonthly: monthlyRent(trusted, p.sqft), maxRent: Number(e.max_monthly_rent),
    sqft: p.sqft, minSqft: e.min_sqft, maxSqft: e.max_sqft, facilities: p.facilities ?? {}, requiredFacilities: e.required_facilities ?? [],
    termsStatus: terms?.status ?? null, propertyStatus: p.status,
  });
  await sql`insert into engagement_properties (engagement_id, property_id, match_score, score_breakdown, distance_m)
            values (${engagementId}, ${p.id}, ${m.score}, ${sql.json(m as never)}, ${p.distance_m})
            on conflict (engagement_id, property_id) do update set match_score = excluded.match_score, score_breakdown = excluded.score_breakdown, distance_m = excluded.distance_m`;
}

/** Re-score every engagement that includes this property (after terms approval/verification). */
export async function rescoreProperty(propertyId: string) {
  const rows = await sql`
    select ep.engagement_id, bp.target_radius_m, bp.max_monthly_rent, bp.min_sqft, bp.max_sqft, bp.required_facilities,
      round(st_distance(p.location, bp.target_location))::int as distance_m, p.*
    from engagement_properties ep join engagements e on e.id = ep.engagement_id
    join business_profiles bp on bp.id = e.business_profile_id join properties p on p.id = ep.property_id
    where ep.property_id = ${propertyId}`;
  for (const r of rows) await scoreCandidate(r.engagement_id, { ...r, id: propertyId }, r);
}

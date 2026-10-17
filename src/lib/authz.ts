import { notFound } from "next/navigation";
import { sql } from "./db";
import { STAFF_ROLES, SME_ROLES, type SessionUser } from "./auth/session";

export const isStaff = (u: SessionUser) => STAFF_ROLES.includes(u.role);
export const isSme = (u: SessionUser) => SME_ROLES.includes(u.role);

/** Org isolation: SMEs only reach their own org's engagements; staff reach all;
 *  field agents/brokers only engagements where they hold an assigned inspection. */
export async function loadEngagementFor(u: SessionUser, engagementId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(engagementId)) notFound();
  const rows = await sql`
    select e.*, bp.business_name, bp.industry_code, bp.market_code, bp.concept, bp.target_area,
           bp.target_radius_m, bp.startup_budget, bp.max_monthly_rent, bp.min_sqft, bp.max_sqft,
           bp.required_facilities, bp.opening_timeline, bp.target_customers,
           st_y(bp.target_location::geometry) as lat, st_x(bp.target_location::geometry) as lng
    from engagements e join business_profiles bp on bp.id = e.business_profile_id
    where e.id = ${engagementId}`;
  const e = rows[0];
  if (!e) notFound();
  if (isStaff(u)) return e;
  if (isSme(u) && e.org_id === u.orgId) return e;
  if (u.role === "field_agent" || u.role === "broker") {
    const a = await sql`select 1 from inspections where engagement_id = ${engagementId} and assigned_to = ${u.id} limit 1`;
    if (a.length) return e;
  }
  notFound();
}

export async function assertInspectionAccess(u: SessionUser, inspectionId: string) {
  const [i] = await sql`select * from inspections where id = ${inspectionId}`;
  if (!i) notFound();
  if (isStaff(u) || i.assigned_to === u.id) return i;
  notFound();
}

export async function assertOwnerProperty(u: SessionUser, propertyId: string) {
  const [p] = await sql`select * from properties where id = ${propertyId}`;
  if (!p) notFound();
  if (isStaff(u) || (u.role === "property_owner" && p.owner_org_id === u.orgId)) return p;
  notFound();
}

export class ForbiddenError extends Error {}
export function assertRole(u: SessionUser, roles: string[]) {
  if (!roles.includes(u.role)) throw new ForbiddenError(`Role ${u.role} cannot perform this action`);
}

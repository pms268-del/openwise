import { sql } from "../db";

export const TERM_FIELDS_REQUIRED = [
  "rent", "utilities_monthly", "electricity_monthly", "cam_or_nnn", "security_deposit", "lease_term_months",
  "availability_date", "permitted_uses", "negotiable",
] as const;

export function missingTermFields(t: Record<string, unknown>): string[] {
  const has = (k: string) => t[k] != null && !(Array.isArray(t[k]) && (t[k] as unknown[]).length === 0);
  const out: string[] = [];
  if (!has("rent_monthly") && !has("rent_annual") && !has("rent_psf_annual")) out.push("rent");
  for (const k of ["utilities_monthly", "electricity_monthly", "security_deposit", "lease_term_months", "availability_date", "permitted_uses"]) if (!has(k)) out.push(k);
  if (!has("cam_monthly") && !has("nnn_monthly")) out.push("cam_or_nnn");
  if (!t.negotiable || t.negotiable === "unknown") out.push("negotiable");
  return out;
}

/** Latest lease terms for a property at or above a trust level. */
export async function latestTerms(propertyId: string, statuses: string[] = ["approved", "verified"]) {
  const [t] = await sql`select * from lease_terms where property_id = ${propertyId} and status = any(${statuses})
                        order by (status = 'verified') desc, created_at desc limit 1`;
  return t ?? null;
}

export function monthlyRent(t: { rent_monthly?: number | null; rent_annual?: number | null; rent_psf_annual?: number | null } | null, sqft: number | null) {
  if (!t) return null;
  if (t.rent_monthly != null) return Number(t.rent_monthly);
  if (t.rent_annual != null) return Number(t.rent_annual) / 12;
  if (t.rent_psf_annual != null && sqft) return (Number(t.rent_psf_annual) * sqft) / 12;
  return null;
}

export async function setEngagementStatus(id: string, status: string, onlyFrom?: string[]) {
  if (onlyFrom) await sql`update engagements set status = ${status}, updated_at = now() where id = ${id} and status = any(${onlyFrom})`;
  else await sql`update engagements set status = ${status}, updated_at = now() where id = ${id}`;
}

export const STATUS_ORDER = ["draft", "researching", "free_report_ready", "payment_pending", "active", "discovery", "feasibility", "fieldwork", "final_review", "delivered"];
/** Advance only forward along the workflow. */
export async function advanceEngagement(id: string, status: string) {
  const idx = STATUS_ORDER.indexOf(status);
  await sql`update engagements set status = ${status}, updated_at = now()
            where id = ${id} and array_position(${STATUS_ORDER}::text[], status) < ${idx + 1}`;
}

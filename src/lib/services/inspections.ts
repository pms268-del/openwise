import { sql } from "../db";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { industryConfig } from "../industries";
import { checklistAddenda } from "../ai/tasks";
import { advanceEngagement, latestTerms, missingTermFields } from "./common";
import { enqueue } from "../jobs/queue";
import { rescoreProperty } from "./discovery";

export type ChecklistItem = { id: string; category: string; question: string; type: "bool" | "number" | "text" | "photo"; required: boolean; source: "standard" | "industry" | "ai" };

const STANDARD: Omit<ChecklistItem, "id" | "source">[] = [
  { category: "Availability", question: "Space is vacant/available as represented (confirm with on-site contact)", type: "bool", required: true },
  { category: "Exterior", question: "Photo of storefront and signage area from across the street", type: "photo", required: true },
  { category: "Interior", question: "Interior photos (all walls, ceiling, floor)", type: "photo", required: true },
  { category: "Measurements", question: "Measured usable sq ft", type: "number", required: true },
  { category: "Measurements", question: "Storefront frontage (ft)", type: "number", required: false },
  { category: "Utilities", question: "Photo of electrical panel incl. amperage label", type: "photo", required: true },
  { category: "Condition", question: "Visible damage, water intrusion, pests, or code issues (describe)", type: "text", required: true },
  { category: "Foot traffic", question: "Pedestrians passing storefront in a 10-minute count (note day/time)", type: "number", required: true },
  { category: "Surroundings", question: "Nearby anchors, transit entrances, and competing cafés observed", type: "text", required: false },
];

export async function requestInspection(u: SessionUser, engagementId: string, propertyId: string) {
  const [existing] = await sql`select id from inspections where engagement_id = ${engagementId} and property_id = ${propertyId} and status not in ('rejected','cancelled')`;
  if (existing) return existing.id as string;
  const [e] = await sql`select bp.industry_code, bp.concept, bp.required_facilities from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${engagementId}`;
  const [p] = await sql`select * from properties where id = ${propertyId}`;
  const cfg = industryConfig(e.industry_code);
  const terms = await latestTerms(propertyId, ["approved", "verified", "extracted"]);
  const facilities = (p.facilities ?? {}) as Record<string, boolean | null>;
  let n = 0; const id = () => `c${++n}`;
  const items: ChecklistItem[] = [
    ...STANDARD.map((s) => ({ ...s, id: id(), source: "standard" as const })),
    ...cfg.requiredFacilities.map((f) => ({ id: id(), category: "Facilities", question: `${f.label} — present and working?`, type: "bool" as const, required: f.critical, source: "industry" as const })),
  ];
  const [mr] = await sql`select narrative from market_reports where engagement_id = ${engagementId} order by version desc limit 1`;
  try {
    const add = await checklistAddenda({
      address: p.address, concept: e.concept,
      unknownFacilities: cfg.requiredFacilities.filter((f) => facilities[f.key] == null).map((f) => f.key),
      termsGaps: (terms?.missing_fields as string[]) ?? ["all lease terms"],
      marketRisks: ((mr?.narrative?.risks ?? []) as { description: string }[]).slice(0, 4).map((r) => r.description),
    }, engagementId);
    items.push(...add.data.items.slice(0, 8).map((i) => ({ id: id(), category: i.category, question: i.question, type: i.type, required: i.required, source: "ai" as const })));
  } catch { /* checklist still valid without AI addenda */ }
  const [ins] = await sql`insert into inspections (engagement_id, property_id, checklist, requested_by) values (${engagementId}, ${propertyId}, ${sql.json(items as never)}, ${u.id}) returning id`;
  await sql`update properties set status = 'inspection_pending' where id = ${propertyId} and status in ('lead','contacted','terms_collected')`;
  await advanceEngagement(engagementId, "fieldwork");
  await audit(u, "inspection.request", "inspection", ins.id, { propertyId });
  return ins.id as string;
}

export async function assignInspection(u: SessionUser, inspectionId: string, assigneeId: string, requiresBroker: boolean, scheduledFor: string | null) {
  const [a] = await sql`select role, broker_license_number from users where id = ${assigneeId}`;
  if (!a || !["field_agent", "broker"].includes(a.role)) throw new Error("Assignee must be a field agent or broker");
  if (requiresBroker && (a.role !== "broker" || !a.broker_license_number)) throw new Error("This inspection involves brokerage activity and must be assigned to a licensed broker");
  await sql`update inspections set assigned_to = ${assigneeId}, requires_licensed_broker = ${requiresBroker}, scheduled_for = ${scheduledFor}, status = ${scheduledFor ? "scheduled" : "assigned"} where id = ${inspectionId}`;
  await audit(u, "inspection.assign", "inspection", inspectionId, { assigneeId, requiresBroker });
}

export async function submitInspection(u: SessionUser, inspectionId: string, responses: Record<string, { value: unknown; note?: string }>, termsConfirmed: Record<string, number | string | null> | null) {
  const [i] = await sql`select * from inspections where id = ${inspectionId}`;
  if (i.assigned_to !== u.id) throw new Error("Not assigned to you");
  if (!["assigned", "scheduled", "rejected"].includes(i.status)) throw new Error(`Cannot submit an inspection in status ${i.status}`);
  const missing = (i.checklist as ChecklistItem[]).filter((c) => c.required && c.type !== "photo" && (responses[c.id]?.value === undefined || responses[c.id]?.value === ""));
  if (missing.length) throw new Error(`Required items missing: ${missing.map((m) => m.question).join("; ")}`);
  const photos = (i.checklist as ChecklistItem[]).filter((c) => c.required && c.type === "photo");
  const [{ n }] = await sql`select count(*)::int as n from evidence where inspection_id = ${inspectionId} and kind = 'photo'`;
  if (photos.length && n < 1) throw new Error("Upload at least one photo before submitting");
  await sql`update inspections set responses = ${sql.json(responses as never)}, terms_confirmed = ${termsConfirmed ? sql.json(termsConfirmed as never) : null}, status = 'submitted', submitted_at = now() where id = ${inspectionId}`;
  await audit(u, "inspection.submit", "inspection", inspectionId, {});
}

export async function verifyInspection(u: SessionUser, inspectionId: string, decision: "verified" | "rejected", note: string | null) {
  const [i] = await sql`select * from inspections where id = ${inspectionId}`;
  if (i.status !== "submitted") throw new Error("Only submitted inspections can be reviewed");
  await sql`update inspections set status = ${decision}, verified_by = ${u.id}, verified_at = now(), reviewer_note = ${note} where id = ${inspectionId}`;
  if (decision === "verified") {
    const [eng] = await sql`select bp.industry_code from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${i.engagement_id}`;
    const cfg = industryConfig(eng.industry_code);
    const items = i.checklist as ChecklistItem[];
    const facilities: Record<string, boolean> = {};
    for (const f of cfg.requiredFacilities) {
      const item = items.find((c) => c.question.startsWith(f.label));
      const v = item && i.responses[item.id]?.value;
      if (v === true || v === "true" || v === "yes") facilities[f.key] = true;
      else if (v === false || v === "false" || v === "no") facilities[f.key] = false;
    }
    const sqftItem = items.find((c) => c.question.startsWith("Measured usable sq ft"));
    const measured = sqftItem ? Number(i.responses[sqftItem.id]?.value) : NaN;
    await sql`update properties set facilities = facilities || ${sql.json(facilities)}, sqft = coalesce(${Number.isFinite(measured) && measured > 0 ? measured : null}, sqft), status = 'verified', updated_at = now() where id = ${i.property_id}`;
    if (i.terms_confirmed) {
      const base = (await latestTerms(i.property_id, ["approved", "verified", "extracted"])) ?? {};
      const tc = i.terms_confirmed as Record<string, unknown>;
      const pick = (k: string): any => (tc[k] !== undefined && tc[k] !== null && tc[k] !== "" ? Number(tc[k]) : (base as Record<string, unknown>)[k] ?? null);
      const [lt] = await sql`insert into lease_terms (property_id, source_kind, source_ref, rent_monthly, rent_annual, rent_psf_annual, utilities_monthly, electricity_monthly, cam_monthly, nnn_monthly, re_tax_monthly,
            security_deposit, other_costs, lease_term_months, availability_date, permitted_uses, concessions, free_rent_months, ti_allowance, negotiable, field_evidence, missing_fields, status, extracted_by, verified_by, verified_at)
        values (${i.property_id}, 'inspection', ${inspectionId}, ${pick("rent_monthly")}, ${(base as any).rent_annual ?? null}, ${(base as any).rent_psf_annual ?? null}, ${pick("utilities_monthly")}, ${pick("electricity_monthly")},
            ${pick("cam_monthly")}, ${pick("nnn_monthly")}, ${pick("re_tax_monthly")}, ${pick("security_deposit")}, ${sql.json(((base as any).other_costs ?? []) as never)}, ${pick("lease_term_months")},
            ${(base as any).availability_date ?? null}, ${(base as any).permitted_uses ?? null}, ${(base as any).concessions ?? null}, ${pick("free_rent_months")}, ${pick("ti_allowance")}, ${(base as any).negotiable ?? "unknown"},
            ${sql.json({ _source: `Confirmed on site; inspection ${inspectionId}` })}, ${missingTermFields({ ...(base as any), ...Object.fromEntries(Object.keys(tc).map((k) => [k, pick(k)])) })}, 'verified', ${`human:${i.assigned_to}`}, ${u.id}, now()) returning id`;
      void lt;
    }
    await rescoreProperty(i.property_id);
    // Re-model with the verified terms/measurements.
    await enqueue("run_feasibility", { engagementId: i.engagement_id }, { engagementId: i.engagement_id, dedupeKey: `feas:${i.engagement_id}` });
  }
  await audit(u, `inspection.${decision}`, "inspection", inspectionId, { note });
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { runJobs } from "@/lib/jobs/handlers";
import { drainSoon } from "@/lib/jobs/drain";
import { createOutreachTask, decideApproval, logCall } from "@/lib/services/outreach";
import { assignInspection, verifyInspection } from "@/lib/services/inspections";
import { geocode } from "@/lib/integrations/google";
import { scoreCandidate } from "@/lib/services/discovery";

const staff = () => requireUser(STAFF_ROLES);

export async function runJobsNowAction() { await staff(); await runJobs(10); revalidatePath("/admin"); }

export async function rediscoverAction(engagementId: string) {
  await staff();
  await enqueue("discover_properties", { engagementId }, { engagementId, dedupeKey: `discover:${engagementId}` });
  drainSoon();
  revalidatePath(`/admin/e/${engagementId}`);
}

export async function generateFinalReportAction(engagementId: string) {
  const u = await staff();
  await enqueue("final_report", { engagementId }, { engagementId, dedupeKey: `final:${engagementId}` });
  await audit(u, "final_report.requested", "engagement", engagementId);
  drainSoon();
  revalidatePath(`/admin/e/${engagementId}`);
}

export async function runFeasibilityAction(engagementId: string) {
  await staff();
  await enqueue("run_feasibility", { engagementId }, { engagementId, dedupeKey: `feas:${engagementId}` });
  drainSoon();
  revalidatePath(`/admin/e/${engagementId}`);
}

export async function addToEngagementAction(engagementId: string, fd: FormData) {
  const u = await staff();
  const propertyId = String(fd.get("propertyId"));
  const [row] = await sql`select p.*, bp.target_radius_m, bp.max_monthly_rent, bp.min_sqft, bp.max_sqft, bp.required_facilities,
      round(st_distance(p.location, bp.target_location))::int as distance_m
    from properties p, engagements e join business_profiles bp on bp.id = e.business_profile_id where p.id = ${propertyId} and e.id = ${engagementId}`;
  if (!row) throw new Error("Not found");
  await scoreCandidate(engagementId, row, row);
  await audit(u, "engagement.add_property", "engagement", engagementId, { propertyId });
  revalidatePath(`/admin/e/${engagementId}`);
}

const Prop = z.object({
  address: z.string().min(5), borough: z.string().optional(), sqft: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  sourceType: z.enum(["licensed_broker", "manual_research", "public_record", "broker_api"]), sourceRef: z.string().optional(),
  lat: z.coerce.number().optional().or(z.literal("").transform(() => undefined)), lng: z.coerce.number().optional().or(z.literal("").transform(() => undefined)),
  offMarket: z.string().optional(),
  contactName: z.string().optional(), contactKind: z.enum(["landlord", "owner", "broker", "property_manager", "other"]).optional(),
  contactEmail: z.string().optional(), contactPhone: z.string().optional(), contactCompany: z.string().optional(),
});

export async function createPropertyAction(fd: FormData) {
  const u = await staff();
  const p = Prop.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect(`/admin/properties?error=${encodeURIComponent(p.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "))}`);
  const d = p.data;
  let lat = d.lat, lng = d.lng;
  if (lat == null || lng == null) {
    const g = await geocode(d.address);
    if (!g.data) redirect(`/admin/properties?error=${encodeURIComponent("Could not geocode address; enter lat/lng manually (Google Geocoding not configured).")}`);
    lat = g.data.lat; lng = g.data.lng;
  }
  const facilities: Record<string, boolean> = {};
  for (const f of fd.getAll("facilities").map(String)) facilities[f] = true;
  const [row] = await sql`insert into properties (market_code, source_type, source_ref, address, borough, location, sqft, facilities, off_market, created_by)
    values ('nyc', ${d.sourceType}, ${d.sourceRef ?? null}, ${d.address}, ${d.borough ?? null}, st_setsrid(st_makepoint(${lng!}, ${lat!}), 4326)::geography,
            ${d.sqft ?? null}, ${sql.json(facilities)}, ${d.offMarket === "on"}, ${u.id}) returning id`;
  if (d.contactName) {
    const [c] = await sql`insert into contacts (kind, name, company, email, phone, source) values (${d.contactKind ?? "landlord"}, ${d.contactName}, ${d.contactCompany ?? null}, ${d.contactEmail || null}, ${d.contactPhone || null}, ${d.sourceType}) returning id`;
    await sql`insert into property_contacts (property_id, contact_id, relationship) values (${row.id}, ${c.id}, ${d.contactKind ?? "landlord"})`;
  }
  await audit(u, "property.create", "property", row.id, { sourceType: d.sourceType });
  redirect(`/admin/properties/${row.id}`);
}

export async function addContactAction(propertyId: string, fd: FormData) {
  const u = await staff();
  const g = (k: string) => (fd.get(k) ? String(fd.get(k)) : null);
  const consentAi = fd.get("consentAi") === "on";
  const [c] = await sql`insert into contacts (kind, name, company, email, phone, license_number, license_state, consent_ai_voice, consent_recorded_at, consent_method, do_not_contact, source, notes)
    values (${g("kind") ?? "landlord"}, ${g("name") ?? "Unknown"}, ${g("company")}, ${g("email")}, ${g("phone")}, ${g("license")}, ${g("license") ? "NY" : null},
            ${consentAi}, ${consentAi ? new Date() : null}, ${consentAi ? g("consentMethod") ?? "documented" : null}, ${fd.get("dnc") === "on"}, 'staff', ${g("notes")}) returning id`;
  await sql`insert into property_contacts (property_id, contact_id, relationship) values (${propertyId}, ${c.id}, ${g("kind") ?? "landlord"})`;
  await audit(u, "contact.create", "contact", c.id, { propertyId, consentAi });
  revalidatePath(`/admin/properties/${propertyId}`);
}

export async function createOutreachAction(propertyId: string, fd: FormData) {
  const u = await staff();
  const contactId = fd.get("contactId") ? String(fd.get("contactId")) : null;
  const engagementId = fd.get("engagementId") ? String(fd.get("engagementId")) : null;
  await createOutreachTask(u, { propertyId, contactId, channel: String(fd.get("channel")) as never, engagementId });
  revalidatePath(`/admin/properties/${propertyId}`);
}

export async function markOutreachSentAction(taskId: string) {
  const u = await staff();
  const [t] = await sql`update outreach_tasks set status = 'in_progress', outcome = 'sent by human from own mailbox', updated_at = now() where id = ${taskId} and status = 'approved' and channel = 'email' returning property_id`;
  if (t) await audit(u, "outreach.sent", "outreach_task", taskId);
  revalidatePath("/admin/outreach");
}

export async function logCallAction(propertyId: string, fd: FormData) {
  const u = await staff();
  const transcript = String(fd.get("transcript") ?? "").trim();
  if (transcript.length < 20) redirect(`/admin/properties/${propertyId}?error=Transcript+or+notes+too+short`);
  await logCall(u, {
    taskId: fd.get("taskId") ? String(fd.get("taskId")) : null, propertyId, contactId: fd.get("contactId") ? String(fd.get("contactId")) : null,
    transcript, recordingConsent: fd.get("recordingConsent") === "on", source: fd.get("source") === "uploaded_transcript" ? "uploaded_transcript" : "manual_notes",
  });
  drainSoon();
  revalidatePath(`/admin/properties/${propertyId}`);
}

export async function decideApprovalAction(approvalId: string, decision: "approved" | "rejected", fd: FormData) {
  const u = await staff();
  const edits: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("edit_")) edits[k.slice(5)] = v;
  const a = await decideApproval(u, approvalId, decision, fd.get("reason") ? String(fd.get("reason")) : undefined, edits);
  if (a.kind === "lease_terms" && decision === "approved") {
    // Re-model every engagement that has this property shortlisted.
    const engs = await sql`select ep.engagement_id from engagement_properties ep join lease_terms lt on lt.property_id = ep.property_id where lt.id = ${a.ref_id} and ep.status = 'shortlisted'`;
    for (const e of engs) await enqueue("run_feasibility", { engagementId: e.engagement_id }, { engagementId: e.engagement_id, dedupeKey: `feas:${e.engagement_id}` });
    drainSoon();
  }
  revalidatePath("/admin/approvals");
}

export async function assignInspectionAction(inspectionId: string, fd: FormData) {
  const u = await staff();
  try {
    await assignInspection(u, inspectionId, String(fd.get("assignee")), fd.get("requiresBroker") === "on", fd.get("scheduledFor") ? new Date(String(fd.get("scheduledFor"))).toISOString() : null);
  } catch (e) { redirect(`/admin/inspections?error=${encodeURIComponent((e as Error).message)}`); }
  revalidatePath("/admin/inspections");
}

export async function reviewInspectionAction(inspectionId: string, decision: "verified" | "rejected", fd: FormData) {
  const u = await staff();
  await verifyInspection(u, inspectionId, decision, fd.get("note") ? String(fd.get("note")) : null);
  drainSoon();
  revalidatePath(`/admin/inspections/${inspectionId}`);
}

export async function brokerHandoffAction(engagementId: string, propertyId: string, fd: FormData) {
  const u = await staff();
  const [a] = await sql`insert into approvals (kind, ref_table, ref_id, engagement_id, payload, requested_by)
    values ('brokerage_handoff', 'properties', ${propertyId}, ${engagementId}, ${sql.json({ brokerContactId: String(fd.get("brokerContactId")), note: String(fd.get("note") ?? "") })}, ${u.id}) returning id`;
  await audit(u, "brokerage_handoff.requested", "property", propertyId, { engagementId, approvalId: a.id });
  revalidatePath(`/admin/e/${engagementId}`);
}

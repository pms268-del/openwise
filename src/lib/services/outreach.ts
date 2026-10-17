import { sql } from "../db";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { complianceCheck, type Channel } from "../outreach/compliance";
import { draftOutreach, extractLeaseTerms } from "../ai/tasks";
import { enqueue } from "../jobs/queue";
import { latestTerms, missingTermFields } from "./common";
import { rescoreProperty } from "./discovery";

export async function createOutreachTask(u: SessionUser, args: { propertyId: string; contactId: string | null; channel: Channel; engagementId: string | null }) {
  const [p] = await sql`select * from properties where id = ${args.propertyId}`;
  const [c] = args.contactId ? await sql`select * from contacts where id = ${args.contactId}` : [null];
  const check = complianceCheck(args.channel, c as never);
  const terms = await latestTerms(args.propertyId, ["verified", "approved", "extracted"]);
  const missing = terms ? missingTermFields(terms) : ["rent", "utilities_monthly", "electricity_monthly", "cam_or_nnn", "security_deposit", "lease_term_months", "availability_date", "permitted_uses", "negotiable"];
  let concept = "café";
  if (args.engagementId) { const [bp] = await sql`select bp.concept from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${args.engagementId}`; concept = bp?.concept ?? concept; }
  const draft = await draftOutreach({ propertyAddress: p.address, contactName: c?.name ?? "there", contactKind: c?.kind ?? "landlord", businessConcept: concept, missingFields: missing, channel: args.channel }, args.engagementId);
  const status = !check.allowed ? "blocked" : check.requiresApproval ? "pending_approval" : "approved";
  const [t] = await sql`insert into outreach_tasks (engagement_id, property_id, contact_id, channel, status, ai_draft, compliance, assigned_to, created_by)
    values (${args.engagementId}, ${args.propertyId}, ${args.contactId}, ${args.channel}, ${status}, ${sql.json({ ...draft.data, _meta: { model: draft.model, isMock: draft.isMock } } as never)},
            ${sql.json(check as never)}, ${u.id}, ${u.id}) returning id`;
  if (status === "pending_approval")
    await sql`insert into approvals (kind, ref_table, ref_id, engagement_id, payload, requested_by)
              values (${args.channel === "phone_ai_voice" ? "ai_voice_call" : "outreach_message"}, 'outreach_tasks', ${t.id}, ${args.engagementId}, ${sql.json({ channel: args.channel, address: p.address })}, ${u.id})`;
  await audit(u, "outreach.create", "outreach_task", t.id, { channel: args.channel, status, compliance: check });
  return t.id as string;
}

export async function logCall(u: SessionUser, args: { taskId: string | null; propertyId: string; contactId: string | null; transcript: string; recordingConsent: boolean; source: "manual_notes" | "uploaded_transcript"; durationS?: number | null }) {
  if (args.taskId) {
    const [t] = await sql`select channel, status from outreach_tasks where id = ${args.taskId}`;
    if (t?.channel === "phone_ai_voice") throw new Error("AI voice calls cannot be logged as completed while AI voice calling is disabled");
    if (t && !["approved", "in_progress"].includes(t.status)) throw new Error(`Outreach task is ${t.status}; it must be approved before contact`);
  }
  const [c] = await sql`insert into call_records (outreach_task_id, property_id, contact_id, initiated_by, caller_user_id, recording_consent, consent_note, transcript, transcript_source, duration_s, extraction_status)
    values (${args.taskId}, ${args.propertyId}, ${args.contactId}, 'human', ${u.id}, ${args.recordingConsent}, ${args.recordingConsent ? "Verbal consent to record obtained at start of call" : "Not recorded; notes taken by caller"},
            ${args.transcript}, ${args.source}, ${args.durationS ?? null}, 'queued') returning id`;
  if (args.taskId) await sql`update outreach_tasks set status = 'completed', outcome = 'call logged', updated_at = now() where id = ${args.taskId}`;
  await sql`update properties set status = 'contacted', updated_at = now() where id = ${args.propertyId} and status = 'lead'`;
  const [eng] = args.taskId ? await sql`select engagement_id from outreach_tasks where id = ${args.taskId}` : [null];
  await enqueue("extract_call", { callId: c.id }, { dedupeKey: `extract:${c.id}`, engagementId: eng?.engagement_id ?? undefined });
  await audit(u, "call.logged", "call_record", c.id, { propertyId: args.propertyId });
  return c.id as string;
}

export async function processCallExtraction(callId: string) {
  const [c] = await sql`select cr.*, p.address, ot.engagement_id from call_records cr join properties p on p.id = cr.property_id
                        left join outreach_tasks ot on ot.id = cr.outreach_task_id where cr.id = ${callId}`;
  if (!c) throw new Error("Call not found");
  const r = await extractLeaseTerms(c.transcript ?? "", { address: c.address }, c.engagement_id);
  const x = r.data;
  // Only keep evidence quotes that actually occur in the transcript (guards against fabricated quotes).
  const transcript = (c.transcript ?? "").toLowerCase().replace(/\s+/g, " ");
  const fieldEvidence: Record<string, { quote: string; source_ref: string; verified_in_source: boolean }> = {};
  for (const ev of x.evidence) fieldEvidence[ev.field] = { quote: ev.quote, source_ref: `call_records:${callId}`, verified_in_source: transcript.includes(ev.quote.toLowerCase().replace(/\s+/g, " ").slice(0, 60)) };
  const row = { ...x, availability_date: x.availability_date && !isNaN(+new Date(x.availability_date)) ? x.availability_date : null };
  const missing = missingTermFields(row as never);
  const [t] = await sql`insert into lease_terms (property_id, source_kind, source_ref, rent_monthly, rent_annual, rent_psf_annual, utilities_monthly, electricity_monthly,
      cam_monthly, nnn_monthly, re_tax_monthly, security_deposit, other_costs, lease_term_months, availability_date, permitted_uses, concessions, free_rent_months,
      ti_allowance, negotiable, field_evidence, missing_fields, status, extracted_by)
    values (${c.property_id}, 'call_transcript', ${callId}, ${row.rent_monthly}, ${row.rent_annual}, ${row.rent_psf_annual}, ${row.utilities_monthly}, ${row.electricity_monthly},
      ${row.cam_monthly}, ${row.nnn_monthly}, ${row.re_tax_monthly}, ${row.security_deposit}, ${sql.json(row.other_costs as never)}, ${row.lease_term_months}, ${row.availability_date},
      ${row.permitted_uses}, ${row.concessions}, ${row.free_rent_months}, ${row.ti_allowance}, ${row.negotiable},
      ${sql.json({ ...fieldEvidence, _ambiguities: x.ambiguities } as never)}, ${missing}, 'extracted', ${r.isMock ? "rules:fallback" : `ai:${r.model}`}) returning id`;
  await sql`insert into approvals (kind, ref_table, ref_id, engagement_id, payload) values ('lease_terms', 'lease_terms', ${t.id}, ${c.engagement_id}, ${sql.json({ address: c.address, missing })})`;
  await sql`update call_records set extraction_status = 'done' where id = ${callId}`;
  await sql`update properties set status = 'terms_collected', updated_at = now() where id = ${c.property_id} and status in ('lead','contacted')`;
  return { leaseTermsId: t.id, missing };
}

export async function decideApproval(u: SessionUser, approvalId: string, decision: "approved" | "rejected", reason?: string, edits?: Record<string, unknown>) {
  const [a] = await sql`update approvals set status = ${decision}, decided_by = ${u.id}, decided_at = now(), reason = ${reason ?? null}
                        where id = ${approvalId} and status = 'pending' returning *`;
  if (!a) throw new Error("Approval not found or already decided");
  if (a.kind === "lease_terms") {
    if (edits && Object.keys(edits).length) {
      const allowed = ["rent_monthly", "utilities_monthly", "electricity_monthly", "cam_monthly", "nnn_monthly", "re_tax_monthly", "security_deposit", "lease_term_months", "free_rent_months", "ti_allowance"];
      for (const [k, v] of Object.entries(edits)) if (allowed.includes(k)) await sql`update lease_terms set ${sql({ [k]: v === "" || v == null ? null : Number(v) })} where id = ${a.ref_id}`;
      const [lt] = await sql`select * from lease_terms where id = ${a.ref_id}`;
      await sql`update lease_terms set missing_fields = ${missingTermFields(lt)} where id = ${a.ref_id}`;
    }
    await sql`update lease_terms set status = ${decision === "approved" ? "approved" : "rejected"}, approved_by = ${u.id}, approved_at = now() where id = ${a.ref_id}`;
    const [lt] = await sql`select property_id from lease_terms where id = ${a.ref_id}`;
    await rescoreProperty(lt.property_id);
  } else if (a.kind === "outreach_message" || a.kind === "ai_voice_call") {
    await sql`update outreach_tasks set status = ${decision === "approved" ? "approved" : "cancelled"}, approved_by = ${u.id}, updated_at = now() where id = ${a.ref_id}`;
  } else if (a.kind === "final_report") {
    await sql`update final_reports set status = ${decision === "approved" ? "approved" : "draft"}, approved_by = ${u.id}, approved_at = now() where id = ${a.ref_id}`;
    if (decision === "approved") { const [fr] = await sql`select engagement_id from final_reports where id = ${a.ref_id}`; await sql`update engagements set status = 'delivered', updated_at = now() where id = ${fr.engagement_id}`; await sql`update final_reports set status = 'delivered' where id = ${a.ref_id}`; }
  }
  await audit(u, `approval.${decision}`, a.ref_table, a.ref_id, { kind: a.kind, reason, edits });
  return a;
}

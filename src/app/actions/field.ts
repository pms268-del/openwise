"use server";
import { redirect } from "next/navigation";
import { requireUser, FIELD_ROLES } from "@/lib/auth/session";
import { assertInspectionAccess } from "@/lib/authz";
import { submitInspection, type ChecklistItem } from "@/lib/services/inspections";

const TERM_KEYS = ["rent_monthly", "cam_monthly", "nnn_monthly", "utilities_monthly", "electricity_monthly", "security_deposit", "lease_term_months", "free_rent_months"];

export async function submitInspectionAction(inspectionId: string, fd: FormData) {
  const u = await requireUser(FIELD_ROLES);
  const i = await assertInspectionAccess(u, inspectionId);
  const responses: Record<string, { value: unknown; note?: string }> = {};
  for (const c of i.checklist as ChecklistItem[]) {
    const v = fd.get(`r_${c.id}`), note = fd.get(`n_${c.id}`);
    if (c.type === "photo") { responses[c.id] = { value: "see evidence", note: note ? String(note) : undefined }; continue; }
    if (v === null || v === "") continue;
    responses[c.id] = { value: c.type === "number" ? Number(v) : c.type === "bool" ? v === "yes" ? true : v === "no" ? false : "unknown" : String(v), note: note ? String(note) : undefined };
  }
  const terms: Record<string, number | null> = {};
  for (const k of TERM_KEYS) { const v = fd.get(`t_${k}`); if (v !== null && v !== "") terms[k] = Number(v); }
  try { await submitInspection(u, inspectionId, responses, Object.keys(terms).length ? terms : null); }
  catch (e) { redirect(`/field/i/${inspectionId}?error=${encodeURIComponent((e as Error).message)}`); }
  redirect(`/field?submitted=1`);
}

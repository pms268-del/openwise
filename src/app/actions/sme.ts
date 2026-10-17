"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireUser, SME_ROLES, STAFF_ROLES } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { drainSoon } from "@/lib/jobs/drain";
import { activatePayment, startCheckout } from "@/lib/services/payments";
import { requestInspection } from "@/lib/services/inspections";

const Onboard = z.object({
  businessName: z.string().min(2), concept: z.string().min(5), targetArea: z.string().min(2),
  radius: z.coerce.number().int().min(200).max(3000), targetCustomers: z.string().optional(),
  startupBudget: z.coerce.number().positive(), maxMonthlyRent: z.coerce.number().positive(),
  minSqft: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  maxSqft: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  openingTimeline: z.string().optional(),
});

export async function createResearchAction(fd: FormData) {
  const u = await requireUser(["sme_owner"]);
  const parsed = Onboard.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirect(`/app/new?error=${encodeURIComponent(parsed.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "))}`);
  const d = parsed.data;
  const facilities = fd.getAll("facilities").map(String);
  const engagementId = await sql.begin(async (tx) => {
    const [bp] = await tx`insert into business_profiles (org_id, industry_code, market_code, business_name, concept, target_area, target_radius_m, target_customers,
        startup_budget, max_monthly_rent, min_sqft, max_sqft, required_facilities, opening_timeline, created_by)
      values (${u.orgId}, 'coffee_shop', 'nyc', ${d.businessName}, ${d.concept}, ${d.targetArea}, ${d.radius}, ${d.targetCustomers ?? null},
        ${d.startupBudget}, ${d.maxMonthlyRent}, ${d.minSqft ?? null}, ${d.maxSqft ?? null}, ${facilities}, ${d.openingTimeline ?? null}, ${u.id}) returning id`;
    const [e] = await tx`insert into engagements (org_id, business_profile_id, status) values (${u.orgId}, ${bp.id}, 'researching') returning id`;
    return e.id as string;
  });
  await enqueue("market_research", { engagementId }, { engagementId, dedupeKey: `research:${engagementId}` });
  await audit(u, "engagement.create", "engagement", engagementId, { targetArea: d.targetArea });
  drainSoon();
  redirect(`/app/e/${engagementId}`);
}

export async function rerunResearchAction(engagementId: string) {
  const u = await requireUser([...SME_ROLES, ...STAFF_ROLES]);
  await loadEngagementFor(u, engagementId);
  await enqueue("market_research", { engagementId }, { engagementId, dedupeKey: `research:${engagementId}` });
  drainSoon();
  revalidatePath(`/app/e/${engagementId}`);
}

export async function checkoutAction(engagementId: string) {
  const u = await requireUser(["sme_owner"]);
  const e = await loadEngagementFor(u, engagementId);
  if (e.tier === "paid") redirect(`/app/e/${engagementId}/properties`);
  redirect(await startCheckout(u, engagementId));
}

/** Simulated checkout used only when Stripe is not configured. */
export async function completeMockPaymentAction(engagementId: string, paymentId: string) {
  const u = await requireUser(["sme_owner"]);
  await loadEngagementFor(u, engagementId);
  const [p] = await sql`select * from payments where id = ${paymentId} and engagement_id = ${engagementId} and provider = 'mock'`;
  if (!p) throw new Error("Payment not found");
  await activatePayment(p.provider_session_id, null);
  drainSoon();
  redirect(`/app/e/${engagementId}/properties?paid=1`);
}

export async function setShortlistAction(engagementId: string, propertyId: string, status: "shortlisted" | "candidate" | "rejected") {
  const u = await requireUser([...SME_ROLES, ...STAFF_ROLES]);
  const e = await loadEngagementFor(u, engagementId);
  if (e.tier !== "paid") throw new Error("Paid engagement required");
  await sql`update engagement_properties set status = ${status} where engagement_id = ${engagementId} and property_id = ${propertyId}`;
  await audit(u, `property.${status}`, "engagement", engagementId, { propertyId });
  if (status === "shortlisted") { await enqueue("run_feasibility", { engagementId, propertyId }, { engagementId }); drainSoon(); }
  revalidatePath(`/app/e/${engagementId}/properties`);
}

export async function requestInspectionAction(engagementId: string, propertyId: string) {
  const u = await requireUser([...SME_ROLES, ...STAFF_ROLES]);
  const e = await loadEngagementFor(u, engagementId);
  if (e.tier !== "paid") throw new Error("Paid engagement required");
  await requestInspection(u, engagementId, propertyId);
  revalidatePath(`/app/e/${engagementId}/properties`);
}

const OVERRIDABLE = ["avgTicket", "dailyTransactionsBase", "laborMonthly", "cogsPct", "marketingMonthly", "equipment"];
export async function rerunModelAction(engagementId: string, propertyId: string, fd: FormData) {
  const u = await requireUser([...SME_ROLES, ...STAFF_ROLES]);
  await loadEngagementFor(u, engagementId);
  const overrides: Record<string, number> = {};
  for (const k of OVERRIDABLE) { const v = fd.get(k); if (v !== null && v !== "" && Number.isFinite(Number(v))) overrides[k] = Number(v); }
  const { runFeasibility } = await import("@/lib/services/feasibility");
  await runFeasibility(engagementId, { propertyId, overrides, userId: u.id });
  await audit(u, "model.rerun", "engagement", engagementId, { propertyId, overrides });
  revalidatePath(`/app/e/${engagementId}/financials`);
}

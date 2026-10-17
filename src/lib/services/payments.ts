import Stripe from "stripe";
import { sql } from "../db";
import { env, integrations } from "../env";
import { enqueue } from "../jobs/queue";
import { audit } from "../audit";
import type { SessionUser } from "../auth/session";

export const stripe = () => new Stripe(env.stripeSecret);

export async function startCheckout(u: SessionUser, engagementId: string): Promise<string> {
  const amount = env.paidResearchPriceCents;
  if (integrations.stripe()) {
    const s = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price_data: { currency: "usd", unit_amount: amount, product_data: { name: "SiteIQ paid location research", description: "Property discovery, outreach, feasibility modeling, field verification and final decision report" } }, quantity: 1 }],
      customer_email: u.email,
      client_reference_id: engagementId,
      metadata: { engagementId, orgId: u.orgId },
      success_url: `${env.appUrl}/app/e/${engagementId}?paid=1`,
      cancel_url: `${env.appUrl}/app/e/${engagementId}?canceled=1`,
    });
    await sql`insert into payments (org_id, engagement_id, provider, provider_session_id, amount_cents, status) values (${u.orgId}, ${engagementId}, 'stripe', ${s.id}, ${amount}, 'pending')`;
    await sql`update engagements set status = 'payment_pending', updated_at = now() where id = ${engagementId} and status = 'free_report_ready'`;
    await audit(u, "payment.checkout_started", "engagement", engagementId, { provider: "stripe" });
    return s.url!;
  }
  const [p] = await sql`insert into payments (org_id, engagement_id, provider, provider_session_id, amount_cents, status)
                        values (${u.orgId}, ${engagementId}, 'mock', ${"mock_" + crypto.randomUUID()}, ${amount}, 'pending') returning id`;
  await sql`update engagements set status = 'payment_pending', updated_at = now() where id = ${engagementId} and status = 'free_report_ready'`;
  return `/app/e/${engagementId}/checkout?payment=${p.id}`;
}

/** Idempotent: marks payment paid, upgrades the engagement and triggers the paid workflow. */
export async function activatePayment(providerSessionId: string, paymentIntent: string | null) {
  const [p] = await sql`update payments set status = 'paid', provider_payment_intent = ${paymentIntent}, updated_at = now()
                        where provider_session_id = ${providerSessionId} and status <> 'paid' returning *`;
  if (!p) return false;
  await sql`update engagements set tier = 'paid', paid_at = now(), status = 'active', updated_at = now() where id = ${p.engagement_id}`;
  await enqueue("discover_properties", { engagementId: p.engagement_id }, { engagementId: p.engagement_id, dedupeKey: `discover:${p.engagement_id}` });
  await audit(null, "payment.paid", "engagement", p.engagement_id, { provider: p.provider, amount_cents: p.amount_cents });
  return true;
}

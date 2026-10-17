import { NextResponse } from "next/server";
import { env, integrations } from "@/lib/env";
import { sql } from "@/lib/db";
import { activatePayment, stripe } from "@/lib/services/payments";
import { drainSoon } from "@/lib/jobs/drain";

export async function POST(req: Request) {
  if (!integrations.stripe() || !env.stripeWebhookSecret) return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
  const body = await req.text();
  let event;
  try { event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", env.stripeWebhookSecret); }
  catch { return NextResponse.json({ error: "Invalid signature" }, { status: 400 }); }
  const fresh = await sql`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict do nothing returning id`;
  if (!fresh.length) return NextResponse.json({ received: true, duplicate: true });
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    if (s.payment_status === "paid") await activatePayment(s.id, typeof s.payment_intent === "string" ? s.payment_intent : null);
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await sql`update payments set status = ${event.type.endsWith("expired") ? "expired" : "failed"}, updated_at = now() where provider_session_id = ${event.data.object.id}`;
  }
  drainSoon();
  return NextResponse.json({ received: true });
}

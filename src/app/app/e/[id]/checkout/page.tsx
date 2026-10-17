import { requireUser } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { sql } from "@/lib/db";
import { completeMockPaymentAction } from "@/app/actions/sme";
import { Notice, usd } from "@/components/ui";
import { notFound } from "next/navigation";

export default async function MockCheckout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { id } = await params; const { payment } = await searchParams;
  const u = await requireUser(["sme_owner"]);
  await loadEngagementFor(u, id);
  const [p] = payment ? await sql`select * from payments where id = ${payment} and engagement_id = ${id} and provider = 'mock'` : [];
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-md space-y-3">
      <Notice><b>Simulated checkout.</b> Stripe is not configured in this environment (STRIPE_SECRET_KEY missing), so no real payment is taken. In production this step is Stripe Checkout and activation happens via the verified webhook.</Notice>
      <div className="card space-y-3">
        <div className="h2">SiteIQ paid location research</div>
        <div className="text-3xl font-semibold">{usd(p.amount_cents / 100)}</div>
        <form action={completeMockPaymentAction.bind(null, id, p.id)}><button className="btn w-full">Simulate successful payment</button></form>
      </div>
    </div>
  );
}

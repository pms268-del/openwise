import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, homeFor } from "@/lib/auth/session";
import { integrationStatus } from "@/lib/env";
import { Badge } from "@/components/ui";

export default async function Home() {
  const u = await getUser();
  if (u) redirect(homeFor(u.role));
  const st = integrationStatus();
  const steps = [
    ["1. Free market research", "Competitors, demographics, land use and a transparent suitability score for your target area."],
    ["2. Paid property discovery", "Authorized listings, public-record leads, owner submissions, and human-led landlord outreach."],
    ["3. Financial feasibility", "Deterministic revenue, cost, break-even and cash-need scenarios for each shortlisted space."],
    ["4. Field verification", "Agents and licensed brokers inspect spaces and confirm terms with photos and documents."],
    ["5. Decision report", "An evidence-backed recommendation: proceed, negotiate, change location, revise, or reject."],
  ];
  return (
    <div className="space-y-8 py-6">
      <section className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Find the right location before you sign the lease.</h1>
        <p className="max-w-2xl text-stone-600">SiteIQ combines market intelligence, verified commercial property access (including off-market), financial feasibility and on-site inspections — starting with coffee shops in New York City.</p>
        <div className="flex gap-3"><Link href="/register" className="btn">Start free research</Link><Link href="/register?role=owner" className="btn-secondary">I own a commercial space</Link></div>
      </section>
      <section className="grid gap-3 md:grid-cols-5">
        {steps.map(([t, d]) => <div key={t} className="card"><div className="font-semibold">{t}</div><p className="mt-1 text-sm text-stone-600">{d}</p></div>)}
      </section>
      <section className="card">
        <div className="h2 mb-2">Integration status (this deployment)</div>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(st).map(([k, v]) => <span key={k} className="flex items-center gap-1">{k}: <Badge tone={v === "live" || v === "supabase" ? "green" : v === "disabled" ? "stone" : "amber"}>{v}</Badge></span>)}
        </div>
        <p className="muted mt-2">Integrations without credentials run on clearly labeled simulated data. AI voice calling is disabled by default.</p>
      </section>
    </div>
  );
}

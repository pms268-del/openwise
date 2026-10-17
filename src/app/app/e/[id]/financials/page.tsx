import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { latestModels, rankModels } from "@/lib/services/feasibility";
import { rerunModelAction } from "@/app/actions/sme";
import { COMPOSITE_WEIGHTS } from "@/lib/matching";
import type { Assumption, ModelResult } from "@/lib/finance/model";
import { CashChart } from "@/components/CashChart";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Empty, Notice, usd } from "@/components/ui";
import { sql } from "@/lib/db";

const LABELS: Record<string, string> = {
  avgTicket: "Average ticket", dailyTransactionsBase: "Daily transactions (base)", cogsPct: "COGS % of revenue", laborMonthly: "Labor / month",
  rentMonthly: "Rent / month", camMonthly: "CAM / month", nnnMonthly: "NNN / month", reTaxMonthly: "RE tax / month", utilitiesMonthly: "Utilities / month",
  electricityMonthly: "Electricity / month", buildout: "Build-out", equipment: "Equipment", securityDeposit: "Security deposit", tiAllowance: "TI allowance",
  freeRentMonths: "Free rent (months)", plumbingRetrofit: "Plumbing retrofit", marketingMonthly: "Marketing / month",
};
const SRC_TONE: Record<string, "green" | "blue" | "stone" | "amber" | "violet"> = { verified_inspection: "green", lease_terms: "blue", industry_default: "stone", estimated: "amber", user_override: "violet", market_adjusted: "blue" };

export default async function Financials({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  const e = await loadEngagementFor(u, id);
  if (e.tier !== "paid") redirect(`/app/e/${id}`);
  const models = (await latestModels(id)) as unknown as { property_id: string; address: string; is_mock: boolean; match_score: number; terms_status: string; version: number; results: ModelResult; assumptions: Record<string, Assumption & { factor?: number; explanation?: string }>; created_at: Date }[];
  const pendingJobs = await sql`select 1 from jobs where engagement_id = ${id} and type = 'run_feasibility' and status in ('queued','running')`;
  const [{ n: shortlisted }] = await sql`select count(*)::int as n from engagement_properties where engagement_id = ${id} and status = 'shortlisted'`;
  if (!models.length) return <div className="space-y-3">{pendingJobs.length > 0 && <AutoRefresh />}<Empty>{shortlisted ? "Shortlisted properties need approved lease terms before they can be modeled. Models appear here automatically once terms are approved." : "Shortlist properties on the Properties tab to model their financial feasibility."}</Empty></div>;
  const ranking = rankModels(models);
  return (
    <div className="space-y-4">
      {pendingJobs.length > 0 && <AutoRefresh />}
      <Notice tone="blue">All figures are computed by a deterministic model (no AI arithmetic) from the assumptions shown with their source. They are projections, not forecasts. Override any assumption to test your own numbers.</Notice>
      <div className="card overflow-x-auto">
        <div className="h2 mb-2">Ranking</div>
        <table className="table"><thead><tr><th>#</th><th>Property</th><th>Composite</th><th>Match</th><th>Margin score</th><th>Budget fit</th><th>Break-even safety</th><th>Terms</th></tr></thead>
          <tbody>{ranking.map((r) => { const m = models.find((x) => x.property_id === r.propertyId)!; return (
            <tr key={r.propertyId}><td>{r.rank}</td><td>{m.address} {m.is_mock && <Badge tone="amber">simulated</Badge>}</td><td className="font-semibold">{r.composite}</td><td>{r.components.match}</td><td>{r.components.financial}</td><td>{r.components.budget}</td><td>{r.components.safety}</td><td><Badge tone={m.terms_status === "verified" ? "green" : "blue"}>{m.terms_status}</Badge></td></tr>); })}</tbody></table>
        <p className="mt-2 text-xs text-stone-500">Weights: {Object.entries(COMPOSITE_WEIGHTS).map(([k, v]) => `${k} ${v * 100}%`).join(" · ")}</p>
      </div>
      {models.map((m) => {
        const s = m.results.scenarios;
        const rows: [string, (x: typeof s.base) => string][] = [
          ["Daily transactions", (x) => String(x.dailyTransactions)], ["Monthly revenue", (x) => usd(x.monthlyRevenue)], ["Occupancy cost / month", (x) => usd(x.occupancyMonthly)],
          ["Occupancy % of revenue", (x) => `${x.occupancyCostPct ?? "—"}%`], ["Labor / month", (x) => usd(x.laborMonthly)], ["EBITDA / month", (x) => usd(x.ebitdaMonthly)],
          ["EBITDA margin", (x) => `${x.ebitdaMarginPct ?? "—"}%`], ["Break-even (txns/day)", (x) => String(x.breakEvenDailyTransactions ?? "—")], ["Startup capex", (x) => usd(x.startupCapex)],
          ["Total cash required", (x) => usd(x.totalCashRequired)], ["Budget surplus / gap", (x) => usd(x.budgetGap)], ["Payback month", (x) => (x.paybackMonth ? String(x.paybackMonth) : "> 36")],
        ];
        const a = m.assumptions;
        return (
          <div key={m.property_id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2"><div className="h2">{m.address}</div><span className="text-xs text-stone-400">model v{m.version} · {m.results.engineVersion}</span></div>
            {m.results.flags.length > 0 && <Notice>{m.results.flags.map((f) => <div key={f}>⚠ {f}</div>)}</Notice>}
            <div className="grid gap-4 lg:grid-cols-2">
              <table className="table"><thead><tr><th /><th>Conservative</th><th>Base</th><th>Optimistic</th></tr></thead>
                <tbody>{rows.map(([l, f]) => <tr key={l}><td className="text-stone-600">{l}</td><td>{f(s.conservative)}</td><td className="font-medium">{f(s.base)}</td><td>{f(s.optimistic)}</td></tr>)}</tbody></table>
              <div className="space-y-3">
                <CashChart series={[{ name: "Conservative", color: "#dc2626", points: s.conservative.cumulativeCash }, { name: "Base", color: "#047857", points: s.base.cumulativeCash }, { name: "Optimistic", color: "#1d4ed8", points: s.optimistic.cumulativeCash }]} />
                <div><div className="label">Sensitivity (base EBITDA / month)</div><ul className="text-sm">{m.results.sensitivity.map((x) => <li key={x.driver}>{x.driver}: <b className={x.deltaEbitdaMonthly < 0 ? "text-red-700" : "text-emerald-700"}>{usd(x.deltaEbitdaMonthly)}</b></li>)}</ul></div>
              </div>
            </div>
            <details><summary className="cursor-pointer text-sm font-medium">Assumptions & sources</summary>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                {Object.entries(LABELS).filter(([k]) => a[k]).map(([k, l]) => (
                  <div key={k} className="flex items-center justify-between gap-2 border-b border-stone-100 py-0.5"><span className="text-stone-600">{l}</span>
                    <span className="flex items-center gap-1"><b>{k.endsWith("Pct") ? `${(a[k].value * 100).toFixed(1)}%` : k === "dailyTransactionsBase" || k === "freeRentMonths" ? a[k].value : usd(a[k].value)}</b><Badge tone={SRC_TONE[a[k].source]}>{a[k].source.replace(/_/g, " ")}</Badge></span></div>))}
              </div>
              {a._demand && <p className="mt-2 text-xs text-stone-500">Demand factor: {a._demand.explanation}</p>}
            </details>
            <form action={rerunModelAction.bind(null, id, m.property_id)} className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
              {[["avgTicket", "Avg ticket $"], ["dailyTransactionsBase", "Txns/day"], ["laborMonthly", "Labor $/mo"], ["cogsPct", "COGS (0–1)"]].map(([k, l]) => (
                <div key={k}><label className="label">{l}</label><input name={k} type="number" step="any" placeholder={String(a[k]?.value ?? "")} className="input w-28" /></div>))}
              <button className="btn-secondary">Re-run with overrides</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

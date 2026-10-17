import { Badge, Notice, ScoreBar, SourceBadge, usd } from "./ui";

const REC: Record<string, { label: string; tone: "green" | "amber" | "red" | "blue" | "stone" }> = {
  proceed: { label: "Proceed", tone: "green" }, negotiate: { label: "Negotiate (via licensed broker)", tone: "amber" }, change_location: { label: "Change location", tone: "red" },
  revise_business: { label: "Revise business plan", tone: "amber" }, reject: { label: "Reject", tone: "red" }, insufficient_evidence: { label: "Insufficient evidence", tone: "stone" },
};

export function FinalReportView({ report }: { report: { id: string; version: number; status: string; content: any; narrative: any; recommendation: string; created_at: Date } }) {
  const c = report.content, n = report.narrative ?? {};
  const rec = REC[report.recommendation] ?? REC.insufficient_evidence;
  const addr = (pid: string) => c.properties.find((p: any) => p.propertyId === pid)?.address ?? pid;
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2"><div className="h2">Recommendation</div><Badge tone={rec.tone}>{rec.label}</Badge>
          {n.recommendedPropertyId && <span className="text-sm">for <b>{addr(n.recommendedPropertyId)}</b></span>}
          <span className="ml-auto text-xs text-stone-400">v{report.version} · {report.status} · {n._meta?.isMock ? "rule-based (AI not configured)" : n._meta?.model}</span></div>
        {n._meta?.guardrail && <Notice>{n._meta.guardrail}</Notice>}
        {n._meta?.unsupportedNumbers?.length > 0 && <Notice>Automated check flagged figures not present in source data: {n._meta.unsupportedNumbers.join(", ")}.</Notice>}
        <p>{n.executiveSummary}</p>
        {n.rationale && <p className="text-sm text-stone-600"><b>Rationale:</b> {n.rationale}</p>}
      </div>

      <div className="card overflow-x-auto">
        <div className="h2 mb-2">Property comparison & lease economics</div>
        <table className="table"><thead><tr><th>Rank</th><th>Property</th><th>Rent</th><th>Other occupancy</th><th>Base EBITDA/mo</th><th>Conservative</th><th>Break-even txns/day</th><th>Cash required</th><th>Budget gap</th><th>Evidence</th></tr></thead>
          <tbody>{c.ranking.map((r: any) => { const p = c.properties.find((x: any) => x.propertyId === r.propertyId); return (
            <tr key={r.propertyId}><td>{r.rank} <span className="text-xs text-stone-400">({r.composite})</span></td><td>{p.address}{p.isMock && <> <Badge tone="amber">simulated</Badge></>}</td>
              <td>{usd(p.lease?.rentMonthly)}</td><td className="text-xs">CAM {usd(p.lease?.camMonthly)} · NNN {usd(p.lease?.nnnMonthly)} · Dep {usd(p.lease?.securityDeposit)}</td>
              <td>{usd(p.base.ebitdaMonthly)}</td><td className={p.conservative.ebitdaMonthly < 0 ? "text-red-700" : ""}>{usd(p.conservative.ebitdaMonthly)}</td>
              <td>{p.base.breakEvenDailyTransactions} vs {p.base.dailyTransactions}</td><td>{usd(p.base.totalCashRequired)}</td><td className={p.base.budgetGap < 0 ? "text-red-700" : ""}>{usd(p.base.budgetGap)}</td>
              <td>{p.verified ? <Badge tone="green">verified on site</Badge> : <Badge tone="blue">{p.termsStatus}</Badge>}{p.inspection && <div className="text-xs text-stone-500">{p.inspection.evidenceCount} evidence files</div>}</td></tr>); })}</tbody></table>
      </div>

      {n.perProperty?.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">{n.perProperty.map((p: any) => (
          <div key={p.propertyId} className="card text-sm"><div className="font-semibold">{addr(p.propertyId)}</div><p className="mt-1">{p.assessment}</p>
            {p.negotiationPoints?.length > 0 && <><div className="label mt-2">Points for your licensed broker</div><ul className="ml-4 list-disc">{p.negotiationPoints.map((x: string) => <li key={x}>{x}</li>)}</ul></>}
            {p.dealBreakers?.length > 0 && <><div className="label mt-2">Deal-breakers</div><ul className="ml-4 list-disc text-red-800">{p.dealBreakers.map((x: string) => <li key={x}>{x}</li>)}</ul></>}
          </div>))}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><div className="h2 mb-2">Market & competition</div>
          <div className="mb-2 flex items-center gap-2 text-sm">Suitability <ScoreBar score={c.market.suitabilityScore} /></div>
          <ul className="text-sm">{c.market.components.map((x: any) => <li key={x.label} className="flex justify-between"><span>{x.label}</span><span>{x.score ?? "n/a"}</span></li>)}</ul>
          <p className="mt-2 text-sm">{c.market.competitorCount} cafés in radius · avg rating {c.market.avgCompetitorRating ?? "n/a"}</p>
        </div>
        <div className="card"><div className="h2 mb-2">Risks</div>
          {(n.risks ?? []).length === 0 ? <p className="muted">No qualitative risk synthesis available.</p> :
            <ul className="space-y-1 text-sm">{n.risks.map((r: any, i: number) => <li key={i}><Badge tone={r.severity === "high" ? "red" : r.severity === "medium" ? "amber" : "stone"}>{r.severity}</Badge> <span className="text-xs uppercase text-stone-500">{r.category}</span> — {r.description}<div className="text-xs text-stone-500">Mitigation: {r.mitigation}</div></li>)}</ul>}
          {c.properties.flatMap((p: any) => p.flags.map((f: string) => `${p.address}: ${f}`)).map((f: string) => <div key={f} className="mt-1 text-xs text-amber-800">⚠ {f}</div>)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><div className="h2 mb-2">Uncertainties & next steps</div>
          <ul className="ml-4 list-disc text-sm">{(n.uncertainties ?? []).map((x: string) => <li key={x}>{x}</li>)}</ul>
          <div className="label mt-3">Next steps</div><ul className="ml-4 list-disc text-sm">{(n.nextSteps ?? []).map((x: string) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="card"><div className="h2 mb-2">Evidence & sources</div>
          <p className="text-sm">{c.evidence.verifiedInspections}/{c.evidence.inspections} inspections verified · {c.evidence.evidenceFiles} evidence files</p>
          <ul className="mt-2 space-y-0.5 text-sm">{c.dataSources.map((s: any) => <li key={s.source}><SourceBadge status={s.status} /> {s.source}</li>)}</ul>
          <div className="label mt-3">Limitations</div><ul className="ml-4 list-disc text-xs text-stone-600">{c.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul>
        </div>
      </div>
      <p className="text-xs text-stone-500">This report does not constitute brokerage, legal or financial advice. Lease negotiation and representation are handled by licensed real-estate brokers.</p>
    </div>
  );
}

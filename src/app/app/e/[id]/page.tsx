import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { env } from "@/lib/env";
import { checkoutAction, rerunResearchAction } from "@/app/actions/sme";
import { MapView, type MapPoint } from "@/components/MapView";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Notice, ScoreBar, SourceBadge, Stat, usd } from "@/components/ui";
import type { MarketMetrics } from "@/lib/market/analysis";

export default async function MarketReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string; canceled?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser();
  const e = await loadEngagementFor(u, id);
  const [r] = await sql`select * from market_reports where engagement_id = ${id} order by version desc limit 1`;
  const [job] = await sql`select status, last_error, attempts from jobs where dedupe_key = ${`research:${id}`}`;

  if (!r) {
    return (
      <div className="card space-y-2">
        {job?.status === "failed" ? <Notice tone="red">Research failed: {job.last_error}</Notice> : <><AutoRefresh /><div className="h2">Researching your market…</div><p className="muted">Geocoding the target area, collecting competitors, demographics and land-use data, then synthesizing the report. This page refreshes automatically.</p>{job?.last_error && <Notice>Retrying after error: {job.last_error}</Notice>}</>}
      </div>
    );
  }
  const m = r.metrics as MarketMetrics;
  const n = r.narrative ?? {};
  const points: MapPoint[] = [
    { lat: Number(e.lat), lng: Number(e.lng), label: "Target area", kind: "target", detail: e.target_area },
    ...(r.competitors as { name: string; lat: number; lng: number; rating: number | null; reviews: number | null; distanceM: number }[]).map((c) => ({ lat: c.lat, lng: c.lng, label: c.name, kind: "competitor" as const, detail: `${c.rating ?? "–"}★ (${c.reviews ?? 0} reviews) · ${c.distanceM} m` })),
  ];
  if (e.tier === "paid") {
    const props = await sql`select p.address, st_y(p.location::geometry) as lat, st_x(p.location::geometry) as lng, ep.match_score, ep.status from engagement_properties ep join properties p on p.id = ep.property_id where ep.engagement_id = ${id} and ep.status <> 'rejected'`;
    points.push(...props.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), label: p.address, kind: "property" as const, detail: `Match ${p.match_score} · ${p.status}` })));
  }
  const verdictTone = { promising: "green", mixed: "amber", challenging: "red", insufficient_data: "stone" } as const;
  const anyMock = (r.data_sources as { status: string }[]).some((s) => s.status === "mock");
  return (
    <div className="space-y-4">
      {sp.paid && <Notice tone="green">Payment received — paid research is active. Property discovery has started.</Notice>}
      {sp.canceled && <Notice>Checkout was canceled. Your free report remains available.</Notice>}
      {e.status === "researching" && <><AutoRefresh /><Notice tone="blue">Refreshing research… showing the previous version meanwhile.</Notice></>}
      {anyMock && <Notice>Some data sources are running on <b>simulated data</b> because live credentials are not configured. Values marked “simulated” are placeholders and must not be used for decisions.</Notice>}

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Suitability score" value={m.suitabilityScore != null ? `${m.suitabilityScore}/100` : "n/a"} hint={`Heuristic, ${m.scoreCoverage}% of weight backed by data — not a success probability`} />
        <Stat label="Cafés in radius" value={m.competitorCount} hint={`${m.competitorDensityPerKm2}/km² · ${m.competitorsWithin250m} within 250 m`} />
        <Stat label="Avg competitor rating" value={m.avgCompetitorRating ?? "n/a"} hint={`${m.strongIncumbents} strong incumbents`} />
        <Stat label="Median HH income" value={usd(m.demographics?.medianHouseholdIncome)} hint={m.demographics?.acsVintage} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3"><MapView center={{ lat: Number(e.lat), lng: Number(e.lng) }} radiusM={Number(e.target_radius_m)} points={points} googleKey={env.googleBrowserKey || undefined} /></div>
        <div className="card space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between"><div className="h2">Score breakdown</div><span className="text-xs text-stone-500">{m.scoringVersion}</span></div>
          {m.components.map((c) => (
            <div key={c.key}>
              <div className="flex items-center justify-between text-sm"><span>{c.label} <span className="text-xs text-stone-400">({Math.round(c.weight * 100)}%)</span></span><ScoreBar score={c.score} /></div>
              <ul className="ml-4 list-disc text-xs text-stone-500">{c.drivers.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2"><div className="h2">Preliminary assessment</div>
          {n.preliminaryVerdict && <Badge tone={verdictTone[n.preliminaryVerdict as keyof typeof verdictTone]}>{String(n.preliminaryVerdict).replace("_", " ")}</Badge>}
          <span className="ml-auto text-xs text-stone-400">v{r.version} · {n._meta?.isMock ? "template (AI not configured)" : n._meta?.model ?? ""}</span></div>
        {n._meta?.error && <Notice tone="red">AI synthesis unavailable: {n._meta.error}. Deterministic metrics above remain valid.</Notice>}
        {n._meta?.unsupportedNumbers?.length > 0 && <Notice>Automated check: the narrative contains figures not found in the source data ({n._meta.unsupportedNumbers.join(", ")}). Treat them with caution.</Notice>}
        {n.summary && <p>{n.summary}</p>}
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          {[["Demand", n.demandAssessment], ["Competition", n.competitionAssessment], ["Neighborhood", n.neighborhoodCharacter]].map(([t, v]) => v && <div key={t}><div className="font-semibold">{t}</div><p className="text-stone-700">{v}</p></div>)}
        </div>
        {n.risks?.length > 0 && <div><div className="font-semibold text-sm">Risks</div><ul className="space-y-1 text-sm">{n.risks.map((k: { category: string; description: string; severity: string; evidence: string[] }, i: number) => <li key={i}><Badge tone={k.severity === "high" ? "red" : k.severity === "medium" ? "amber" : "stone"}>{k.severity}</Badge> <span className="text-xs uppercase text-stone-500">{k.category}</span> — {k.description} <span className="text-xs text-stone-400">[{k.evidence.join(", ")}]</span></li>)}</ul></div>}
        {n.opportunities?.length > 0 && <div><div className="font-semibold text-sm">Opportunities</div><ul className="ml-4 list-disc text-sm">{n.opportunities.map((o: string) => <li key={o}>{o}</li>)}</ul></div>}
        {n.questionsToResolve?.length > 0 && <div><div className="font-semibold text-sm">Open questions</div><ul className="ml-4 list-disc text-sm">{n.questionsToResolve.map((o: string) => <li key={o}>{o}</li>)}</ul></div>}
      </div>

      {m.demographics && (
        <div className="card"><div className="h2 mb-2">Demographics <span className="text-sm font-normal text-stone-500">— {m.demographics.geography}</span></div>
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div>Population: <b>{m.demographics.population?.toLocaleString() ?? "—"}</b></div>
            <div>Density: <b>{m.demographics.populationDensityPerKm2?.toLocaleString() ?? "—"}/km²</b></div>
            <div>Median age: <b>{m.demographics.medianAge ?? "—"}</b></div>
            <div>Bachelor&apos;s+: <b>{m.demographics.bachelorsOrHigherPct ?? "—"}%</b></div>
            <div>Transit commuters: <b>{m.demographics.transitCommutePct ?? "—"}%</b></div>
            <div>Median gross rent: <b>{usd(m.demographics.medianGrossRent)}</b></div>
            {m.landUse && <div>Mixed-use lots: <b>{m.landUse.mixedResCommercialPct}%</b></div>}
            {m.foodService && <div>Permitted Coffee/Tea: <b>{m.foodService.coffeeTeaEstablishments}</b></div>}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><div className="h2 mb-2">Data sources</div>
          <ul className="space-y-1 text-sm">{(r.data_sources as { source: string; status: string; cached?: boolean; fetchedAt: string; license?: string; error?: string }[]).map((s) => (
            <li key={s.source}><SourceBadge status={s.status} /> <b>{s.source}</b> {s.cached && <span className="text-xs text-stone-400">(cached)</span>}<div className="text-xs text-stone-500">{s.license}{s.error ? ` · live fetch failed: ${s.error}` : ""}</div></li>))}</ul>
        </div>
        <div className="card"><div className="h2 mb-2">Limitations</div><ul className="ml-4 list-disc space-y-1 text-sm text-stone-700">{(r.limitations as string[]).map((l) => <li key={l}>{l}</li>)}</ul></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {e.tier !== "paid" && u.role === "sme_owner" && (
          <form action={checkoutAction.bind(null, id)} className="card flex flex-1 items-center justify-between gap-4">
            <div><div className="h2">Ready to find a space?</div><p className="muted">Paid research adds property discovery (incl. off-market leads), landlord outreach, verified lease terms, financial feasibility, on-site inspections and a final decision report.</p></div>
            <button className="btn whitespace-nowrap">Activate paid research · {usd(env.paidResearchPriceCents / 100)}</button>
          </form>
        )}
        <form action={rerunResearchAction.bind(null, id)}><button className="btn-secondary">Refresh research</button></form>
      </div>
    </div>
  );
}

import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { requestInspectionAction, setShortlistAction } from "@/app/actions/sme";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Empty, Notice, ScoreBar, SourceBadge, StatusBadge, usd } from "@/components/ui";
import { redirect } from "next/navigation";

export default async function PropertiesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const u = await requireUser();
  const e = await loadEngagementFor(u, id);
  if (e.tier !== "paid") redirect(`/app/e/${id}`);
  const [job] = await sql`select status, result, last_error from jobs where dedupe_key = ${`discover:${id}`}`;
  // SMEs see only approved/verified terms; landlord identities and contact details stay in the platform CRM.
  const rows = await sql`
    select p.id, p.address, p.neighborhood, p.sqft, p.source_type, p.is_mock, p.off_market, p.facilities, p.status as property_status,
           ep.status, ep.match_score, ep.score_breakdown, ep.distance_m,
           t.rent_monthly, t.cam_monthly, t.nnn_monthly, t.security_deposit, t.lease_term_months, t.negotiable, t.missing_fields, t.status as terms_status, t.source_kind,
           t.free_rent_months, t.utilities_monthly, t.electricity_monthly, t.availability_date,
           (select status from inspections i where i.engagement_id = ${id} and i.property_id = p.id order by created_at desc limit 1) as inspection_status,
           (select count(*)::int from lease_terms x where x.property_id = p.id and x.status = 'extracted') as pending_terms
    from engagement_properties ep join properties p on p.id = ep.property_id
    left join lateral (select * from lease_terms lt where lt.property_id = p.id and lt.status in ('approved','verified') order by (lt.status='verified') desc, lt.created_at desc limit 1) t on true
    where ep.engagement_id = ${id}
    order by (ep.status = 'shortlisted') desc, ep.status = 'rejected', ep.match_score desc nulls last`;
  const working = !job || ["queued", "running"].includes(job.status);
  return (
    <div className="space-y-4">
      {sp.paid && <Notice tone="green">Payment received — paid research is active.</Notice>}
      {working && <><AutoRefresh /><Notice tone="blue">Discovering properties from authorized sources and matching them to your requirements…</Notice></>}
      {job?.status === "failed" && <Notice tone="red">Discovery failed: {job.last_error}</Notice>}
      {job?.result?.sources && (
        <div className="card text-sm"><div className="mb-1 font-semibold">Discovery sources</div>
          <ul className="space-y-0.5">{job.result.sources.map((s: { source: string; status: string; count: number; note: string }) => <li key={s.source}><SourceBadge status={s.status} /> {s.source}: {s.count} leads <span className="text-xs text-stone-500">— {s.note}</span></li>)}</ul>
          <p className="mt-1 text-xs text-stone-500">Plus SiteIQ&apos;s property CRM (owner submissions, licensed broker referrals, prior research). Our team contacts landlords to collect and verify terms; new terms appear here after review.</p>
        </div>
      )}
      {rows.length === 0 ? (!working && <Empty>No properties matched yet. Our research team is sourcing leads — check back soon.</Empty>) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className={`card ${r.status === "rejected" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.address}</span>
                    {r.is_mock && <Badge tone="amber">simulated</Badge>}{r.off_market && <Badge tone="violet">off-market lead</Badge>}
                    <Badge>{String(r.source_type).replace("_", " ")}</Badge><StatusBadge status={r.status} /></div>
                  <div className="muted">{r.distance_m} m from target · {r.sqft ? `${r.sqft.toLocaleString()} sq ft` : "size unknown"}{r.neighborhood ? ` · ${r.neighborhood}` : ""}</div>
                </div>
                <div className="text-right"><div className="text-xs text-stone-500">Match</div><ScoreBar score={r.match_score} /></div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm">
                <div>
                  <div className="label">Commercial terms</div>
                  {r.terms_status ? (
                    <div className="space-y-0.5">
                      <div>Rent: <b>{usd(r.rent_monthly)}</b>/mo {r.cam_monthly != null && <>· CAM {usd(r.cam_monthly)}</>} {r.nnn_monthly != null && <>· NNN {usd(r.nnn_monthly)}</>}</div>
                      <div>Deposit: {usd(r.security_deposit)} · Term: {r.lease_term_months ? `${r.lease_term_months / 12} yrs` : "—"} · Negotiable: {r.negotiable}</div>
                      {r.free_rent_months && <div>Free rent: {r.free_rent_months} mo</div>}
                      <div className="flex items-center gap-1"><Badge tone={r.terms_status === "verified" ? "green" : "blue"}>{r.terms_status === "verified" ? "verified on site" : "reported by landlord/broker"}</Badge><span className="text-xs text-stone-400">source: {r.source_kind}</span></div>
                      {r.missing_fields?.length > 0 && <div className="text-xs text-amber-700">Missing: {r.missing_fields.join(", ")}</div>}
                    </div>
                  ) : <div className="text-stone-500">{r.pending_terms ? "Terms collected — under review" : "Not yet collected — outreach pending"}</div>}
                </div>
                <div>
                  <div className="label">Match breakdown</div>
                  <ul className="text-xs text-stone-600">{(r.score_breakdown?.parts ?? []).map((p: { key: string; label: string; score: number; note: string }) => <li key={p.key}>{p.label}: <b>{Math.round(p.score)}</b> — {p.note}</li>)}</ul>
                </div>
                <div className="flex flex-col items-start gap-2">
                  <div className="label">Actions</div>
                  {r.status !== "shortlisted" && r.status !== "rejected" && <form action={setShortlistAction.bind(null, id, r.id, "shortlisted")}><button className="btn">Shortlist</button></form>}
                  {r.status === "shortlisted" && <form action={setShortlistAction.bind(null, id, r.id, "candidate")}><button className="btn-secondary">Remove from shortlist</button></form>}
                  {r.status !== "rejected" ? <form action={setShortlistAction.bind(null, id, r.id, "rejected")}><button className="text-xs text-stone-500 underline">Not interested</button></form>
                    : <form action={setShortlistAction.bind(null, id, r.id, "candidate")}><button className="text-xs text-stone-500 underline">Restore</button></form>}
                  {r.status === "shortlisted" && (r.inspection_status
                    ? <div className="text-sm">Inspection: <StatusBadge status={r.inspection_status} /></div>
                    : <form action={requestInspectionAction.bind(null, id, r.id)}><button className="btn-secondary">Request on-site inspection</button></form>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

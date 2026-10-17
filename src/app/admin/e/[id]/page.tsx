import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { addToEngagementAction, brokerHandoffAction, generateFinalReportAction, rediscoverAction, runFeasibilityAction, decideApprovalAction } from "@/app/actions/admin";
import { setShortlistAction, requestInspectionAction } from "@/app/actions/sme";
import { FinalReportView } from "@/components/FinalReportView";
import { Badge, Notice, ScoreBar, StatusBadge, usd } from "@/components/ui";
import { Stepper } from "@/components/Stepper";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function Workbench({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser(STAFF_ROLES);
  const e = await loadEngagementFor(u, id);
  const cands = await sql`
    select p.id, p.address, p.is_mock, p.source_type, p.status as pstatus, ep.status, ep.match_score, ep.distance_m,
      (select status from lease_terms lt where lt.property_id = p.id order by created_at desc limit 1) as terms_status,
      (select count(*)::int from outreach_tasks ot where ot.property_id = p.id and ot.engagement_id = ${id}) as outreach,
      (select status from inspections i where i.property_id = p.id and i.engagement_id = ${id} order by created_at desc limit 1) as inspection
    from engagement_properties ep join properties p on p.id = ep.property_id where ep.engagement_id = ${id} order by ep.match_score desc nulls last`;
  const nearby = await sql`select p.id, p.address from properties p, business_profiles bp, engagements e
    where e.id = ${id} and bp.id = e.business_profile_id and st_dwithin(p.location, bp.target_location, 3000)
      and not exists (select 1 from engagement_properties ep where ep.engagement_id = ${id} and ep.property_id = p.id) order by p.created_at desc limit 50`;
  const brokers = await sql`select id, name, company, license_number from contacts where kind = 'broker' and license_number is not null`;
  const handoffs = await sql`select a.*, p.address from approvals a join properties p on p.id = a.ref_id where a.kind = 'brokerage_handoff' and a.engagement_id = ${id}`;
  const [fr] = await sql`select * from final_reports where engagement_id = ${id} order by version desc limit 1`;
  const [frApproval] = fr ? await sql`select id, status from approvals where kind = 'final_report' and ref_id = ${fr.id}` : [];
  const [cost] = await sql`select (select coalesce(sum(cost_usd),0) from ai_usage where engagement_id = ${id}) as ai, (select coalesce(sum(input_tokens+output_tokens),0) from ai_usage where engagement_id = ${id}) as tokens, (select coalesce(sum(cost_usd),0) from api_usage where engagement_id = ${id}) as api`;
  const jobs = await sql`select id, type, status, last_error, updated_at from jobs where engagement_id = ${id} order by id desc limit 8`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2"><div><h1 className="h1">{e.business_name}</h1><div className="muted">{e.concept} · {e.target_area} · budget {usd(e.startup_budget)} · max rent {usd(e.max_monthly_rent)}/mo · {e.opening_timeline}</div></div>
        <div className="ml-auto flex gap-2"><Link className="btn-secondary" href={`/app/e/${id}`}>Client view</Link></div></div>
      <Stepper status={e.status} />
      {jobs.some((j) => ["queued", "running"].includes(j.status)) && <><AutoRefresh /><Notice tone="blue">Background work in progress…</Notice></>}
      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="card">Tier: <b>{e.tier}</b> · Status: <StatusBadge status={e.status} /></div>
        <div className="card">Cost to date: AI {usd(cost.ai)} ({Number(cost.tokens).toLocaleString()} tokens) · APIs {usd(cost.api)}</div>
        <div className="card text-xs">{jobs.map((j) => <div key={j.id}>#{j.id} {j.type} <StatusBadge status={j.status} /> {j.last_error && <span className="text-red-700">{j.last_error}</span>}</div>)}</div>
      </div>
      {e.tier !== "paid" ? <Notice>Free tier — paid workflow starts after payment.</Notice> : (
        <>
          <div className="flex flex-wrap gap-2">
            <form action={rediscoverAction.bind(null, id)}><button className="btn-secondary">Re-run discovery</button></form>
            <form action={runFeasibilityAction.bind(null, id)}><button className="btn-secondary">Re-run feasibility</button></form>
            <form action={generateFinalReportAction.bind(null, id)}><button className="btn">Generate decision report</button></form>
          </div>
          <div className="card overflow-x-auto"><div className="h2 mb-2">Candidate properties</div>
            <table className="table"><thead><tr><th>Property</th><th>Match</th><th>Status</th><th>Terms</th><th>Outreach</th><th>Inspection</th><th>Actions</th></tr></thead>
              <tbody>{cands.map((c) => (
                <tr key={c.id}><td><Link className="underline" href={`/admin/properties/${c.id}?engagement=${id}`}>{c.address}</Link> {c.is_mock && <Badge tone="amber">sim</Badge>}<div className="text-xs text-stone-500">{c.source_type} · {c.distance_m} m</div></td>
                  <td><ScoreBar score={c.match_score} /></td><td><StatusBadge status={c.status} /></td><td>{c.terms_status ? <StatusBadge status={c.terms_status} /> : "—"}</td><td>{c.outreach}</td>
                  <td>{c.inspection ? <StatusBadge status={c.inspection} /> : "—"}</td>
                  <td className="space-y-1">
                    {c.status !== "shortlisted" ? <form action={setShortlistAction.bind(null, id, c.id, "shortlisted")}><button className="text-xs underline">Shortlist</button></form> : !c.inspection && <form action={requestInspectionAction.bind(null, id, c.id)}><button className="text-xs underline">Request inspection</button></form>}
                  </td></tr>))}</tbody></table>
            <form action={addToEngagementAction.bind(null, id)} className="mt-3 flex gap-2"><select name="propertyId" className="input max-w-md">{nearby.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}</select><button className="btn-secondary" disabled={!nearby.length}>Add CRM property</button></form>
          </div>
          <div className="card space-y-2"><div className="h2">Brokerage handoff (negotiation / representation)</div>
            <p className="muted">Negotiation and representation are regulated brokerage activities. Route them to a licensed broker; the handoff is logged and requires approval.</p>
            {handoffs.map((h) => <div key={h.id} className="text-sm">{h.address} → broker {h.payload.brokerContactId?.slice(0, 8)} <StatusBadge status={h.status} /></div>)}
            <form action={async (fd: FormData) => { "use server"; await brokerHandoffAction(id, String(fd.get("propertyId")), fd); }} className="flex flex-wrap gap-2">
              <select name="propertyId" className="input max-w-xs">{cands.filter((c) => c.status === "shortlisted").map((c) => <option key={c.id} value={c.id}>{c.address}</option>)}</select>
              <select name="brokerContactId" className="input max-w-xs">{brokers.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.company}) lic. {b.license_number}</option>)}</select>
              <input name="note" className="input max-w-xs" placeholder="Note (e.g. negotiate rent & free rent)" /><button className="btn-secondary">Request handoff</button>
            </form>
          </div>
          {fr && (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><div className="h2">Decision report v{fr.version}</div><StatusBadge status={fr.status} />
                <a className="btn-secondary ml-auto" href={`/api/reports/${fr.id}/pdf`}>PDF</a>
                {frApproval?.status === "pending" && <>
                  <form action={decideApprovalAction.bind(null, frApproval.id, "approved")}><button className="btn">Approve & deliver to client</button></form>
                  <form action={decideApprovalAction.bind(null, frApproval.id, "rejected")}><button className="btn-secondary">Reject</button></form></>}
              </div>
              <FinalReportView report={fr as never} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

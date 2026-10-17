import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { integrationStatus } from "@/lib/env";
import { runJobsNowAction } from "@/app/actions/admin";
import { Badge, Stat, StatusBadge, usd } from "@/components/ui";

export default async function AdminHome() {
  await requireUser(STAFF_ROLES);
  const engs = await sql`
    select e.id, e.status, e.tier, e.updated_at, o.name as org, bp.business_name, bp.target_area,
      (select count(*)::int from engagement_properties ep where ep.engagement_id = e.id) as candidates,
      (select count(*)::int from engagement_properties ep where ep.engagement_id = e.id and ep.status = 'shortlisted') as shortlisted,
      (select count(*)::int from inspections i where i.engagement_id = e.id and i.status = 'submitted') as to_review,
      (select coalesce(sum(cost_usd),0) from ai_usage a where a.engagement_id = e.id) + (select coalesce(sum(cost_usd),0) from api_usage a where a.engagement_id = e.id) as cost
    from engagements e join organizations o on o.id = e.org_id join business_profiles bp on bp.id = e.business_profile_id
    order by e.updated_at desc limit 100`;
  const [q] = await sql`select count(*) filter (where status='queued')::int as queued, count(*) filter (where status='running')::int as running, count(*) filter (where status='failed')::int as failed from jobs`;
  const [ap] = await sql`select count(*)::int as n from approvals where status = 'pending'`;
  const failed = await sql`select id, type, last_error, updated_at from jobs where status = 'failed' order by updated_at desc limit 5`;
  return (
    <div className="space-y-4">
      <h1 className="h1">Research pipeline</h1>
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Engagements" value={engs.length} hint={`${engs.filter((e) => e.tier === "paid").length} paid`} />
        <Stat label="Pending approvals" value={<Link className="underline" href="/admin/approvals">{ap.n}</Link>} />
        <Stat label="Jobs" value={`${q.queued} queued · ${q.running} running`} hint={`${q.failed} failed`} />
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-xs">{Object.entries(integrationStatus()).map(([k, v]) => <div key={k}>{k}: <b>{v}</b></div>)}</div>
      </div>
      <form action={runJobsNowAction}><button className="btn-secondary">Process job queue now</button></form>
      {failed.length > 0 && <div className="card text-sm"><div className="font-semibold">Recently failed jobs</div>{failed.map((f) => <div key={f.id}>#{f.id} {f.type}: <span className="text-red-700">{f.last_error}</span></div>)}</div>}
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>Client</th><th>Business / area</th><th>Status</th><th>Tier</th><th>Candidates</th><th>Shortlisted</th><th>Inspections to review</th><th>Cost to date</th><th /></tr></thead>
        <tbody>{engs.map((e) => (
          <tr key={e.id}><td>{e.org}</td><td><b>{e.business_name}</b><div className="text-xs text-stone-500">{e.target_area}</div></td><td><StatusBadge status={e.status} /></td>
            <td><Badge tone={e.tier === "paid" ? "green" : "stone"}>{e.tier}</Badge></td><td>{e.candidates}</td><td>{e.shortlisted}</td><td>{e.to_review}</td><td>{usd(e.cost)}</td>
            <td><Link className="text-emerald-700 underline" href={`/admin/e/${e.id}`}>Workbench</Link></td></tr>))}</tbody></table></div>
    </div>
  );
}

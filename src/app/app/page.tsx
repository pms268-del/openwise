import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, SME_ROLES } from "@/lib/auth/session";
import { Empty, ScoreBar, StatusBadge } from "@/components/ui";

export default async function SmeHome() {
  const u = await requireUser(SME_ROLES);
  const rows = await sql`
    select e.id, e.status, e.tier, e.created_at, bp.business_name, bp.target_area,
      (select (metrics->>'suitabilityScore')::numeric from market_reports m where m.engagement_id = e.id order by version desc limit 1) as score
    from engagements e join business_profiles bp on bp.id = e.business_profile_id
    where e.org_id = ${u.orgId} order by e.created_at desc`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="h1">My location research</h1>{u.role === "sme_owner" && <Link href="/app/new" className="btn">New research</Link>}</div>
      {rows.length === 0 ? <Empty>No research yet. <Link className="text-emerald-700 underline" href="/app/new">Start your free market report</Link>.</Empty> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>Business</th><th>Target area</th><th>Status</th><th>Tier</th><th>Suitability</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="font-medium">{r.business_name}</td><td>{r.target_area}</td><td><StatusBadge status={r.status} /></td><td>{r.tier}</td><td><ScoreBar score={r.score} /></td>
              <td><Link className="text-emerald-700 underline" href={`/app/e/${r.id}`}>Open</Link></td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

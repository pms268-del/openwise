import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { Empty, StatusBadge } from "@/components/ui";

export default async function OwnerHome() {
  const u = await requireUser(["property_owner"]);
  const rows = await sql`select p.id, p.address, p.status, p.owner_permissions, (select count(*)::int from engagement_properties ep where ep.property_id = p.id) as matches
    from properties p where p.owner_org_id = ${u.orgId} order by p.created_at desc`;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h1 className="h1">My properties</h1><Link href="/owner/new" className="btn">Submit a property</Link></div>
      {rows.length === 0 ? <Empty>Submit your vacant or soon-available retail space to be matched with vetted small businesses.</Empty> : (
        <div className="card"><table className="table"><thead><tr><th>Address</th><th>Status</th><th>Shared with businesses</th><th>Matched searches</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link className="underline" href={`/owner/p/${r.id}`}>{r.address}</Link></td><td><StatusBadge status={r.status} /></td><td>{r.owner_permissions?.share_with_smes ? "Yes" : "No"}</td><td>{r.matches}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}

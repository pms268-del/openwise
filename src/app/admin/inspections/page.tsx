import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { assignInspectionAction } from "@/app/actions/admin";
import { Badge, Notice, StatusBadge } from "@/components/ui";

export default async function Inspections({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser(STAFF_ROLES);
  const { error } = await searchParams;
  const rows = await sql`select i.*, p.address, bp.business_name, u.name as assignee from inspections i join properties p on p.id = i.property_id
    join engagements e on e.id = i.engagement_id join business_profiles bp on bp.id = e.business_profile_id left join users u on u.id = i.assigned_to order by i.created_at desc`;
  const agents = await sql`select id, name, role, broker_license_number from users where role in ('field_agent','broker') order by role, name`;
  return (
    <div className="space-y-4">
      <h1 className="h1">Field inspections</h1>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>Property</th><th>Client</th><th>Status</th><th>Assignee</th><th>Assign</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td>{r.address}{r.requires_licensed_broker && <> <Badge tone="violet">broker required</Badge></>}</td><td>{r.business_name}</td><td><StatusBadge status={r.status} /></td><td>{r.assignee ?? "—"}</td>
            <td>{["requested", "assigned", "scheduled"].includes(r.status) && (
              <form action={assignInspectionAction.bind(null, r.id)} className="flex flex-wrap items-center gap-1 text-xs">
                <select name="assignee" defaultValue={r.assigned_to ?? ""} className="input w-44">{agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role}{a.broker_license_number ? " lic." : ""})</option>)}</select>
                <input type="datetime-local" name="scheduledFor" className="input w-44" />
                <label className="flex items-center gap-1"><input type="checkbox" name="requiresBroker" defaultChecked={r.requires_licensed_broker} /> brokerage activity</label>
                <button className="btn-secondary">Assign</button></form>)}</td>
            <td><Link className="underline" href={`/admin/inspections/${r.id}`}>Open</Link></td></tr>))}</tbody></table></div>
    </div>
  );
}

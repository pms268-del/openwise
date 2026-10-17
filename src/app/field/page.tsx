import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, FIELD_ROLES } from "@/lib/auth/session";
import { Badge, Empty, Notice, StatusBadge } from "@/components/ui";

export default async function FieldHome({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const u = await requireUser(FIELD_ROLES);
  const { submitted } = await searchParams;
  const rows = await sql`select i.id, i.status, i.scheduled_for, i.requires_licensed_broker, p.address, p.neighborhood,
      (select count(*)::int from evidence ev where ev.inspection_id = i.id) as evidence
    from inspections i join properties p on p.id = i.property_id where i.assigned_to = ${u.id} order by i.status = 'verified', i.scheduled_for nulls last`;
  return (
    <div className="space-y-3">
      <h1 className="h1">My {u.role === "broker" ? "assignments" : "inspections"}</h1>
      {submitted && <Notice tone="green">Inspection submitted for review.</Notice>}
      {rows.length === 0 ? <Empty>No inspections assigned to you.</Empty> : rows.map((r) => (
        <Link key={r.id} href={`/field/i/${r.id}`} className="card block">
          <div className="flex items-center gap-2"><b>{r.address}</b><StatusBadge status={r.status} />{r.requires_licensed_broker && <Badge tone="violet">licensed broker</Badge>}</div>
          <div className="muted">{r.neighborhood ?? ""} {r.scheduled_for ? `· ${new Date(r.scheduled_for).toLocaleString()}` : "· not scheduled"} · {r.evidence} files</div>
        </Link>))}
    </div>
  );
}

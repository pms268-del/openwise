import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { markOutreachSentAction } from "@/app/actions/admin";
import { env } from "@/lib/env";
import { Notice, StatusBadge } from "@/components/ui";

export default async function Outreach() {
  await requireUser(STAFF_ROLES);
  const tasks = await sql`select ot.*, p.address, c.name as contact_name, bp.business_name from outreach_tasks ot join properties p on p.id = ot.property_id
    left join contacts c on c.id = ot.contact_id left join engagements e on e.id = ot.engagement_id left join business_profiles bp on bp.id = e.business_profile_id
    order by ot.created_at desc limit 200`;
  return (
    <div className="space-y-4">
      <h1 className="h1">Outreach tasks</h1>
      <Notice tone={env.aiVoiceEnabled ? "amber" : "blue"}>Automated AI voice calling is <b>{env.aiVoiceEnabled ? "ENABLED" : "disabled"}</b>. Default workflow: human-initiated calls with a prepared script; emails are sent by staff from their own mailbox after approval.</Notice>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>Property</th><th>Client</th><th>Channel</th><th>Contact</th><th>Status</th><th>Next step</th></tr></thead>
        <tbody>{tasks.map((t) => (
          <tr key={t.id}><td><Link className="underline" href={`/admin/properties/${t.property_id}`}>{t.address}</Link></td><td>{t.business_name ?? "—"}</td><td>{t.channel}</td><td>{t.contact_name}</td><td><StatusBadge status={t.status} /></td>
            <td>{t.status === "approved" && t.channel === "email" ? <form action={markOutreachSentAction.bind(null, t.id)}><button className="text-xs underline">Mark sent</button></form>
              : ["approved", "in_progress"].includes(t.status) ? <Link className="text-xs underline" href={`/admin/properties/${t.property_id}`}>Log call / reply</Link>
              : t.status === "pending_approval" ? <Link className="text-xs underline" href="/admin/approvals">Review</Link> : t.status === "blocked" ? <span className="text-xs text-red-700">{t.compliance?.reasons?.[0]}</span> : "—"}</td></tr>))}</tbody></table></div>
    </div>
  );
}

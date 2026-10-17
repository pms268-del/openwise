import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

export default async function Audit() {
  await requireUser(["admin"]);
  const rows = await sql`select a.*, u.name, u.role from audit_logs a left join users u on u.id = a.actor_user_id order by a.created_at desc limit 300`;
  return (
    <div className="space-y-4">
      <h1 className="h1">Audit log</h1>
      <div className="card overflow-x-auto"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Data</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString()}</td><td>{r.name ?? "system"} <span className="text-xs text-stone-400">{r.role}</span></td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.entity_type}:{String(r.entity_id ?? "").slice(0, 8)}</td><td className="max-w-md truncate font-mono text-xs">{JSON.stringify(r.data)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

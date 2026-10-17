import { sql } from "./db";
import type { SessionUser } from "./auth/session";

export async function audit(
  actor: SessionUser | null,
  action: string,
  entityType: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
) {
  await sql`
    insert into audit_logs (org_id, actor_user_id, action, entity_type, entity_id, data)
    values (${actor?.orgId ?? null}, ${actor?.id ?? null}, ${action}, ${entityType}, ${entityId}, ${sql.json(data as never)})`;
}

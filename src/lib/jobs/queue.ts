// Durable Postgres-backed job queue (FOR UPDATE SKIP LOCKED). Jobs survive restarts, retry with
// backoff, and are idempotent via dedupe_key. Drained by /api/jobs/run (Vercel Cron) and kicked
// opportunistically after enqueue.
import { sql } from "../db";

export type JobType = "market_research" | "extract_call" | "discover_properties" | "run_feasibility" | "generate_checklist" | "final_report";

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { engagementId?: string; dedupeKey?: string; runAfter?: Date } = {}) {
  const rows = await sql`
    insert into jobs (type, payload, engagement_id, dedupe_key, run_after)
    values (${type}, ${sql.json(payload as never)}, ${opts.engagementId ?? null}, ${opts.dedupeKey ?? null}, ${opts.runAfter ?? new Date()})
    on conflict (dedupe_key) do update set
      status = case when jobs.status in ('done','failed') then 'queued' else jobs.status end,
      attempts = case when jobs.status in ('done','failed') then 0 else jobs.attempts end,
      payload = excluded.payload, run_after = excluded.run_after, updated_at = now()
    returning id`;
  return rows[0].id as number;
}

export async function claim(workerId: string) {
  const rows = await sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_at < now() - interval '10 minutes')  -- reclaim stuck jobs
      order by run_after limit 1 for update skip locked)
    returning *`;
  return rows[0] ?? null;
}

export async function complete(id: number, result: unknown) {
  await sql`update jobs set status = 'done', result = ${sql.json((result ?? {}) as never)}, last_error = null, updated_at = now() where id = ${id}`;
}

export async function fail(id: number, err: Error, attempts: number, maxAttempts: number) {
  const final = attempts >= maxAttempts;
  await sql`update jobs set status = ${final ? "failed" : "queued"}, last_error = ${err.message.slice(0, 2000)},
            run_after = now() + ${`${2 ** attempts * 15} seconds`}::interval, locked_at = null, updated_at = now() where id = ${id}`;
}

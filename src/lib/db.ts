import postgres from "postgres";
import { env } from "./env";

declare global {
  var __siteiqSql: postgres.Sql | undefined;
}

// One pooled client per server process (reused across hot reloads in dev).
export const sql: postgres.Sql =
  globalThis.__siteiqSql ??
  postgres(env.databaseUrl, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    prepare: !env.databaseUrl.includes("pooler.supabase.com"), // Supavisor transaction mode disallows prepared statements
    transform: { undefined: null },
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
  });
if (process.env.NODE_ENV !== "production") globalThis.__siteiqSql = sql;

export type Row = Record<string, unknown>;

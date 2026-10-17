import postgres from "postgres";
import { env } from "./env";

declare global {
  var __siteiqSql: postgres.Sql | undefined;
}

function create(): postgres.Sql {
  const url = env.databaseUrl.trim();
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !url.includes("pooler.supabase.com"), // Supavisor transaction mode disallows prepared statements
    transform: { undefined: null },
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

function real(): postgres.Sql {
  return (globalThis.__siteiqSql ??= create());
}

// Lazily created on first use, so a misconfigured DATABASE_URL only breaks requests that
// actually touch the database (and /api/health can report it) instead of every page.
export const sql: postgres.Sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_t, _this, args) => (real() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const s = real() as unknown as Record<string | symbol, unknown>;
    const v = s[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
});

export type Row = Record<string, unknown>;

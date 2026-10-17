import { NextResponse } from "next/server";
import { env, integrationStatus } from "@/lib/env";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Deployment diagnostics. Never echoes secret values — only whether they are set and what failed.
export async function GET() {
  const checks: Record<string, unknown> = {
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "MISSING (using localhost default)",
    SESSION_SECRET: process.env.SESSION_SECRET ? (process.env.SESSION_SECRET.length >= 32 ? "set" : "set but shorter than 32 chars") : "MISSING",
    CRON_SECRET: process.env.CRON_SECRET ? "set" : "MISSING",
  };
  const raw = (process.env.DATABASE_URL ?? "").trim();
  if (raw) {
    const scheme = raw.indexOf("://");
    if (/^["']|["']$/.test(raw)) checks.database_url_format = "has surrounding quotes — remove them";
    else if (/\s/.test(raw)) checks.database_url_format = "contains spaces or line breaks — re-paste it";
    else if (raw.includes("#") || (raw.slice(scheme + 3).match(/@/g) ?? []).length > 1)
      checks.database_url_format = "INVALID — the password contains @ or # characters; reset the database password to letters+numbers only (or URL-encode it)";
    else {
      try {
        const u = new URL(raw);
        if (!u.hostname.includes(".")) throw new Error("bad host");
        checks.database_url_format = `ok (host ${u.hostname}, port ${u.port || "default"}${u.hostname.includes("pooler.supabase.com") ? ", Supabase pooler" : ""})`;
        if (u.password.includes("[") || u.password.toUpperCase().includes("YOUR-PASSWORD")) checks.database_url_format = "password placeholder [YOUR-PASSWORD] was not replaced";
      } catch { checks.database_url_format = "INVALID URL — password likely contains @ # / : ? characters; reset it to letters+numbers or URL-encode it"; }
    }
  }
  try {
    const [r] = await sql`select (select count(*)::int from users) as users, (select count(*)::int from markets) as markets, postgis_version() as postgis`;
    checks.database = `connected (users=${r.users}, markets=${r.markets}, postgis ${String(r.postgis).split(" ")[0]})`;
  } catch (e) {
    const msg = (e as Error).message.replace(env.databaseUrl, "[DATABASE_URL]");
    checks.database = `FAILED: ${msg}${/does not exist/.test(msg) ? " — run db/supabase_setup.sql in the Supabase SQL editor" : ""}`;
  }
  const ok = String(checks.database).startsWith("connected") && checks.SESSION_SECRET === "set";
  return NextResponse.json({ ok, checks, integrations: integrationStatus() }, { status: ok ? 200 : 500 });
}

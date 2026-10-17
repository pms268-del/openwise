import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { runJobs } from "@/lib/jobs/handlers";

export const maxDuration = 30;

// Opportunistic queue drain while a signed-in user is waiting on background work.
// Durable: jobs live in Postgres, so this only speeds things up; Vercel Cron is the backstop.
export async function POST() {
  if (!(await getUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await runJobs(10, 20_000);
  return NextResponse.json({ processed: results.length });
}

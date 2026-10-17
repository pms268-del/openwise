import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runJobs } from "@/lib/jobs/handlers";

export const maxDuration = 60;

// Called by Vercel Cron (Authorization: Bearer $CRON_SECRET) to drain the durable job queue.
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ results: await runJobs(20, 50_000) });
}

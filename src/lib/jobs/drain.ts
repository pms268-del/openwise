import { after } from "next/server";
import { runJobs } from "./handlers";

/** After the response is sent, drain the durable queue until empty (bounded by time, not count).
 *  Anything left over is picked up by /api/jobs/kick (waiting pages) or the Vercel Cron backstop. */
export function drainSoon() {
  after(() => runJobs(50, 25_000).catch((e) => console.error("[jobs] drain failed", e)));
}

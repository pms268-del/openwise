// Local/long-running worker alternative to Vercel Cron: polls the durable job queue.
import { runJobs } from "../src/lib/jobs/handlers";
async function loop() {
  for (;;) {
    const r = await runJobs(10, 50_000);
    if (r.length) console.log(new Date().toISOString(), r);
    await new Promise((res) => setTimeout(res, r.length ? 200 : 3000));
  }
}
loop();

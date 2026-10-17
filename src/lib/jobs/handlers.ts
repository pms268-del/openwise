import { claim, complete, fail } from "./queue";
import { runMarketResearch } from "../services/research";
import { processCallExtraction } from "../services/outreach";
import { discoverProperties } from "../services/discovery";
import { runFeasibility } from "../services/feasibility";
import { buildFinalReport } from "../services/finalReport";

const HANDLERS: Record<string, (p: any) => Promise<unknown>> = {
  market_research: (p) => runMarketResearch(p.engagementId),
  extract_call: (p) => processCallExtraction(p.callId),
  discover_properties: (p) => discoverProperties(p.engagementId),
  run_feasibility: (p) => runFeasibility(p.engagementId, p),
  final_report: (p) => buildFinalReport(p.engagementId),
};

/** Drain up to `max` jobs or until `budgetMs` elapses (fits serverless time limits). */
export async function runJobs(max = 10, budgetMs = 50_000) {
  const worker = `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const start = Date.now();
  if (process.env.JOBS_DEBUG) console.log(`[jobs] ${worker} start`);
  const results: { id: number; type: string; ok: boolean; error?: string }[] = [];
  while (results.length < max && Date.now() - start < budgetMs) {
    const job = await claim(worker);
    if (process.env.JOBS_DEBUG) console.log(`[jobs] ${worker} claimed`, job?.id ?? null, job?.type ?? "");
    if (!job) break;
    const h = HANDLERS[job.type];
    try {
      if (!h) throw new Error(`No handler for ${job.type}`);
      await complete(job.id, await h(job.payload));
      results.push({ id: job.id, type: job.type, ok: true });
    } catch (e) {
      await fail(job.id, e as Error, job.attempts, job.max_attempts);
      results.push({ id: job.id, type: job.type, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

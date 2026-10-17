import { sql } from "../db";
import { industryConfig } from "../industries";
import { buildAssumptions, runModel, ENGINE_VERSION, type ModelResult, type LeaseTermsRow } from "../finance/model";
import { demandMultiplier, type MarketMetrics } from "../market/analysis";
import { rankComposite } from "../matching";
import { advanceEngagement, latestTerms } from "./common";

export async function runFeasibility(engagementId: string, opts: { propertyId?: string; overrides?: Record<string, number>; userId?: string } = {}) {
  const [e] = await sql`select e.*, bp.industry_code, bp.startup_budget from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${engagementId}`;
  if (e.tier !== "paid") throw new Error("Feasibility modeling requires an active paid engagement");
  const [mr] = await sql`select metrics from market_reports where engagement_id = ${engagementId} order by version desc limit 1`;
  if (!mr) throw new Error("Market research missing");
  const dm = demandMultiplier(mr.metrics as MarketMetrics);
  const cfg = industryConfig(e.industry_code);
  const props = await sql`select p.* from engagement_properties ep join properties p on p.id = ep.property_id
                          where ep.engagement_id = ${engagementId} and ep.status in ('shortlisted','recommended')
                          ${opts.propertyId ? sql`and p.id = ${opts.propertyId}` : sql``}`;
  const out: { propertyId: string; skipped?: string }[] = [];
  for (const p of props) {
    const terms = (await latestTerms(p.id)) as LeaseTermsRow | null;
    if (!terms) { out.push({ propertyId: p.id, skipped: "No approved lease terms yet" }); continue; }
    const [prev] = await sql`select version, assumptions from financial_models where engagement_id = ${engagementId} and property_id = ${p.id} order by version desc limit 1`;
    // Carry forward previous user overrides unless new ones are supplied.
    const prevOverrides = prev ? Object.fromEntries(Object.entries(prev.assumptions as Record<string, { source?: string; value?: number }>).filter(([, v]) => v?.source === "user_override").map(([k, v]) => [k, v.value as number])) : {};
    const a = buildAssumptions({ cfg, startupBudget: Number(e.startup_budget), sqft: p.sqft, facilities: p.facilities ?? {}, terms, demandFactor: dm.factor, overrides: { ...prevOverrides, ...(opts.overrides ?? {}) } });
    const res = runModel(a);
    await sql`insert into financial_models (engagement_id, property_id, version, lease_terms_id, assumptions, results, engine_version, created_by)
              values (${engagementId}, ${p.id}, ${(prev?.version ?? 0) + 1}, ${terms.id}, ${sql.json({ ...a, _demand: dm } as never)}, ${sql.json(res as never)}, ${ENGINE_VERSION}, ${opts.userId ?? null})`;
    out.push({ propertyId: p.id });
  }
  await advanceEngagement(engagementId, "feasibility");
  return out;
}

export async function latestModels(engagementId: string) {
  return sql`select distinct on (fm.property_id) fm.*, p.address, p.sqft, p.is_mock, ep.match_score, ep.status as ep_status,
               lt.status as terms_status
             from financial_models fm join properties p on p.id = fm.property_id
             join engagement_properties ep on ep.engagement_id = fm.engagement_id and ep.property_id = fm.property_id
             left join lease_terms lt on lt.id = fm.lease_terms_id
             where fm.engagement_id = ${engagementId} and ep.status in ('shortlisted','recommended')
             order by fm.property_id, fm.version desc`;
}

export function rankModels(models: { property_id: string; match_score: number | null; results: ModelResult; terms_status: string | null }[]) {
  return rankComposite(models.map((m) => {
    const b = m.results.scenarios.base;
    return { propertyId: m.property_id, match: Number(m.match_score ?? 0), ebitdaMarginPct: b.ebitdaMarginPct, budgetGap: b.budgetGap,
      breakEvenRatio: b.breakEvenDailyTransactions != null && b.dailyTransactions > 0 ? b.breakEvenDailyTransactions / b.dailyTransactions : null,
      verified: m.terms_status === "verified" };
  }));
}

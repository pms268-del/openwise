import { sql } from "../db";
import { hashKey } from "../integrations/cache";
import { finalNarrative } from "../ai/tasks";
import { unsupportedNumbers } from "../ai/client";
import type { ModelResult } from "../finance/model";
import { COMPOSITE_WEIGHTS } from "../matching";
import { latestModels, rankModels, runFeasibility } from "./feasibility";
import { advanceEngagement } from "./common";

/** Assemble the decision report. Deterministic sections are computed here; the AI only
 *  synthesizes narrative/recommendation from these compact facts. Re-uses the previous
 *  narrative when inputs are unchanged (incremental regeneration). */
export async function buildFinalReport(engagementId: string) {
  const [e] = await sql`select e.*, bp.* , e.id as eid from engagements e join business_profiles bp on bp.id = e.business_profile_id where e.id = ${engagementId}`;
  // Always model against the latest approved/verified terms before synthesizing (cheap, deterministic).
  await runFeasibility(engagementId);
  const [mr] = await sql`select version, metrics, narrative, data_sources, limitations from market_reports where engagement_id = ${engagementId} order by version desc limit 1`;
  const models = (await latestModels(engagementId)) as unknown as { property_id: string; address: string; sqft: number; is_mock: boolean; match_score: number; terms_status: string; results: ModelResult; assumptions: Record<string, unknown>; lease_terms_id: string; version: number }[];
  if (!models.length) throw new Error("No financial models for shortlisted properties. Approve lease terms and run feasibility first.");
  const ranking = rankModels(models);
  const inspections = await sql`select i.id, i.property_id, i.status, i.verified_at, i.reviewer_note, i.responses, i.checklist,
      (select count(*)::int from evidence ev where ev.inspection_id = i.id) as evidence_count
    from inspections i where i.engagement_id = ${engagementId}`;
  const terms = await sql`select lt.* from lease_terms lt where lt.id = any(${models.map((m) => m.lease_terms_id)})`;

  const properties = models.map((m) => {
    const t = terms.find((x) => x.id === m.lease_terms_id);
    const ins = inspections.find((i) => i.property_id === m.property_id && i.status === "verified");
    const s = m.results.scenarios;
    return {
      propertyId: m.property_id, address: m.address, sqft: m.sqft, isMock: m.is_mock, matchScore: m.match_score,
      verified: m.terms_status === "verified", termsStatus: m.terms_status, inspection: ins ? { id: ins.id, verifiedAt: ins.verified_at, evidenceCount: ins.evidence_count, note: ins.reviewer_note } : null,
      lease: t && { rentMonthly: t.rent_monthly, camMonthly: t.cam_monthly, nnnMonthly: t.nnn_monthly, utilitiesMonthly: t.utilities_monthly, electricityMonthly: t.electricity_monthly, securityDeposit: t.security_deposit, termMonths: t.lease_term_months, freeRentMonths: t.free_rent_months, tiAllowance: t.ti_allowance, negotiable: t.negotiable, missing: t.missing_fields, source: t.source_kind },
      base: pick(s.base), conservative: pick(s.conservative), optimistic: pick(s.optimistic),
      sensitivity: m.results.sensitivity, flags: m.results.flags, estimatedInputs: m.results.estimatedInputs, modelVersion: m.version,
    };
  });
  const content = {
    business: { name: e.business_name, concept: e.concept, targetArea: e.target_area, startupBudget: Number(e.startup_budget), maxMonthlyRent: Number(e.max_monthly_rent), timeline: e.opening_timeline },
    market: { suitabilityScore: mr.metrics.suitabilityScore, components: mr.metrics.components.map((c: { label: string; score: number | null; weight: number }) => ({ label: c.label, score: c.score, weight: c.weight })), competitorCount: mr.metrics.competitorCount, avgCompetitorRating: mr.metrics.avgCompetitorRating, demographics: mr.metrics.demographics, reportVersion: mr.version, preliminaryVerdict: mr.narrative?.preliminaryVerdict ?? null },
    properties, ranking, rankingWeights: COMPOSITE_WEIGHTS,
    dataSources: mr.data_sources, limitations: [
      ...mr.limitations,
      "Financial scenarios are deterministic projections from stated assumptions; they are not forecasts or guarantees.",
      ...(properties.some((p) => !p.verified) ? ["Some shortlisted properties have terms that are approved from outreach but not yet verified on site."] : []),
      ...(properties.some((p) => p.isMock) ? ["Some properties are SIMULATED demo records."] : []),
    ],
    evidence: { inspections: inspections.length, verifiedInspections: inspections.filter((i) => i.status === "verified").length, evidenceFiles: inspections.reduce((s, i) => s + i.evidence_count, 0) },
  };
  const aiInput = {
    business: content.business, market: { ...content.market, risks: mr.narrative?.risks ?? [] },
    properties: properties.map(({ sensitivity, ...p }) => ({ ...p, sensitivity })), ranking: ranking.map((r) => ({ propertyId: r.propertyId, composite: r.composite, rank: r.rank, components: r.components })),
    limitations: content.limitations,
  };
  const inputHash = hashKey(aiInput);
  const [prev] = await sql`select version, input_hash, narrative from final_reports where engagement_id = ${engagementId} order by version desc limit 1`;
  let narrative = prev?.input_hash === inputHash ? prev.narrative : null;
  if (!narrative) {
    try {
      const r = await finalNarrative(aiInput, engagementId);
      narrative = { ...r.data, _meta: { model: r.model, isMock: r.isMock, unsupportedNumbers: unsupportedNumbers(JSON.stringify(r.data), aiInput) } };
    } catch (err) { narrative = { recommendation: "insufficient_evidence", executiveSummary: "AI synthesis failed; deterministic sections below remain valid.", _meta: { error: (err as Error).message } }; }
  }
  // Guardrail: never recommend "proceed" on unverified terms or a loss-making conservative case.
  const recProp = properties.find((p) => p.propertyId === narrative.recommendedPropertyId) ?? properties.find((p) => p.propertyId === ranking[0]?.propertyId);
  if (narrative.recommendation === "proceed" && recProp && (!recProp.verified || recProp.conservative.ebitdaMonthly < 0)) {
    narrative.recommendation = recProp.verified ? "negotiate" : "insufficient_evidence";
    narrative._meta = { ...narrative._meta, guardrail: "Downgraded from 'proceed': unverified terms or loss-making conservative scenario." };
  }
  const version = (prev?.version ?? 0) + 1;
  const [fr] = await sql`insert into final_reports (org_id, engagement_id, version, input_hash, content, narrative, recommendation)
    values (${e.org_id}, ${engagementId}, ${version}, ${inputHash}, ${sql.json(content as never)}, ${sql.json(narrative)}, ${narrative.recommendation ?? null}) returning id`;
  await sql`insert into approvals (kind, ref_table, ref_id, engagement_id, payload) values ('final_report', 'final_reports', ${fr.id}, ${engagementId}, ${sql.json({ version, recommendation: narrative.recommendation })})`;
  await advanceEngagement(engagementId, "final_review");
  return { id: fr.id, version };
}

function pick(s: ModelResult["scenarios"]["base"]) {
  return { dailyTransactions: s.dailyTransactions, monthlyRevenue: s.monthlyRevenue, ebitdaMonthly: s.ebitdaMonthly, ebitdaMarginPct: s.ebitdaMarginPct, occupancyCostPct: s.occupancyCostPct, breakEvenDailyTransactions: s.breakEvenDailyTransactions, totalCashRequired: s.totalCashRequired, budgetGap: s.budgetGap, paybackMonth: s.paybackMonth };
}

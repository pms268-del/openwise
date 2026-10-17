import * as z from "zod/v4";

const severity = z.enum(["low", "medium", "high"]);

export const MarketNarrative = z.object({
  summary: z.string(),
  demandAssessment: z.string(),
  competitionAssessment: z.string(),
  neighborhoodCharacter: z.string(),
  risks: z.array(z.object({ category: z.enum(["competition", "demand", "cost", "regulatory", "operational", "social", "data_quality"]), description: z.string(), severity, evidence: z.array(z.string()) })),
  opportunities: z.array(z.string()),
  preliminaryVerdict: z.enum(["promising", "mixed", "challenging", "insufficient_data"]),
  questionsToResolve: z.array(z.string()),
  dataCaveats: z.array(z.string()),
});
export type MarketNarrative = z.infer<typeof MarketNarrative>;

const money = z.number().nullable();
export const LeaseExtraction = z.object({
  rent_monthly: money, rent_annual: money, rent_psf_annual: money,
  utilities_monthly: money, electricity_monthly: money, cam_monthly: money, nnn_monthly: money, re_tax_monthly: money,
  security_deposit: money, lease_term_months: z.number().nullable(), availability_date: z.string().nullable().describe("ISO date YYYY-MM-DD or null"),
  permitted_uses: z.array(z.string()), concessions: z.string().nullable(), free_rent_months: z.number().nullable(), ti_allowance: money,
  other_costs: z.array(z.object({ label: z.string(), amount: z.number(), frequency: z.enum(["monthly", "annual", "one_time"]) })),
  negotiable: z.enum(["yes", "no", "unknown"]),
  evidence: z.array(z.object({ field: z.string(), quote: z.string().describe("verbatim excerpt from transcript") })),
  ambiguities: z.array(z.string()),
});
export type LeaseExtraction = z.infer<typeof LeaseExtraction>;

export const OutreachDraft = z.object({
  emailSubject: z.string(),
  emailBody: z.string(),
  callOpening: z.string(),
  questions: z.array(z.object({ field: z.string(), question: z.string() })),
  complianceNotes: z.array(z.string()),
});
export type OutreachDraft = z.infer<typeof OutreachDraft>;

export const ChecklistAddenda = z.object({
  items: z.array(z.object({ category: z.string(), question: z.string(), type: z.enum(["bool", "number", "text", "photo"]), required: z.boolean(), rationale: z.string() })),
});

export const FinalNarrative = z.object({
  executiveSummary: z.string(),
  recommendation: z.enum(["proceed", "negotiate", "change_location", "revise_business", "reject", "insufficient_evidence"]),
  recommendedPropertyId: z.string().nullable(),
  rationale: z.string(),
  perProperty: z.array(z.object({ propertyId: z.string(), assessment: z.string(), negotiationPoints: z.array(z.string()), dealBreakers: z.array(z.string()) })),
  risks: z.array(z.object({ category: z.enum(["financial", "social", "economic", "regulatory", "operational"]), description: z.string(), severity, mitigation: z.string(), evidence: z.array(z.string()) })),
  uncertainties: z.array(z.string()),
  nextSteps: z.array(z.string()),
});
export type FinalNarrative = z.infer<typeof FinalNarrative>;

// AI task definitions. Inputs are compact, pre-computed structures (never raw datasets);
// all arithmetic is done upstream in deterministic code and passed in as facts.
import { aiStructured } from "./client";
import { ChecklistAddenda, FinalNarrative, LeaseExtraction, MarketNarrative, OutreachDraft } from "./schemas";
import { ruleExtract } from "./ruleExtract";

const fmt = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

const NO_FABRICATION = `Rules: Use ONLY facts in the input JSON. Never invent numbers, names, addresses, statistics, or probabilities of success. Quote numbers exactly as given. If data is marked mock/simulated or missing, say so and treat conclusions as provisional. Cite evidence using the input's keys (e.g. "metrics.competitorCount").`;

export async function marketNarrative(input: Record<string, unknown> & { metrics: { suitabilityScore: number | null; competitorCount: number; avgCompetitorRating: number | null; components: { label: string; score: number | null }[] }; dataSources: { source: string; status: string }[] }, engagementId: string) {
  return aiStructured({
    purpose: "market_narrative", tier: "reasoning", engagementId, schema: MarketNarrative, maxTokens: 8000,
    system: `You are a retail site-selection analyst writing a preliminary market report for a small business owner in NYC. ${NO_FABRICATION} The suitability score is a deterministic heuristic, not a success probability — describe it that way. Be concise and specific.`,
    input,
    fallback: () => {
      const m = input.metrics;
      const mock = input.dataSources.filter((d) => d.status !== "live").map((d) => d.source);
      const s = m.suitabilityScore;
      return {
        summary: `[Template output — AI synthesis not configured] Deterministic suitability score: ${s ?? "n/a"}/100 based on ${m.components.filter((c) => c.score != null).length} of ${m.components.length} scored components.`,
        demandAssessment: `Demand component score: ${m.components.find((c) => c.label.startsWith("Demand"))?.score ?? "n/a"}/100. See demographic drivers listed below.`,
        competitionAssessment: `${m.competitorCount} competing cafés found in radius; average rating ${m.avgCompetitorRating ?? "n/a"}.`,
        neighborhoodCharacter: `Commercial character score: ${m.components.find((c) => c.label.startsWith("Commercial"))?.score ?? "n/a"}/100.`,
        risks: mock.length ? [{ category: "data_quality" as const, description: `Sources running on simulated data: ${mock.join(", ")}.`, severity: "high" as const, evidence: ["dataSources"] }] : [],
        opportunities: [],
        preliminaryVerdict: mock.length ? ("insufficient_data" as const) : s == null ? ("insufficient_data" as const) : s >= 65 ? ("promising" as const) : s >= 45 ? ("mixed" as const) : ("challenging" as const),
        questionsToResolve: ["Actual asking rents for suitable ground-floor spaces in the radius", "Weekday vs weekend foot traffic at candidate blocks"],
        dataCaveats: ["Narrative generated from templates; enable ANTHROPIC_API_KEY for AI synthesis."],
      };
    },
  });
}

export async function extractLeaseTerms(transcript: string, context: { address: string }, engagementId?: string | null) {
  return aiStructured({
    purpose: "lease_extraction", tier: "extraction", engagementId, schema: LeaseExtraction, maxTokens: 4000,
    system: `Extract commercial lease terms stated in a call transcript or note about a NYC retail space. Only extract values explicitly stated; use null when not stated. Convert to the requested units only when the conversion is unambiguous (e.g. annual→monthly divide by 12); otherwise leave null and add an ambiguity. For every non-null field add an evidence item with a verbatim quote. Do not guess.`,
    input: { property: context.address, transcript },
    fallback: () => ruleExtract(transcript),
  });
}

export async function draftOutreach(input: { propertyAddress: string; contactName: string; contactKind: string; businessConcept: string; missingFields: string[]; channel: string }, engagementId?: string | null) {
  return aiStructured({
    purpose: "outreach_draft", tier: "extraction", engagementId, schema: OutreachDraft, maxTokens: 3000,
    system: `Draft a short, professional first-contact message from a commercial-space research firm to a landlord/broker about leasing availability for a small business client. Do not disclose the client's identity or budget. Do not negotiate terms, make offers, or represent the client as a broker would — those are reserved for licensed brokers. Ask only for the missing fields listed. For phone calls, the opening must identify the caller and company and state the call purpose. ${NO_FABRICATION}`,
    input,
    fallback: () => ({
      emailSubject: `Availability inquiry — ${input.propertyAddress}`,
      emailBody: `Hello ${input.contactName},\n\nI'm reaching out on behalf of SiteIQ, a location-research firm working with a small business looking for ground-floor space for a ${input.businessConcept.toLowerCase()} in the area. Is ${input.propertyAddress} currently available?\n\nIf so, could you share: ${input.missingFields.join(", ")}?\n\nThank you,\nSiteIQ Research Team\n\n[Template draft — AI not configured]`,
      callOpening: `Hi, this is [your name] calling from SiteIQ, a commercial location research firm. I'm calling about the retail space at ${input.propertyAddress} for a small-business client. Do you have a couple of minutes?`,
      questions: input.missingFields.map((f) => ({ field: f, question: `Could you tell me the ${f.replace(/_/g, " ")}?` })),
      complianceNotes: ["Ask for consent before recording the call.", "Do not negotiate or make offers — route to a licensed broker."],
    }),
  });
}

export async function checklistAddenda(input: { address: string; concept: string; unknownFacilities: string[]; termsGaps: string[]; marketRisks: string[] }, engagementId?: string | null) {
  return aiStructured({
    purpose: "inspection_checklist", tier: "extraction", engagementId, schema: ChecklistAddenda, maxTokens: 3000,
    system: `Generate up to 8 additional, property-specific on-site verification checklist items for a field agent inspecting a NYC retail space for the given concept. Focus on the listed unknowns and gaps. Items must be observable or confirmable on site. Do not duplicate standard items (photos of storefront, interior, electrical panel, restroom, water/drainage, ADA entrance).`,
    input,
    fallback: () => ({
      items: [
        ...input.unknownFacilities.map((f) => ({ category: "Facilities", question: `Verify ${f.replace(/_/g, " ")} and photograph it.`, type: "photo" as const, required: true, rationale: "Facility not yet confirmed" })),
        ...input.termsGaps.slice(0, 4).map((g) => ({ category: "Commercial terms", question: `Obtain written confirmation of ${g.replace(/_/g, " ")} from landlord/broker.`, type: "text" as const, required: true, rationale: "Missing lease term" })),
      ],
    }),
  });
}

export async function finalNarrative(input: Record<string, unknown> & { ranking: { propertyId: string; composite: number }[]; properties: { propertyId: string; address: string; base: { ebitdaMonthly: number; budgetGap: number }; conservative: { ebitdaMonthly: number }; verified: boolean }[] }, engagementId: string) {
  return aiStructured({
    purpose: "final_report", tier: "reasoning", engagementId, schema: FinalNarrative, maxTokens: 12000,
    system: `You are a senior location-strategy advisor producing a decision-ready recommendation for a small business. Inputs include deterministic market metrics, approved/verified lease terms, deterministic financial scenarios, composite rankings, and field-inspection findings. ${NO_FABRICATION} Recommendation options: proceed, negotiate, change_location, revise_business, reject, insufficient_evidence. Prefer "insufficient_evidence" or "negotiate" over "proceed" when key terms are unverified or the conservative scenario is loss-making. Never state probabilities of success. Negotiation itself must be handled by a licensed broker — frame negotiation points as items to hand to the broker.`,
    input,
    fallback: () => {
      const top = input.ranking[0];
      const p = input.properties.find((x) => x.propertyId === top?.propertyId);
      const rec = !p ? "insufficient_evidence" : !p.verified ? "insufficient_evidence" : p.base.ebitdaMonthly <= 0 ? "reject" : p.conservative.ebitdaMonthly < 0 || p.base.budgetGap < 0 ? "negotiate" : "proceed";
      return {
        executiveSummary: `[Template output — AI synthesis not configured] Top-ranked property by composite score: ${p?.address ?? "none"} (${top?.composite ?? "n/a"}). Rule-based recommendation: ${rec}.`,
        recommendation: rec as FinalNarrative["recommendation"],
        recommendedPropertyId: top?.propertyId ?? null,
        rationale: "Rule: insufficient_evidence if top property unverified; reject if base-case EBITDA ≤ 0; negotiate if conservative case loses money or budget gap is negative; otherwise proceed.",
        perProperty: input.properties.map((x) => ({ propertyId: x.propertyId, assessment: `${x.address}: base EBITDA ${fmt(x.base.ebitdaMonthly)}/mo; conservative ${fmt(x.conservative.ebitdaMonthly)}/mo; budget surplus/gap ${fmt(x.base.budgetGap)}.${x.verified ? " Terms verified on site." : " Terms not yet verified on site."}`, negotiationPoints: [], dealBreakers: [] })),
        risks: [], uncertainties: ["Template mode: qualitative risk synthesis requires AI."], nextSteps: ["Review deterministic sections", "Hand negotiation points to licensed broker"],
      };
    },
  });
}

// Deterministic market metrics and site-suitability scoring. No LLM involvement:
// every number here is reproducible from the inputs and the published weights below.
import type { Competitor } from "../integrations/google";
import type { Demographics } from "../integrations/census";
import type { NeighborhoodLandUse, PermittedFoodService } from "../integrations/nycOpenData";

export const SCORING_VERSION = "suitability-v1";
export const WEIGHTS = { demand: 0.35, competition: 0.25, commercialCharacter: 0.2, rentFit: 0.2 } as const;

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const lerp = (x: number, x0: number, x1: number) => clamp(((x - x0) / (x1 - x0)) * 100);
const r1 = (x: number) => Math.round(x * 10) / 10;

export type MarketInputs = {
  radiusM: number;
  competitors: Competitor[];
  demographics: Demographics | null;
  landUse: NeighborhoodLandUse | null;
  foodService: PermittedFoodService | null;
  maxMonthlyRent: number;
  rentBenchmark: { medianMonthlyRent: number; sampleSize: number } | null; // from approved lease terms in our DB
};

export type Component = { key: string; label: string; score: number | null; weight: number; drivers: string[] };

export function computeMarketMetrics(inp: MarketInputs) {
  const areaKm2 = (Math.PI * inp.radiusM ** 2) / 1e6;
  const rated = inp.competitors.filter((c) => c.rating != null);
  const avgRating = rated.length ? r1(rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length) : null;
  const totalReviews = inp.competitors.reduce((s, c) => s + (c.userRatingCount ?? 0), 0);
  const within250 = inp.competitors.filter((c) => c.distanceM <= 250).length;
  const competitorDensity = r1(inp.competitors.length / areaKm2);
  const highRated = inp.competitors.filter((c) => (c.rating ?? 0) >= 4.5 && (c.userRatingCount ?? 0) >= 200).length;

  const d = inp.demographics;
  const demandDrivers: string[] = [];
  const demandParts: number[] = [];
  if (d?.populationDensityPerKm2 != null) { demandParts.push(lerp(d.populationDensityPerKm2, 5000, 40000)); demandDrivers.push(`Residential density ${d.populationDensityPerKm2.toLocaleString()}/km²`); }
  if (d?.medianHouseholdIncome != null) { demandParts.push(lerp(d.medianHouseholdIncome, 40000, 150000)); demandDrivers.push(`Median household income $${d.medianHouseholdIncome.toLocaleString()}`); }
  if (d?.bachelorsOrHigherPct != null) { demandParts.push(lerp(d.bachelorsOrHigherPct, 15, 75)); demandDrivers.push(`${d.bachelorsOrHigherPct}% bachelor's+`); }
  if (d?.transitCommutePct != null) { demandParts.push(lerp(d.transitCommutePct, 30, 75)); demandDrivers.push(`${d.transitCommutePct}% commute by transit (foot-traffic proxy)`); }
  // Review volume of nearby cafés is a revealed-demand signal.
  demandParts.push(lerp(totalReviews / Math.max(areaKm2, 0.1), 500, 8000));
  demandDrivers.push(`${totalReviews.toLocaleString()} competitor reviews in radius (revealed demand)`);
  const demand = demandParts.length ? r1(demandParts.reduce((a, b) => a + b, 0) / demandParts.length) : null;

  // Competition: inverted-U. Some cafés validate demand; saturation and strong incumbents penalize.
  const per = competitorDensity;
  let competition = per <= 2 ? 55 : per <= 12 ? 80 : per <= 25 ? 80 - (per - 12) * 2.5 : Math.max(10, 47.5 - (per - 25) * 1.5);
  competition -= Math.min(20, highRated * 3) + Math.min(15, within250 * 3);
  if (avgRating != null && avgRating < 4.2) competition += 8; // quality gap = opportunity
  competition = r1(clamp(competition));
  const compDrivers = [
    `${inp.competitors.length} cafés within ${inp.radiusM} m (${competitorDensity}/km²)`,
    `${within250} within 250 m`, `${highRated} strong incumbents (≥4.5★, ≥200 reviews)`,
    avgRating != null ? `Average rating ${avgRating}★` : "No ratings available",
  ];
  if (inp.foodService) compDrivers.push(`${inp.foodService.coffeeTeaEstablishments} DOHMH-permitted Coffee/Tea establishments in area`);

  const lu = inp.landUse;
  const commercialCharacter = lu
    ? r1(clamp(lerp(lu.mixedResCommercialPct + lu.commercialOfficePct, 5, 45) * 0.6 + lerp(lu.retailAreaSqft, 100000, 1200000) * 0.4))
    : null;
  const ccDrivers = lu ? [`${lu.mixedResCommercialPct}% mixed res/commercial lots`, `${lu.commercialOfficePct}% commercial/office lots`, `${lu.retailAreaSqft.toLocaleString()} sq ft retail floor area`, `Zoning: ${lu.dominantZoning.join(", ")}`] : [];

  let rentFit: number | null = null; const rentDrivers: string[] = [];
  if (inp.rentBenchmark && inp.rentBenchmark.sampleSize >= 2) {
    const ratio = inp.maxMonthlyRent / inp.rentBenchmark.medianMonthlyRent;
    rentFit = r1(lerp(ratio, 0.6, 1.3));
    rentDrivers.push(`Max rent $${inp.maxMonthlyRent.toLocaleString()} vs median approved asking rent $${inp.rentBenchmark.medianMonthlyRent.toLocaleString()} (n=${inp.rentBenchmark.sampleSize})`);
  } else rentDrivers.push("Insufficient verified rent comparables in radius — excluded from score");

  const components: Component[] = [
    { key: "demand", label: "Demand indicators", score: demand, weight: WEIGHTS.demand, drivers: demandDrivers },
    { key: "competition", label: "Competitive opportunity", score: competition, weight: WEIGHTS.competition, drivers: compDrivers },
    { key: "commercialCharacter", label: "Commercial character", score: commercialCharacter, weight: WEIGHTS.commercialCharacter, drivers: ccDrivers },
    { key: "rentFit", label: "Rent budget fit", score: rentFit, weight: WEIGHTS.rentFit, drivers: rentDrivers },
  ];
  const used = components.filter((c) => c.score != null);
  const wsum = used.reduce((s, c) => s + c.weight, 0);
  const suitability = wsum ? r1(used.reduce((s, c) => s + (c.score as number) * c.weight, 0) / wsum) : null;

  return {
    scoringVersion: SCORING_VERSION,
    radiusM: inp.radiusM,
    areaKm2: r1(areaKm2 * 100) / 100,
    competitorCount: inp.competitors.length,
    competitorDensityPerKm2: competitorDensity,
    competitorsWithin250m: within250,
    strongIncumbents: highRated,
    avgCompetitorRating: avgRating,
    totalCompetitorReviews: totalReviews,
    demographics: d,
    landUse: lu,
    foodService: inp.foodService,
    rentBenchmark: inp.rentBenchmark,
    components,
    suitabilityScore: suitability,
    scoreCoverage: r1((wsum / 1) * 100), // % of weight backed by data
    demandIndex: demand,
  };
}
export type MarketMetrics = ReturnType<typeof computeMarketMetrics>;

/** Converts market metrics into a demand multiplier for revenue scenarios (bounded, transparent). */
export function demandMultiplier(m: Pick<MarketMetrics, "demandIndex" | "components">): { factor: number; explanation: string } {
  const demand = m.demandIndex ?? 50;
  const comp = m.components.find((c) => c.key === "competition")?.score ?? 50;
  const factor = Math.round((0.75 + (demand / 100) * 0.4 + (comp / 100 - 0.5) * 0.2) * 100) / 100; // ~0.65 – 1.25
  return { factor, explanation: `0.75 + demand(${demand})×0.004 + (competition(${comp})−50)×0.002 = ${factor}` };
}

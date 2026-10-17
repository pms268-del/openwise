import { describe, expect, it } from "vitest";
import { computeMarketMetrics, demandMultiplier } from "../src/lib/market/analysis";
import { matchProperty, rankComposite } from "../src/lib/matching";

const comp = (d: number, rating = 4.3, reviews = 100) => ({ placeId: "p" + d, name: "c", lat: 0, lng: 0, rating, userRatingCount: reviews, priceLevel: null, distanceM: d, isMock: false });

describe("market metrics", () => {
  it("excludes missing components and renormalizes weights", () => {
    const m = computeMarketMetrics({ radiusM: 800, competitors: [comp(100), comp(400)], demographics: null, landUse: null, foodService: null, maxMonthlyRent: 10000, rentBenchmark: null });
    expect(m.components.find((c) => c.key === "rentFit")!.score).toBeNull();
    expect(m.scoreCoverage).toBe(60);
    expect(m.suitabilityScore).not.toBeNull();
    expect(m.competitorsWithin250m).toBe(1);
  });
  it("penalizes saturation", () => {
    const few = computeMarketMetrics({ radiusM: 800, competitors: Array.from({ length: 10 }, (_, i) => comp(300 + i)), demographics: null, landUse: null, foodService: null, maxMonthlyRent: 1, rentBenchmark: null });
    const many = computeMarketMetrics({ radiusM: 800, competitors: Array.from({ length: 80 }, (_, i) => comp(300 + i)), demographics: null, landUse: null, foodService: null, maxMonthlyRent: 1, rentBenchmark: null });
    const c = (x: typeof few) => x.components.find((k) => k.key === "competition")!.score!;
    expect(c(many)).toBeLessThan(c(few));
    const f = demandMultiplier(few).factor;
    expect(f).toBeGreaterThan(0.6); expect(f).toBeLessThan(1.3);
  });
});

describe("matching", () => {
  it("scores rent over budget lower", () => {
    const base = { distanceM: 200, radiusM: 800, maxRent: 10000, sqft: 1000, minSqft: 800, maxSqft: 1400, facilities: { water: true }, requiredFacilities: ["water"], termsStatus: "approved", propertyStatus: "terms_collected" };
    expect(matchProperty({ ...base, rentMonthly: 8000 }).score).toBeGreaterThan(matchProperty({ ...base, rentMonthly: 13000 }).score);
  });
  it("ranks composite deterministically", () => {
    const r = rankComposite([
      { propertyId: "a", match: 60, ebitdaMarginPct: 5, budgetGap: -10000, breakEvenRatio: 0.9, verified: false },
      { propertyId: "b", match: 70, ebitdaMarginPct: 15, budgetGap: 20000, breakEvenRatio: 0.6, verified: true },
    ]);
    expect(r[0].propertyId).toBe("b"); expect(r[0].rank).toBe(1);
  });
});

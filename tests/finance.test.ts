import { describe, expect, it } from "vitest";
import { buildAssumptions, runModel, runScenario } from "../src/lib/finance/model";
import { industryConfig } from "../src/lib/industries";

const cfg = industryConfig("coffee_shop");
const terms = { id: "t1", rent_monthly: 9000, rent_annual: null, rent_psf_annual: null, utilities_monthly: 400, electricity_monthly: 900, cam_monthly: 500, nnn_monthly: null, re_tax_monthly: null, security_deposit: 27000, free_rent_months: 2, ti_allowance: 20000, other_costs: [], status: "approved" };

describe("financial model", () => {
  const a = buildAssumptions({ cfg, startupBudget: 350000, sqft: 1000, facilities: { water: true }, terms, demandFactor: 1 });

  it("uses lease terms with source attribution", () => {
    expect(a.rentMonthly).toEqual({ value: 9000, source: "lease_terms" });
    expect(a.securityDeposit.value).toBe(27000);
    expect(a.avgTicket.source).toBe("industry_default");
  });

  it("computes revenue, EBITDA and break-even deterministically", () => {
    const s = runScenario(a, 1);
    const f = cfg.finance;
    const revenue = f.baselineDailyTransactions * f.avgTicket * 30;
    expect(s.monthlyRevenue).toBe(revenue);
    const varPct = f.cogsPct + f.cardFeesPct + f.repairsPctRevenue;
    const fixed = f.laborMonthly * (1 + f.payrollBurdenPct) + (9000 + 500 + 400 + 900) + (f.marketingMonthly + f.insuranceMonthly + f.softwareMonthly + f.otherOpexMonthly);
    expect(s.ebitdaMonthly).toBe(Math.round(revenue * (1 - varPct) - fixed));
    expect(s.breakEvenDailyTransactions).toBe(Math.round(fixed / (f.avgTicket * (1 - varPct) * 30)));
    // Startup: buildout 110k - TI 20k + equipment etc, +15% contingency, + deposit
    const capex = (110000 - 20000) + 0 + 0 + 85000 + 8000 + 6000 + 12000 + 15000;
    expect(s.startupCapex).toBe(Math.round(capex * 1.15 + 27000));
  });

  it("is monotonic in volume and flags thin margins", () => {
    const r = runModel(a);
    expect(r.scenarios.conservative.ebitdaMonthly).toBeLessThan(r.scenarios.base.ebitdaMonthly);
    expect(r.scenarios.base.ebitdaMonthly).toBeLessThan(r.scenarios.optimistic.ebitdaMonthly);
    expect(r.sensitivity.find((x) => x.driver === "Rent +10%")!.deltaEbitdaMonthly).toBe(-900);
  });

  it("marks missing rent as estimated and applies overrides", () => {
    const b = buildAssumptions({ cfg, startupBudget: 1, sqft: null, facilities: {}, terms: null, demandFactor: 1, overrides: { avgTicket: 9 } });
    expect(b.rentMonthly.source).toBe("estimated");
    expect(b.avgTicket).toEqual({ value: 9, source: "user_override" });
    expect(b.plumbingRetrofit.value).toBeGreaterThan(0); // unverified water → allowance
    expect(runModel(b).flags.some((f) => f.includes("exceeds startup budget"))).toBe(true);
  });
});

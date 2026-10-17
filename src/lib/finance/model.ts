// Deterministic financial feasibility engine. Pure functions only — no LLM arithmetic.
// Every assumption carries a `source` so reports can show where each number came from.
import type { IndustryConfig } from "../industries";

export const ENGINE_VERSION = "fin-v1";

export type Src = "lease_terms" | "verified_inspection" | "industry_default" | "estimated" | "user_override" | "market_adjusted";
export type Assumption = { value: number; source: Src; note?: string };
type A = Assumption;

export type Assumptions = {
  sqft: A;
  avgTicket: A;
  dailyTransactionsBase: A;
  scenarioMultipliers: { conservative: number; base: number; optimistic: number };
  operatingDaysPerMonth: A;
  cogsPct: A; laborMonthly: A; payrollBurdenPct: A; cardFeesPct: A; marketingMonthly: A;
  insuranceMonthly: A; softwareMonthly: A; repairsPctRevenue: A; otherOpexMonthly: A;
  rentMonthly: A; camMonthly: A; nnnMonthly: A; reTaxMonthly: A; utilitiesMonthly: A; electricityMonthly: A; otherOccupancyMonthly: A;
  buildout: A; ventingRetrofit: A; plumbingRetrofit: A; equipment: A; initialInventory: A; permitsLicenses: A;
  professionalFees: A; preOpeningLabor: A; securityDeposit: A; tiAllowance: A; contingencyPct: A; workingCapitalMonths: A;
  freeRentMonths: A;
  rampCurve: number[];
  startupBudget: number;
  horizonMonths: number;
};

const round = (x: number, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; };

export function runScenario(a: Assumptions, multiplier: number) {
  const v = (x: A) => x.value;
  const daily = v(a.dailyTransactionsBase) * multiplier;
  const revenue = daily * v(a.avgTicket) * v(a.operatingDaysPerMonth);
  const variablePct = v(a.cogsPct) + v(a.cardFeesPct) + v(a.repairsPctRevenue);
  const labor = v(a.laborMonthly) * (1 + v(a.payrollBurdenPct));
  const occupancy = v(a.rentMonthly) + v(a.camMonthly) + v(a.nnnMonthly) + v(a.reTaxMonthly) + v(a.utilitiesMonthly) + v(a.electricityMonthly) + v(a.otherOccupancyMonthly);
  const otherFixed = v(a.marketingMonthly) + v(a.insuranceMonthly) + v(a.softwareMonthly) + v(a.otherOpexMonthly);
  const fixed = labor + occupancy + otherFixed;
  const cogs = revenue * v(a.cogsPct);
  const ebitda = revenue * (1 - variablePct) - fixed;
  const contributionPerTxn = v(a.avgTicket) * (1 - variablePct);
  const breakEvenDailyTxns = contributionPerTxn > 0 ? fixed / (contributionPerTxn * v(a.operatingDaysPerMonth)) : Infinity;

  const capexBeforeContingency = Math.max(0, v(a.buildout) - v(a.tiAllowance)) + v(a.ventingRetrofit) + v(a.plumbingRetrofit) + v(a.equipment) + v(a.initialInventory) + v(a.permitsLicenses) + v(a.professionalFees) + v(a.preOpeningLabor);
  const contingency = capexBeforeContingency * v(a.contingencyPct);
  const startupCapex = capexBeforeContingency + contingency + v(a.securityDeposit);
  const workingCapitalReserve = fixed * v(a.workingCapitalMonths);

  // Month-by-month operating cash flow with ramp-up and free rent.
  const months: { month: number; revenue: number; ebitda: number; cumulative: number }[] = [];
  let cum = -startupCapex, minOperatingCum = 0, opCum = 0, payback: number | null = null;
  for (let m = 1; m <= a.horizonMonths; m++) {
    const ramp = a.rampCurve[m - 1] ?? 1;
    const rev = revenue * ramp;
    const rentRelief = m <= v(a.freeRentMonths) ? v(a.rentMonthly) : 0;
    const e = rev * (1 - variablePct) - fixed + rentRelief;
    opCum += e; cum += e;
    minOperatingCum = Math.min(minOperatingCum, opCum);
    if (payback == null && cum >= 0) payback = m;
    months.push({ month: m, revenue: round(rev), ebitda: round(e), cumulative: round(cum) });
  }
  const rampFunding = -minOperatingCum;
  const totalCashRequired = startupCapex + Math.max(rampFunding, workingCapitalReserve);

  return {
    multiplier,
    dailyTransactions: round(daily),
    monthlyRevenue: round(revenue),
    annualRevenue: round(revenue * 12),
    cogs: round(cogs),
    grossMarginPct: round((1 - v(a.cogsPct)) * 100, 1),
    laborMonthly: round(labor),
    occupancyMonthly: round(occupancy),
    otherFixedMonthly: round(otherFixed),
    variableCostsMonthly: round(revenue * variablePct),
    ebitdaMonthly: round(ebitda),
    ebitdaMarginPct: revenue > 0 ? round((ebitda / revenue) * 100, 1) : null,
    occupancyCostPct: revenue > 0 ? round((occupancy / revenue) * 100, 1) : null,
    breakEvenDailyTransactions: Number.isFinite(breakEvenDailyTxns) ? round(breakEvenDailyTxns) : null,
    breakEvenMonthlyRevenue: Number.isFinite(breakEvenDailyTxns) ? round(breakEvenDailyTxns * v(a.avgTicket) * v(a.operatingDaysPerMonth)) : null,
    startupCapex: round(startupCapex),
    contingency: round(contingency),
    rampFundingNeed: round(rampFunding),
    workingCapitalReserve: round(workingCapitalReserve),
    totalCashRequired: round(totalCashRequired),
    budgetGap: round(a.startupBudget - totalCashRequired),
    paybackMonth: payback,
    cumulativeCash: months.filter((x) => x.month % 3 === 0 || x.month === 1),
  };
}
export type ScenarioResult = ReturnType<typeof runScenario>;

export function runModel(a: Assumptions) {
  const s = a.scenarioMultipliers;
  const scenarios = { conservative: runScenario(a, s.conservative), base: runScenario(a, s.base), optimistic: runScenario(a, s.optimistic) };
  const b = scenarios.base;
  // Sensitivity: rent ±10%, ticket ±10%, volume ±20% — effect on base monthly EBITDA.
  const sens = (patch: Partial<Assumptions>) => runScenario({ ...a, ...patch }, s.base).ebitdaMonthly - b.ebitdaMonthly;
  const sensitivity = [
    { driver: "Rent +10%", deltaEbitdaMonthly: sens({ rentMonthly: { ...a.rentMonthly, value: a.rentMonthly.value * 1.1 } }) },
    { driver: "Average ticket −10%", deltaEbitdaMonthly: sens({ avgTicket: { ...a.avgTicket, value: a.avgTicket.value * 0.9 } }) },
    { driver: "Transactions −20%", deltaEbitdaMonthly: sens({ dailyTransactionsBase: { ...a.dailyTransactionsBase, value: a.dailyTransactionsBase.value * 0.8 } }) },
    { driver: "Labor +10%", deltaEbitdaMonthly: sens({ laborMonthly: { ...a.laborMonthly, value: a.laborMonthly.value * 1.1 } }) },
  ];
  const flags: string[] = [];
  if (b.occupancyCostPct != null && b.occupancyCostPct > 15) flags.push(`Occupancy cost is ${b.occupancyCostPct}% of base revenue (common café guideline: ≤10–15%).`);
  if (b.budgetGap < 0) flags.push(`Base-case cash requirement exceeds startup budget by $${Math.abs(b.budgetGap).toLocaleString()}.`);
  if (scenarios.conservative.ebitdaMonthly < 0) flags.push("Conservative scenario is loss-making at steady state.");
  if (b.breakEvenDailyTransactions != null && b.breakEvenDailyTransactions > b.dailyTransactions * 0.85) flags.push("Break-even volume is within 15% of base-case volume — thin safety margin.");
  if (b.paybackMonth == null) flags.push(`No payback within ${a.horizonMonths}-month horizon in base case.`);
  const estimated = Object.entries(a).filter(([, x]) => typeof x === "object" && x && "source" in x && ["estimated", "industry_default"].includes((x as A).source)).map(([k]) => k);
  return { engineVersion: ENGINE_VERSION, scenarios, sensitivity, flags, estimatedInputs: estimated };
}
export type ModelResult = ReturnType<typeof runModel>;

export type LeaseTermsRow = {
  id: string; rent_monthly: number | null; rent_annual: number | null; rent_psf_annual: number | null;
  utilities_monthly: number | null; electricity_monthly: number | null; cam_monthly: number | null; nnn_monthly: number | null;
  re_tax_monthly: number | null; security_deposit: number | null; free_rent_months: number | null; ti_allowance: number | null;
  other_costs: { label: string; amount: number; frequency: string }[] | null; status: string;
};

/** Build assumptions from industry defaults + property + approved lease terms + market demand. */
export function buildAssumptions(args: {
  cfg: IndustryConfig; startupBudget: number; sqft: number | null;
  facilities: Record<string, boolean | null>; terms: LeaseTermsRow | null; demandFactor: number; overrides?: Record<string, number>;
}): Assumptions {
  const f = args.cfg.finance;
  const t = args.terms;
  const termSrc: Src = t?.status === "verified" ? "verified_inspection" : "lease_terms";
  const sqft = args.sqft ?? 1200;
  const d = (value: number, note?: string): A => ({ value, source: "industry_default", note });
  const fromTerms = (val: number | null | undefined, fallback: number, note: string): A =>
    val != null ? { value: Number(val), source: termSrc } : { value: fallback, source: "estimated", note };
  const rent = t?.rent_monthly ?? (t?.rent_annual ? t.rent_annual / 12 : t?.rent_psf_annual ? (t.rent_psf_annual * sqft) / 12 : null);
  const otherMonthly = (t?.other_costs ?? []).reduce((s, c) => s + (c.frequency === "annual" ? c.amount / 12 : c.frequency === "one_time" ? 0 : c.amount), 0);
  const a: Assumptions = {
    sqft: args.sqft != null ? { value: sqft, source: "lease_terms" } : { value: sqft, source: "estimated", note: "Property size unknown; 1,200 sq ft assumed" },
    avgTicket: d(f.avgTicket),
    dailyTransactionsBase: { value: Math.round(f.baselineDailyTransactions * args.demandFactor), source: "market_adjusted", note: `Industry baseline ${f.baselineDailyTransactions}/day × market demand factor ${args.demandFactor}` },
    scenarioMultipliers: { conservative: 0.7, base: 1, optimistic: 1.25 },
    operatingDaysPerMonth: d(30),
    cogsPct: d(f.cogsPct), laborMonthly: d(f.laborMonthly), payrollBurdenPct: d(f.payrollBurdenPct), cardFeesPct: d(f.cardFeesPct),
    marketingMonthly: d(f.marketingMonthly), insuranceMonthly: d(f.insuranceMonthly), softwareMonthly: d(f.softwareMonthly),
    repairsPctRevenue: d(f.repairsPctRevenue), otherOpexMonthly: d(f.otherOpexMonthly),
    rentMonthly: rent != null ? { value: Math.round(rent), source: termSrc } : { value: 0, source: "estimated", note: "RENT UNKNOWN — model incomplete" },
    camMonthly: fromTerms(t?.cam_monthly, 0, "CAM not provided; assumed $0 (gross lease) — confirm"),
    nnnMonthly: fromTerms(t?.nnn_monthly, 0, "NNN not provided; assumed $0 — confirm"),
    reTaxMonthly: fromTerms(t?.re_tax_monthly, 0, "RE tax pass-through not provided; assumed $0 — confirm"),
    utilitiesMonthly: fromTerms(t?.utilities_monthly, Math.round(sqft * f.utilitiesPerSqftMonthly), "Estimated from sq ft"),
    electricityMonthly: fromTerms(t?.electricity_monthly, Math.round(sqft * f.electricityPerSqftMonthly), "Estimated from sq ft"),
    otherOccupancyMonthly: { value: Math.round(otherMonthly), source: t ? termSrc : "estimated" },
    buildout: { value: Math.round(sqft * f.buildoutPerSqft), source: "estimated", note: `$${f.buildoutPerSqft}/sq ft` },
    ventingRetrofit: args.facilities.venting === false ? d(0, "Not needed for beverage-only concept; required if hot food added") : d(0),
    plumbingRetrofit: args.facilities.water === false ? d(f.plumbingRetrofit, "No water/drainage at prep area") : args.facilities.water == null ? d(Math.round(f.plumbingRetrofit / 2), "Water/drainage unverified — 50% allowance") : d(0),
    equipment: d(f.equipment), initialInventory: d(f.initialInventory), permitsLicenses: d(f.permitsLicenses),
    professionalFees: d(f.professionalFees), preOpeningLabor: d(f.preOpeningLabor),
    securityDeposit: t?.security_deposit != null ? { value: Number(t.security_deposit), source: termSrc } : { value: Math.round((rent ?? 0) * f.depositMonthsDefault), source: "estimated", note: `${f.depositMonthsDefault} months' rent assumed` },
    tiAllowance: fromTerms(t?.ti_allowance, 0, "No TI allowance assumed"),
    contingencyPct: d(f.contingencyPct), workingCapitalMonths: d(f.workingCapitalMonths),
    freeRentMonths: fromTerms(t?.free_rent_months, 0, "No free rent assumed"),
    rampCurve: f.rampCurve, startupBudget: args.startupBudget, horizonMonths: 36,
  };
  for (const [k, val] of Object.entries(args.overrides ?? {})) {
    const cur = (a as unknown as Record<string, A>)[k];
    if (cur && typeof cur === "object" && "value" in cur) (a as unknown as Record<string, A>)[k] = { value: val, source: "user_override" };
  }
  return a;
}

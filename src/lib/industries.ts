// Industry configuration. Values are planning assumptions (editable per engagement), not market data.
// Adding a vertical = adding an entry here + seeding the `industries` table.
export type IndustryConfig = {
  googlePlaceTypes: string[];
  competitorKeywords: string[];
  requiredFacilities: { key: string; label: string; critical: boolean }[];
  finance: {
    avgTicket: number;
    baselineDailyTransactions: number; // typical steady-state NYC neighborhood shop, pre-adjustment
    cogsPct: number;
    laborMonthly: number;
    payrollBurdenPct: number;
    cardFeesPct: number;
    marketingMonthly: number;
    insuranceMonthly: number;
    softwareMonthly: number;
    repairsPctRevenue: number;
    otherOpexMonthly: number;
    buildoutPerSqft: number;
    ventingRetrofit: number;
    plumbingRetrofit: number;
    equipment: number;
    initialInventory: number;
    permitsLicenses: number;
    professionalFees: number;
    preOpeningLabor: number;
    contingencyPct: number;
    workingCapitalMonths: number;
    depositMonthsDefault: number;
    utilitiesPerSqftMonthly: number;
    electricityPerSqftMonthly: number;
    rampCurve: number[]; // share of steady-state volume in months 1..n
  };
};

export const INDUSTRIES: Record<string, { name: string; config: IndustryConfig }> = {
  coffee_shop: {
    name: "Coffee shop / café",
    config: {
      googlePlaceTypes: ["coffee_shop", "cafe"],
      competitorKeywords: ["coffee", "cafe", "espresso"],
      requiredFacilities: [
        { key: "water", label: "Water supply & drainage at prep area", critical: true },
        { key: "electrical_capacity", label: "Electrical capacity for espresso machine (typically 208/240V, 30A+)", critical: true },
        { key: "grease_trap", label: "Grease interceptor (if any cooking)", critical: false },
        { key: "venting", label: "Kitchen exhaust / venting (only if hot food)", critical: false },
        { key: "ada", label: "ADA-accessible entrance & restroom", critical: true },
        { key: "restroom", label: "Customer restroom", critical: true },
        { key: "storefront", label: "Street-level storefront visibility", critical: false },
        { key: "outdoor_seating", label: "Sidewalk café eligibility", critical: false },
      ],
      finance: {
        avgTicket: 8.5,
        baselineDailyTransactions: 300,
        cogsPct: 0.28,
        laborMonthly: 22000,
        payrollBurdenPct: 0.14,
        cardFeesPct: 0.03,
        marketingMonthly: 800,
        insuranceMonthly: 450,
        softwareMonthly: 250,
        repairsPctRevenue: 0.015,
        otherOpexMonthly: 900,
        buildoutPerSqft: 110,
        ventingRetrofit: 35000,
        plumbingRetrofit: 18000,
        equipment: 85000,
        initialInventory: 8000,
        permitsLicenses: 6000,
        professionalFees: 12000,
        preOpeningLabor: 15000,
        contingencyPct: 0.15,
        workingCapitalMonths: 3,
        depositMonthsDefault: 3,
        utilitiesPerSqftMonthly: 0.35,
        electricityPerSqftMonthly: 0.9,
        rampCurve: [0.5, 0.6, 0.7, 0.8, 0.88, 0.95],
      },
    },
  },
};

export function industryConfig(code: string): IndustryConfig {
  const i = INDUSTRIES[code];
  if (!i) throw new Error(`Unknown industry ${code}`);
  return i.config;
}

export const MARKETS = {
  nyc: {
    name: "New York City",
    config: {
      center: { lat: 40.7128, lng: -74.006 },
      bounds: { south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7004 },
      censusState: "36",
      boroughCounties: { Manhattan: "061", Brooklyn: "047", Queens: "081", Bronx: "005", "Staten Island": "085" },
    },
  },
} as const;

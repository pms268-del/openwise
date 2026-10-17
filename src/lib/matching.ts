// Deterministic property ↔ business-profile match score (0–100) with explainable breakdown.
export const MATCH_VERSION = "match-v1";
const clamp = (x: number) => Math.max(0, Math.min(100, x));

export function matchProperty(args: {
  distanceM: number; radiusM: number; rentMonthly: number | null; maxRent: number;
  sqft: number | null; minSqft: number | null; maxSqft: number | null;
  facilities: Record<string, boolean | null>; requiredFacilities: string[];
  termsStatus: string | null; propertyStatus: string;
}) {
  const parts: { key: string; label: string; score: number; weight: number; note: string }[] = [];
  parts.push({ key: "location", label: "Location", weight: 0.25, score: clamp(100 - Math.max(0, args.distanceM - args.radiusM * 0.5) / (args.radiusM * 1.5) * 100), note: `${args.distanceM} m from target centroid` });
  if (args.rentMonthly == null) parts.push({ key: "rent", label: "Rent fit", weight: 0.3, score: 40, note: "Rent unknown" });
  else {
    const r = args.rentMonthly / args.maxRent;
    parts.push({ key: "rent", label: "Rent fit", weight: 0.3, score: clamp(r <= 0.85 ? 100 : r <= 1 ? 100 - (r - 0.85) * 200 : 70 - (r - 1) * 300), note: `$${Math.round(args.rentMonthly).toLocaleString()}/mo vs max $${args.maxRent.toLocaleString()}` });
  }
  if (args.sqft == null) parts.push({ key: "size", label: "Size fit", weight: 0.15, score: 50, note: "Size unknown" });
  else {
    const lo = args.minSqft ?? 0, hi = args.maxSqft ?? Infinity;
    const off = args.sqft < lo ? (lo - args.sqft) / lo : args.sqft > hi ? (args.sqft - hi) / hi : 0;
    parts.push({ key: "size", label: "Size fit", weight: 0.15, score: clamp(100 - off * 250), note: `${args.sqft.toLocaleString()} sq ft (target ${lo || "–"}–${Number.isFinite(hi) ? hi : "–"})` });
  }
  const req = args.requiredFacilities;
  const met = req.filter((k) => args.facilities[k] === true).length, missing = req.filter((k) => args.facilities[k] === false), unknown = req.filter((k) => args.facilities[k] == null);
  parts.push({ key: "facilities", label: "Facilities", weight: 0.2, score: req.length ? clamp(((met + unknown.length * 0.5) / req.length) * 100 - missing.length * 15) : 70, note: req.length ? `${met}/${req.length} confirmed${missing.length ? `; missing: ${missing.join(", ")}` : ""}${unknown.length ? `; unverified: ${unknown.join(", ")}` : ""}` : "No requirements specified" });
  const ver = args.termsStatus === "verified" ? 100 : args.termsStatus === "approved" ? 70 : args.termsStatus === "extracted" ? 40 : 20;
  parts.push({ key: "evidence", label: "Evidence quality", weight: 0.1, score: ver, note: args.termsStatus ? `Lease terms ${args.termsStatus}` : "No lease terms collected" });
  const score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) * 10) / 10;
  return { version: MATCH_VERSION, score, parts };
}

/** Rank shortlisted properties combining match score and base-case financials. */
export function rankComposite(items: { propertyId: string; match: number; ebitdaMarginPct: number | null; budgetGap: number; breakEvenRatio: number | null; verified: boolean }[]) {
  return items
    .map((i) => {
      const fin = i.ebitdaMarginPct == null ? 0 : Math.max(0, Math.min(100, (i.ebitdaMarginPct + 5) * 4));
      const budget = i.budgetGap >= 0 ? 100 : Math.max(0, 100 + (i.budgetGap / 2000));
      const safety = i.breakEvenRatio == null ? 0 : Math.max(0, Math.min(100, (1 - i.breakEvenRatio) * 250));
      const composite = Math.round((i.match * 0.35 + fin * 0.3 + budget * 0.15 + safety * 0.15 + (i.verified ? 100 : 0) * 0.05) * 10) / 10;
      return { ...i, components: { match: i.match, financial: Math.round(fin), budget: Math.round(budget), safety: Math.round(safety) }, composite };
    })
    .sort((a, b) => b.composite - a.composite)
    .map((x, idx) => ({ ...x, rank: idx + 1 }));
}
export const COMPOSITE_WEIGHTS = { match: 0.35, financialMargin: 0.3, budgetFit: 0.15, breakEvenSafety: 0.15, verified: 0.05 };

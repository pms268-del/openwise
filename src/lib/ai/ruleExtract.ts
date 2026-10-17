// Deterministic rule-based lease-term extractor. Used when no LLM is configured and as a
// cross-check signal. Every extracted value is tied to the sentence it came from.
import type { LeaseExtraction } from "./schemas";

const MONEY = /\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i;
const sentences = (t: string) => t.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
const toNum = (m: RegExpMatchArray) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
const freq = (s: string) => (/(per|a|\/)\s*(year|yr|annum)|annual|annually|yearly/i.test(s) ? "annual" : /psf|per (square|sq\.?) (foot|ft)|\/\s*sf|a foot/i.test(s) ? "psf" : "monthly");

export function ruleExtract(transcript: string): LeaseExtraction {
  const out: LeaseExtraction = {
    rent_monthly: null, rent_annual: null, rent_psf_annual: null, utilities_monthly: null, electricity_monthly: null,
    cam_monthly: null, nnn_monthly: null, re_tax_monthly: null, security_deposit: null, lease_term_months: null,
    availability_date: null, permitted_uses: [], concessions: null, free_rent_months: null, ti_allowance: null,
    other_costs: [], negotiable: "unknown", evidence: [], ambiguities: ["Rule-based extraction (AI not configured) — review every value."],
  };
  const ev = (field: string, quote: string) => out.evidence.push({ field, quote });
  const monthly = (s: string, m: RegExpMatchArray) => (freq(s) === "annual" ? Math.round(toNum(m) / 12) : toNum(m));

  for (const s of sentences(transcript)) {
    const lower = s.toLowerCase();
    const m = s.match(MONEY);
    if (m) {
      if (/\b(cam|common area)/i.test(s) && out.cam_monthly == null) { out.cam_monthly = monthly(s, m); ev("cam_monthly", s); }
      else if (/\b(nnn|triple net)/i.test(s) && out.nnn_monthly == null) { out.nnn_monthly = monthly(s, m); ev("nnn_monthly", s); }
      else if (/real estate tax|property tax|re tax/i.test(s) && out.re_tax_monthly == null) { out.re_tax_monthly = monthly(s, m); ev("re_tax_monthly", s); }
      else if (/electric/i.test(s) && out.electricity_monthly == null) { out.electricity_monthly = monthly(s, m); ev("electricity_monthly", s); }
      else if (/utilit|water|gas bill/i.test(s) && out.utilities_monthly == null) { out.utilities_monthly = monthly(s, m); ev("utilities_monthly", s); }
      else if (/deposit|security/i.test(s) && out.security_deposit == null) { out.security_deposit = toNum(m); ev("security_deposit", s); }
      else if (/\bti\b|tenant improvement|build-?out allowance/i.test(s) && out.ti_allowance == null) { out.ti_allowance = toNum(m); ev("ti_allowance", s); }
      else if (/rent|asking|lease (is|at)|going for/i.test(s) && out.rent_monthly == null && out.rent_annual == null && out.rent_psf_annual == null) {
        const f = freq(s);
        if (f === "psf") out.rent_psf_annual = toNum(m); else if (f === "annual") { out.rent_annual = toNum(m); out.rent_monthly = Math.round(toNum(m) / 12); } else out.rent_monthly = toNum(m);
        ev("rent", s);
      }
    } else {
      const months = (re: RegExp) => s.match(re);
      const dm = months(/deposit[^.]*?(\d+|one|two|three|four|six)\s*months?/i);
      if (dm && out.security_deposit == null) { out.ambiguities.push(`Deposit stated in months (“${dm[0]}”) — converted after rent is known.`); ev("security_deposit_months", s); }
    }
    const fr = s.match(/(\d+(?:\.\d+)?|one|two|three|four|six)\s*months?\s*(of\s*)?free rent/i) ?? s.match(/free rent[^.]*?(\d+|one|two|three|four|six)\s*months?/i);
    if (fr && out.free_rent_months == null) { out.free_rent_months = wordNum(fr[1]); out.concessions = s; ev("free_rent_months", s); }
    const term = s.match(/(\d+|one|two|three|five|ten|seven|fifteen)[\s-]*(year|yr)s?\b[^.]*\b(lease|term)|\b(lease|term)\b[^.]*?(\d+|one|two|three|five|ten|seven|fifteen)[\s-]*(year|yr)s?/i);
    if (term && out.lease_term_months == null) { out.lease_term_months = wordNum(term[1] ?? term[5]) * 12; ev("lease_term_months", s); }
    const avail = s.match(/available\s+(?:starting\s+|from\s+|on\s+|in\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,2},?\s*\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (avail && !out.availability_date) { const d = new Date(avail[1]); if (!isNaN(+d)) { out.availability_date = d.toISOString().slice(0, 10); ev("availability_date", s); } }
    if (/non-?negotiable|firm on|not negotiable/i.test(lower)) { out.negotiable = "no"; ev("negotiable", s); }
    else if (/negotiable|flexible|some room|open to offers/i.test(lower) && out.negotiable === "unknown") { out.negotiable = "yes"; ev("negotiable", s); }
    const uses = ["café", "cafe", "coffee", "restaurant", "food", "retail", "bakery"].filter((u) => lower.includes(u) && /(use|allowed|permit|zoned|fine for|ok for)/.test(lower));
    if (uses.length) { out.permitted_uses = [...new Set([...out.permitted_uses, ...uses.map((u) => (u === "cafe" ? "café" : u))])]; ev("permitted_uses", s); }
  }
  return out;
}

function wordNum(w: string) {
  const map: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fifteen: 15 };
  return map[w?.toLowerCase()] ?? Number(w);
}

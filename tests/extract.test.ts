import { describe, expect, it } from "vitest";
import { ruleExtract } from "../src/lib/ai/ruleExtract";
import { complianceCheck } from "../src/lib/outreach/compliance";
import { unsupportedNumbers } from "../src/lib/ai/client";
import { missingTermFields } from "../src/lib/services/common";

const T = `Landlord: The asking rent is $9,500 per month. CAM charges run about $400 a month.
Security deposit would be $28,500. We're looking for a 10-year lease. Electric is separately metered, tenants usually pay around $850 per month.
It's available starting March 1, 2027. A café use is allowed under the zoning. There's some room on the rent, it's negotiable. We can offer 3 months free rent.`;

describe("rule-based extraction", () => {
  const x = ruleExtract(T);
  it("extracts stated terms with evidence", () => {
    expect(x.rent_monthly).toBe(9500);
    expect(x.cam_monthly).toBe(400);
    expect(x.security_deposit).toBe(28500);
    expect(x.lease_term_months).toBe(120);
    expect(x.electricity_monthly).toBe(850);
    expect(x.availability_date).toBe("2027-03-01");
    expect(x.negotiable).toBe("yes");
    expect(x.free_rent_months).toBe(3);
    expect(x.permitted_uses).toContain("café");
    expect(x.evidence.find((e) => e.field === "rent")!.quote).toContain("$9,500");
  });
  it("flags missing fields", () => {
    expect(missingTermFields(x as never)).toEqual(["utilities_monthly"]);
  });
  it("handles annual rent", () => {
    expect(ruleExtract("Rent is $120,000 per year.").rent_monthly).toBe(10000);
  });
});

describe("compliance gate", () => {
  const c = { email: "a@b.c", phone: "1", do_not_contact: false, consent_ai_voice: true };
  it("blocks AI voice when disabled platform-wide", () => {
    const r = complianceCheck("phone_ai_voice", c);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join()).toMatch(/disabled/);
  });
  it("blocks do-not-contact", () => expect(complianceCheck("email", { ...c, do_not_contact: true }).allowed).toBe(false));
  it("allows human calls", () => expect(complianceCheck("phone_human", c).allowed).toBe(true));
});

describe("anti-fabrication check", () => {
  it("flags numbers absent from input", () => {
    expect(unsupportedNumbers("Rent is $9,500 and 73% of people love it", { rent: 9500 })).toEqual(["73%"]);
  });
});

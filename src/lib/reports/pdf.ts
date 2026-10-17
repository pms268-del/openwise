import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Standard PDF fonts only support WinAnsi; map common symbols and drop the rest.
const clean = (s: unknown) => String(s ?? "").replace(/[≤]/g, "<=").replace(/[≥]/g, ">=").replace(/[★]/g, "*").replace(/[×]/g, "x").replace(/[→]/g, "->").replace(/[−–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[²]/g, "2").replace(/[^\x20-\x7E\n€£é]/g, "");
const money = (n: unknown) => (n == null ? "-" : `$${Math.round(Number(n)).toLocaleString("en-US")}`);

class Writer {
  page!: PDFPage; y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) { this.newPage(); }
  newPage() { this.page = this.doc.addPage([612, 792]); this.y = 750; }
  ensure(h: number) { if (this.y - h < 50) this.newPage(); }
  text(s: unknown, o: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {}) {
    const size = o.size ?? 10, f = o.bold ? this.bold : this.font, x = 50 + (o.indent ?? 0), maxW = 512 - (o.indent ?? 0);
    for (const para of clean(s).split("\n")) {
      let line = "";
      for (const w of para.split(" ")) {
        const t = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(t, size) > maxW && line) { this.ensure(size + 4); this.page.drawText(line, { x, y: this.y, size, font: f, color: rgb(...(o.color ?? [0.1, 0.1, 0.1])) }); this.y -= size + 4; line = w; }
        else line = t;
      }
      this.ensure(size + 4); this.page.drawText(line, { x, y: this.y, size, font: f, color: rgb(...(o.color ?? [0.1, 0.1, 0.1])) }); this.y -= size + 4;
    }
  }
  h(s: string) { this.y -= 8; this.text(s, { size: 13, bold: true, color: [0.02, 0.37, 0.27] }); this.y -= 2; }
  bullets(items: unknown[]) { for (const i of items) this.text(`- ${clean(i)}`, { indent: 8 }); }
}

export async function renderFinalReportPdf(r: { version: number; status: string; content: any; narrative: any; recommendation: string; created_at: Date }) {
  const doc = await PDFDocument.create();
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  const c = r.content, n = r.narrative ?? {};
  w.text("SiteIQ Location Decision Report", { size: 18, bold: true });
  w.text(`${c.business.name} - ${c.business.concept}`, { size: 11 });
  w.text(`Target area: ${c.business.targetArea} | Budget ${money(c.business.startupBudget)} | Max rent ${money(c.business.maxMonthlyRent)}/mo | Version ${r.version} (${r.status}) | ${new Date(r.created_at).toDateString()}`, { size: 9, color: [0.4, 0.4, 0.4] });
  w.h(`Recommendation: ${String(r.recommendation).replace(/_/g, " ").toUpperCase()}`);
  w.text(n.executiveSummary); if (n.rationale) w.text(`Rationale: ${n.rationale}`);
  if (n._meta?.guardrail) w.text(`Note: ${n._meta.guardrail}`, { color: [0.6, 0.3, 0] });
  w.h("Market & competition");
  w.text(`Suitability score (heuristic, not a success probability): ${c.market.suitabilityScore ?? "n/a"}/100. ${c.market.competitorCount} cafes in radius, average rating ${c.market.avgCompetitorRating ?? "n/a"}.`);
  w.bullets(c.market.components.map((x: any) => `${x.label}: ${x.score ?? "n/a"} (weight ${Math.round(x.weight * 100)}%)`));
  w.h("Property comparison");
  for (const rk of c.ranking) {
    const p = c.properties.find((x: any) => x.propertyId === rk.propertyId);
    w.text(`#${rk.rank} ${p.address}${p.isMock ? " [SIMULATED]" : ""} - composite ${rk.composite} - terms ${p.termsStatus}${p.verified ? " (verified on site)" : ""}`, { bold: true });
    w.bullets([
      `Rent ${money(p.lease?.rentMonthly)}/mo; CAM ${money(p.lease?.camMonthly)}; NNN ${money(p.lease?.nnnMonthly)}; deposit ${money(p.lease?.securityDeposit)}; term ${p.lease?.termMonths ? p.lease.termMonths / 12 + " yrs" : "-"}; negotiable: ${p.lease?.negotiable ?? "-"}`,
      `Revenue/mo (cons/base/opt): ${money(p.conservative.monthlyRevenue)} / ${money(p.base.monthlyRevenue)} / ${money(p.optimistic.monthlyRevenue)}`,
      `EBITDA/mo (cons/base/opt): ${money(p.conservative.ebitdaMonthly)} / ${money(p.base.ebitdaMonthly)} / ${money(p.optimistic.ebitdaMonthly)}`,
      `Break-even ${p.base.breakEvenDailyTransactions} txns/day vs base ${p.base.dailyTransactions}; occupancy ${p.base.occupancyCostPct}% of revenue`,
      `Total cash required ${money(p.base.totalCashRequired)}; budget gap ${money(p.base.budgetGap)}; payback month ${p.base.paybackMonth ?? ">36"}`,
      ...p.flags.map((f: string) => `Flag: ${f}`),
    ]);
  }
  if (n.perProperty?.length) { w.h("Property assessments"); for (const p of n.perProperty) { w.text(c.properties.find((x: any) => x.propertyId === p.propertyId)?.address ?? p.propertyId, { bold: true }); w.text(p.assessment); if (p.negotiationPoints?.length) { w.text("Points for licensed broker:", { indent: 8 }); w.bullets(p.negotiationPoints); } } }
  if (n.risks?.length) { w.h("Risks"); w.bullets(n.risks.map((x: any) => `[${x.severity}] ${x.category}: ${x.description} Mitigation: ${x.mitigation}`)); }
  if (n.uncertainties?.length) { w.h("Uncertainties"); w.bullets(n.uncertainties); }
  if (n.nextSteps?.length) { w.h("Next steps"); w.bullets(n.nextSteps); }
  w.h("Evidence, sources & limitations");
  w.text(`${c.evidence.verifiedInspections}/${c.evidence.inspections} inspections verified; ${c.evidence.evidenceFiles} evidence files on record.`);
  w.bullets(c.dataSources.map((s: any) => `${s.source}: ${s.status}`));
  w.bullets(c.limitations);
  w.y -= 6; w.text("This report does not constitute brokerage, legal or financial advice. Negotiation and representation are handled by licensed real-estate brokers.", { size: 8, color: [0.4, 0.4, 0.4] });
  return doc.save();
}

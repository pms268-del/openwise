import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { isStaff, isSme } from "@/lib/authz";
import { renderFinalReportPdf } from "@/lib/reports/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [r] = await sql`select * from final_reports where id = ${id}`;
  if (!r || !(isStaff(u) || (isSme(u) && r.org_id === u.orgId && r.status === "delivered"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await renderFinalReportPdf(r as never);
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="siteiq-report-v${r.version}.pdf"` } });
}

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { isStaff, loadEngagementFor } from "@/lib/authz";
import { FinalReportView } from "@/components/FinalReportView";
import { Empty } from "@/components/ui";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  const e = await loadEngagementFor(u, id);
  if (e.tier !== "paid") redirect(`/app/e/${id}`);
  const statuses = isStaff(u) ? ["draft", "approved", "delivered"] : ["delivered"];
  const [r] = await sql`select * from final_reports where engagement_id = ${id} and status = any(${statuses}) order by version desc limit 1`;
  if (!r) return <Empty>{e.status === "final_review" ? "Your decision report is being reviewed by our analysts and will appear here once approved." : "The decision report is generated after properties are modeled and inspected."}</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><a className="btn-secondary" href={`/api/reports/${r.id}/pdf`}>Download PDF</a></div>
      <FinalReportView report={r as never} />
    </div>
  );
}

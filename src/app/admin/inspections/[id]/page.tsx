import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { assertInspectionAccess } from "@/lib/authz";
import { reviewInspectionAction } from "@/app/actions/admin";
import { InspectionView } from "@/components/InspectionView";

export default async function InspectionReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser(STAFF_ROLES);
  const i = await assertInspectionAccess(u, id);
  const [p] = await sql`select address from properties where id = ${i.property_id}`;
  const evidence = await sql`select * from evidence where inspection_id = ${id} order by created_at`;
  return (
    <div className="space-y-4">
      <h1 className="h1">Inspection · {p.address}</h1>
      <InspectionView inspection={i} evidence={evidence} />
      {i.status === "submitted" && (
        <form className="card flex flex-wrap items-center gap-2">
          <input name="note" className="input max-w-md" placeholder="Reviewer note" />
          <button formAction={reviewInspectionAction.bind(null, id, "verified")} className="btn">Verify — publish as verified evidence</button>
          <button formAction={reviewInspectionAction.bind(null, id, "rejected")} className="btn-secondary">Send back</button>
        </form>
      )}
    </div>
  );
}

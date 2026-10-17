import { sql } from "@/lib/db";
import { requireUser, FIELD_ROLES } from "@/lib/auth/session";
import { assertInspectionAccess } from "@/lib/authz";
import { submitInspectionAction } from "@/app/actions/field";
import type { ChecklistItem } from "@/lib/services/inspections";
import { InspectionView } from "@/components/InspectionView";
import { Badge, Notice, usd } from "@/components/ui";

export default async function FieldInspection({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params; const { error } = await searchParams;
  const u = await requireUser(FIELD_ROLES);
  const i = await assertInspectionAccess(u, id);
  const [p] = await sql`select address, sqft, st_y(location::geometry) as lat, st_x(location::geometry) as lng from properties where id = ${i.property_id}`;
  const [t] = await sql`select * from lease_terms where property_id = ${i.property_id} and status in ('approved','extracted','verified') order by created_at desc limit 1`;
  const evidence = await sql`select * from evidence where inspection_id = ${id} order by created_at`;
  const editable = ["assigned", "scheduled", "rejected"].includes(i.status);
  const items = i.checklist as ChecklistItem[];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div><h1 className="h1">{p.address}</h1>
        <a className="text-sm text-emerald-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank">Open in Maps</a></div>
      {i.requires_licensed_broker && <Notice tone="blue">This visit includes brokerage activity. Only the assigned licensed broker may discuss or negotiate terms on the client&apos;s behalf.</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      {i.status === "rejected" && i.reviewer_note && <Notice>Sent back by reviewer: {i.reviewer_note}</Notice>}
      {!editable ? <InspectionView inspection={i} evidence={evidence} /> : (
        <>
          <form action="/api/evidence/upload" method="post" encType="multipart/form-data" className="card space-y-2">
            <div className="h2">1. Upload photos & documents</div>
            <input type="hidden" name="inspectionId" value={id} /><input type="hidden" name="redirect" value={`/field/i/${id}`} />
            <select name="kind" className="input"><option value="photo">Photo</option><option value="document">Document (floor plan, lease draft)</option><option value="landlord_confirmation">Landlord written confirmation</option><option value="observation">Other observation</option></select>
            <input type="file" name="files" multiple accept="image/*,application/pdf,text/plain" capture="environment" className="block w-full text-sm" required />
            <input name="description" className="input" placeholder="Description (e.g. electrical panel, 200A)" />
            <button className="btn-secondary w-full">Upload</button>
            <div className="text-xs text-stone-500">{evidence.length} file(s) uploaded: {evidence.map((e) => e.filename).join(", ")}</div>
          </form>
          <form action={submitInspectionAction.bind(null, id)} className="space-y-4">
            <div className="card space-y-3"><div className="h2">2. Checklist</div>
              {items.map((c) => (
                <div key={c.id} className="border-b border-stone-100 pb-2">
                  <div className="text-sm"><span className="text-xs uppercase text-stone-500">{c.category}</span> {c.source === "ai" && <Badge tone="violet">AI-suggested</Badge>}<div>{c.question}{c.required && <span className="text-red-600"> *</span>}</div></div>
                  {c.type === "bool" && <select name={`r_${c.id}`} defaultValue={i.responses?.[c.id]?.value === true ? "yes" : i.responses?.[c.id]?.value === false ? "no" : ""} className="input mt-1"><option value="">—</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Could not verify</option></select>}
                  {c.type === "number" && <input type="number" step="any" inputMode="decimal" name={`r_${c.id}`} defaultValue={i.responses?.[c.id]?.value ?? ""} className="input mt-1" />}
                  {c.type === "text" && <textarea name={`r_${c.id}`} defaultValue={i.responses?.[c.id]?.value ?? ""} rows={2} className="input mt-1" />}
                  {c.type === "photo" && <div className="text-xs text-stone-500">Upload above; describe it below.</div>}
                  <input name={`n_${c.id}`} placeholder="Note" defaultValue={i.responses?.[c.id]?.note ?? ""} className="input mt-1 text-xs" />
                </div>))}
            </div>
            <div className="card space-y-2"><div className="h2">3. Terms confirmed with landlord/broker (optional)</div>
              <p className="muted">Only record terms the landlord or their broker confirmed today. Leave blank otherwise. Currently on file: rent {usd(t?.rent_monthly)}, CAM {usd(t?.cam_monthly)}, deposit {usd(t?.security_deposit)}.</p>
              <div className="grid grid-cols-2 gap-2">{[["rent_monthly", "Rent $/mo"], ["cam_monthly", "CAM $/mo"], ["nnn_monthly", "NNN $/mo"], ["utilities_monthly", "Utilities $/mo"], ["electricity_monthly", "Electricity $/mo"], ["security_deposit", "Deposit $"], ["lease_term_months", "Term (months)"], ["free_rent_months", "Free rent (months)"]].map(([k, l]) => (
                <div key={k}><label className="label">{l}</label><input name={`t_${k}`} type="number" step="any" inputMode="decimal" className="input" /></div>))}</div>
            </div>
            <button className="btn w-full">Submit inspection for review</button>
          </form>
        </>
      )}
    </div>
  );
}

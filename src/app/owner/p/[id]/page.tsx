import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { assertOwnerProperty } from "@/lib/authz";
import { updateOwnerPropertyAction } from "@/app/actions/owner";
import { OwnerTermsFields } from "@/components/OwnerTermsFields";
import { Notice, StatusBadge, usd } from "@/components/ui";

export default async function OwnerProperty({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params; const { saved } = await searchParams;
  const u = await requireUser(["property_owner"]);
  const p = await assertOwnerProperty(u, id);
  const terms = await sql`select * from lease_terms where property_id = ${id} order by created_at desc`;
  const [m] = await sql`select count(*)::int as n, count(*) filter (where status = 'shortlisted')::int as s from engagement_properties where property_id = ${id}`;
  const [ins] = await sql`select count(*)::int as n from inspections where property_id = ${id} and status in ('assigned','scheduled')`;
  const perms = p.owner_permissions ?? {};
  return (
    <div className="space-y-4">
      <h1 className="h1">{p.address}</h1>
      {saved && <Notice tone="green">Property submitted. Our team will review it shortly.</Notice>}
      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="card">Status: <StatusBadge status={p.status} /></div>
        <div className="card">Matched to {m.n} business searches · shortlisted by {m.s}</div>
        <div className="card">{ins.n} upcoming inspection(s)</div>
      </div>
      <form action={updateOwnerPropertyAction.bind(null, id)} className="space-y-4">
        <div className="card space-y-1 text-sm"><div className="h2">Availability & permissions</div>
          <label className="flex items-center gap-2"><input type="checkbox" name="available" defaultChecked={p.status !== "unavailable"} /> Space is available</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="share" defaultChecked={!!perms.share_with_smes} /> Share with matched businesses</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="outreach" defaultChecked={!!perms.allow_outreach} /> SiteIQ may contact me</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="inspections" defaultChecked={!!perms.allow_inspections} /> Allow on-site inspections</label>
        </div>
        <div className="card space-y-2"><div className="h2">Update terms</div><p className="muted">Submitting new terms creates a new version for review.</p><OwnerTermsFields /></div>
        <button className="btn">Save</button>
      </form>
      <div className="card"><div className="h2 mb-2">Terms history</div>
        <table className="table"><thead><tr><th>Date</th><th>Source</th><th>Rent</th><th>Deposit</th><th>Status</th></tr></thead>
          <tbody>{terms.map((t) => <tr key={t.id}><td>{new Date(t.created_at).toLocaleDateString()}</td><td>{t.source_kind}</td><td>{usd(t.rent_monthly)}</td><td>{usd(t.security_deposit)}</td><td><StatusBadge status={t.status} /></td></tr>)}</tbody></table></div>
    </div>
  );
}

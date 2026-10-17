import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { createPropertyAction } from "@/app/actions/admin";
import { Badge, Notice, StatusBadge, usd } from "@/components/ui";

export default async function PropertyCrm({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  await requireUser(STAFF_ROLES);
  const { error, q } = await searchParams;
  const rows = await sql`
    select p.id, p.address, p.borough, p.neighborhood, p.sqft, p.source_type, p.status, p.is_mock, p.off_market,
      t.rent_monthly, t.status as terms_status,
      (select count(*)::int from property_contacts pc where pc.property_id = p.id) as contacts
    from properties p left join lateral (select * from lease_terms lt where lt.property_id = p.id order by created_at desc limit 1) t on true
    ${q ? sql`where p.address ilike ${"%" + q + "%"} or p.neighborhood ilike ${"%" + q + "%"}` : sql``}
    order by p.updated_at desc limit 200`;
  return (
    <div className="space-y-4">
      <h1 className="h1">Property CRM</h1>
      {error && <Notice tone="red">{error}</Notice>}
      <form className="flex gap-2"><input name="q" defaultValue={q} className="input max-w-sm" placeholder="Search address or neighborhood" /><button className="btn-secondary">Search</button></form>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>Address</th><th>Source</th><th>Sq ft</th><th>Status</th><th>Latest terms</th><th>Contacts</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td><Link className="underline" href={`/admin/properties/${r.id}`}>{r.address}</Link> {r.is_mock && <Badge tone="amber">sim</Badge>} {r.off_market && <Badge tone="violet">off-market</Badge>}<div className="text-xs text-stone-500">{[r.neighborhood, r.borough].filter(Boolean).join(", ")}</div></td>
            <td>{r.source_type}</td><td>{r.sqft ?? "—"}</td><td><StatusBadge status={r.status} /></td><td>{r.terms_status ? <>{usd(r.rent_monthly)} <StatusBadge status={r.terms_status} /></> : "—"}</td><td>{r.contacts}</td></tr>))}</tbody></table></div>
      <details className="card"><summary className="cursor-pointer font-semibold">Add property (manual research / licensed broker referral)</summary>
        <form action={createPropertyAction} className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2"><label className="label">Address</label><input name="address" required className="input" /></div>
          <div><label className="label">Borough</label><input name="borough" className="input" /></div>
          <div><label className="label">Sq ft</label><input name="sqft" type="number" className="input" /></div>
          <div><label className="label">Lat (if no geocoder)</label><input name="lat" className="input" /></div>
          <div><label className="label">Lng</label><input name="lng" className="input" /></div>
          <div><label className="label">Source</label><select name="sourceType" className="input"><option value="manual_research">Manual research (field/phone)</option><option value="licensed_broker">Licensed broker referral</option><option value="public_record">Public record</option><option value="broker_api">Partner listing</option></select></div>
          <div><label className="label">Source reference</label><input name="sourceRef" className="input" placeholder="Broker name / listing ID / BBL" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="offMarket" /> Off-market</label>
          <div className="md:col-span-3 grid gap-3 md:grid-cols-5 border-t border-stone-100 pt-3">
            <div><label className="label">Contact name</label><input name="contactName" className="input" /></div>
            <div><label className="label">Kind</label><select name="contactKind" className="input"><option>landlord</option><option>owner</option><option>broker</option><option>property_manager</option></select></div>
            <div><label className="label">Company</label><input name="contactCompany" className="input" /></div>
            <div><label className="label">Email</label><input name="contactEmail" className="input" /></div>
            <div><label className="label">Phone</label><input name="contactPhone" className="input" /></div>
          </div>
          <div><button className="btn">Create property</button></div>
        </form>
      </details>
    </div>
  );
}

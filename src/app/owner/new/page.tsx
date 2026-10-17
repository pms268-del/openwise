import { requireUser } from "@/lib/auth/session";
import { submitPropertyAction } from "@/app/actions/owner";
import { OwnerTermsFields } from "@/components/OwnerTermsFields";
import { INDUSTRIES } from "@/lib/industries";
import { Notice } from "@/components/ui";

export default async function OwnerNew({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser(["property_owner"]);
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="h1">Submit a commercial space</h1>
      {error && <Notice tone="red">{error}</Notice>}
      <form action={submitPropertyAction} className="space-y-4">
        <div className="card grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2"><label className="label">Address</label><input name="address" required className="input" /></div>
          <div><label className="label">Borough</label><select name="borough" className="input"><option>Manhattan</option><option>Brooklyn</option><option>Queens</option><option>Bronx</option><option>Staten Island</option></select></div>
          <div><label className="label">Sq ft</label><input name="sqft" type="number" className="input" /></div>
          <div><label className="label">Latitude (optional)</label><input name="lat" className="input" /></div>
          <div><label className="label">Longitude (optional)</label><input name="lng" className="input" /></div>
          <div className="md:col-span-4"><label className="label">Facilities present</label><div className="grid gap-1 md:grid-cols-3">{INDUSTRIES.coffee_shop.config.requiredFacilities.map((f) => <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name="facilities" value={f.key} /> {f.label}</label>)}</div></div>
        </div>
        <div className="card space-y-2"><div className="h2">Commercial terms (optional)</div><OwnerTermsFields /></div>
        <div className="card space-y-1 text-sm"><div className="h2">Permissions</div>
          <label className="flex items-center gap-2"><input type="checkbox" name="share" defaultChecked /> Share this space (without my contact details) with matched businesses</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="outreach" defaultChecked /> SiteIQ may contact me about interested businesses</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="inspections" defaultChecked /> Allow scheduled on-site inspections by SiteIQ agents / licensed brokers</label>
          <p className="text-xs text-stone-500">Submitted terms are reviewed by our team before being shown. You can change permissions or mark the space unavailable at any time.</p>
        </div>
        <button className="btn">Submit property</button>
      </form>
    </div>
  );
}

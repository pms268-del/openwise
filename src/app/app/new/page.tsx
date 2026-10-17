import { requireUser } from "@/lib/auth/session";
import { createResearchAction } from "@/app/actions/sme";
import { INDUSTRIES } from "@/lib/industries";
import { Notice } from "@/components/ui";

export default async function NewResearch({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser(["sme_owner"]);
  const { error } = await searchParams;
  const facilities = INDUSTRIES.coffee_shop.config.requiredFacilities;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="h1">Tell us about your business</h1>
      <p className="muted">Your free market report covers competition, demographics and neighborhood character for the area you choose. Currently available: coffee shops in New York City.</p>
      {error && <Notice tone="red">{error}</Notice>}
      <form action={createResearchAction} className="card grid gap-4 md:grid-cols-2">
        <div><label className="label">Business name</label><input name="businessName" required className="input" placeholder="Morning Ritual Coffee" /></div>
        <div><label className="label">Business type</label><select className="input" disabled><option>Coffee shop / café (NYC)</option></select></div>
        <div className="md:col-span-2"><label className="label">Concept</label><textarea name="concept" required className="input" rows={2} placeholder="Specialty espresso bar with pastries, 20 seats, laptop-friendly mornings" /></div>
        <div><label className="label">Target area (neighborhood or address)</label><input name="targetArea" required className="input" placeholder="Williamsburg, Brooklyn" /></div>
        <div><label className="label">Search radius (meters)</label><input name="radius" type="number" defaultValue={800} min={200} max={3000} className="input" /></div>
        <div className="md:col-span-2"><label className="label">Target customers</label><input name="targetCustomers" className="input" placeholder="Young professionals, remote workers, commuters" /></div>
        <div><label className="label">Startup budget (USD)</label><input name="startupBudget" type="number" required className="input" placeholder="350000" /></div>
        <div><label className="label">Maximum monthly rent (USD)</label><input name="maxMonthlyRent" type="number" required className="input" placeholder="11000" /></div>
        <div><label className="label">Min sq ft</label><input name="minSqft" type="number" className="input" placeholder="700" /></div>
        <div><label className="label">Max sq ft</label><input name="maxSqft" type="number" className="input" placeholder="1500" /></div>
        <div><label className="label">Opening timeline</label><select name="openingTimeline" className="input"><option>0-3 months</option><option>3-6 months</option><option>6-12 months</option><option>12+ months</option></select></div>
        <div className="md:col-span-2"><label className="label">Required space & facilities</label>
          <div className="grid gap-1 md:grid-cols-2">{facilities.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name="facilities" value={f.key} defaultChecked={f.critical} /> {f.label}</label>))}</div>
        </div>
        <div className="md:col-span-2"><button className="btn">Generate free market report</button></div>
      </form>
    </div>
  );
}

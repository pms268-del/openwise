export function OwnerTermsFields() {
  const f: [string, string, string?][] = [["rent_monthly", "Asking rent $/month"], ["cam_monthly", "CAM $/month"], ["nnn_monthly", "NNN $/month"], ["re_tax_monthly", "RE tax pass-through $/month"],
    ["utilities_monthly", "Utilities est. $/month"], ["electricity_monthly", "Electricity est. $/month"], ["security_deposit", "Security deposit $"], ["lease_term_months", "Lease term (months)"]];
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {f.map(([k, l]) => <div key={k}><label className="label">{l}</label><input name={k} type="number" step="any" className="input" /></div>)}
      <div><label className="label">Available from</label><input name="availability_date" type="date" className="input" /></div>
      <div><label className="label">Permitted uses (comma-separated)</label><input name="permitted_uses" className="input" placeholder="café, retail" /></div>
      <div><label className="label">Concessions</label><input name="concessions" className="input" placeholder="2 months free rent" /></div>
      <div><label className="label">Negotiable?</label><select name="negotiable" className="input"><option value="unknown">Prefer not to say</option><option value="yes">Yes</option><option value="no">No</option></select></div>
    </div>
  );
}

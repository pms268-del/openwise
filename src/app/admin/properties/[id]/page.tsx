import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { addContactAction, createOutreachAction, logCallAction } from "@/app/actions/admin";
import { env } from "@/lib/env";
import { Badge, Notice, StatusBadge, usd } from "@/components/ui";

export default async function PropertyDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ engagement?: string; error?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  await requireUser(STAFF_ROLES);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await sql`select *, st_y(location::geometry) as lat, st_x(location::geometry) as lng from properties where id = ${id}`;
  if (!p) notFound();
  const contacts = await sql`select c.*, pc.relationship from property_contacts pc join contacts c on c.id = pc.contact_id where pc.property_id = ${id}`;
  const terms = await sql`select * from lease_terms where property_id = ${id} order by created_at desc`;
  const tasks = await sql`select ot.*, c.name as contact_name from outreach_tasks ot left join contacts c on c.id = ot.contact_id where ot.property_id = ${id} order by ot.created_at desc`;
  const calls = await sql`select cr.*, u.name as caller from call_records cr left join users u on u.id = cr.caller_user_id where cr.property_id = ${id} order by cr.created_at desc`;
  const engs = await sql`select ep.engagement_id, bp.business_name from engagement_properties ep join engagements e on e.id = ep.engagement_id join business_profiles bp on bp.id = e.business_profile_id where ep.property_id = ${id}`;
  return (
    <div className="space-y-4">
      <div><h1 className="h1">{p.address}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600"><StatusBadge status={p.status} /><Badge>{p.source_type}</Badge>{p.is_mock && <Badge tone="amber">simulated</Badge>}{p.off_market && <Badge tone="violet">off-market</Badge>}
          <span>{p.sqft ?? "?"} sq ft · {Number(p.lat).toFixed(5)}, {Number(p.lng).toFixed(5)} · {p.source_ref ?? ""}</span></div>
        <div className="text-xs text-stone-500">{p.source_license_note}</div>
        <div className="text-xs text-stone-500">Facilities: {Object.entries(p.facilities ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "none recorded"}</div>
      </div>
      {sp.error && <Notice tone="red">{sp.error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2"><div className="h2">Contacts</div>
          {contacts.map((c) => (
            <div key={c.id} className="border-b border-stone-100 pb-1 text-sm"><b>{c.name}</b> ({c.kind}{c.company ? `, ${c.company}` : ""}) {c.is_mock && <Badge tone="amber">sim</Badge>}
              <div className="text-xs text-stone-500">{c.email} · {c.phone} {c.license_number && `· lic. ${c.license_number}`}</div>
              <div className="flex gap-1 text-xs">{c.do_not_contact && <Badge tone="red">do not contact</Badge>}<Badge tone={c.consent_ai_voice ? "green" : "stone"}>AI-call consent: {c.consent_ai_voice ? "yes" : "no"}</Badge></div></div>))}
          <details><summary className="cursor-pointer text-sm">Add contact</summary>
            <form action={addContactAction.bind(null, id)} className="mt-2 grid gap-2 md:grid-cols-2 text-sm">
              <input name="name" required placeholder="Name" className="input" /><select name="kind" className="input"><option>landlord</option><option>owner</option><option>broker</option><option>property_manager</option></select>
              <input name="company" placeholder="Company" className="input" /><input name="email" placeholder="Email" className="input" /><input name="phone" placeholder="Phone" className="input" /><input name="license" placeholder="Broker license # (brokers)" className="input" />
              <label className="flex items-center gap-2"><input type="checkbox" name="dnc" /> Do not contact</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="consentAi" /> Documented prior express consent to automated/AI calls</label>
              <input name="consentMethod" placeholder="Consent method (e.g. signed form 2026-10-01)" className="input md:col-span-2" />
              <button className="btn-secondary">Add contact</button>
            </form></details>
        </div>

        <div className="card space-y-2"><div className="h2">Outreach</div>
          <form action={createOutreachAction.bind(null, id)} className="flex flex-wrap gap-2 text-sm">
            <select name="contactId" className="input max-w-[12rem]">{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select name="channel" className="input max-w-[12rem]"><option value="phone_human">Phone (human caller)</option><option value="email">Email (approval required)</option><option value="phone_ai_voice">AI voice call {env.aiVoiceEnabled ? "" : "(disabled)"}</option></select>
            <select name="engagementId" defaultValue={sp.engagement ?? ""} className="input max-w-[12rem]"><option value="">No engagement</option>{engs.map((e) => <option key={e.engagement_id} value={e.engagement_id}>{e.business_name}</option>)}</select>
            <button className="btn-secondary">Prepare outreach</button>
          </form>
          {tasks.map((t) => (
            <details key={t.id} className="border-b border-stone-100 pb-1 text-sm"><summary className="cursor-pointer">{t.channel} → {t.contact_name ?? "—"} <StatusBadge status={t.status} /> <span className="text-xs text-stone-400">{new Date(t.created_at).toLocaleDateString()}</span></summary>
              {t.compliance?.reasons?.length > 0 && <ul className="ml-4 list-disc text-xs text-stone-600">{t.compliance.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
              {t.channel === "email" ? <pre className="mt-1 whitespace-pre-wrap rounded bg-stone-50 p-2 font-sans text-xs">{t.ai_draft?.emailSubject}{"\n\n"}{t.ai_draft?.emailBody}</pre>
                : <div className="mt-1 rounded bg-stone-50 p-2 text-xs"><div className="font-semibold">Call script</div><p>{t.ai_draft?.callOpening}</p><ol className="ml-4 list-decimal">{(t.ai_draft?.questions ?? []).map((q: { field: string; question: string }) => <li key={q.field}>{q.question}</li>)}</ol></div>}
            </details>))}
        </div>
      </div>

      <div className="card space-y-2"><div className="h2">Log a call / landlord conversation</div>
        <p className="muted">Paste a transcript (only if the call was recorded with consent) or your call notes. Terms are extracted into a structured record that requires human approval before clients see it.</p>
        <form action={logCallAction.bind(null, id)} className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <select name="taskId" className="input max-w-xs"><option value="">No outreach task</option>{tasks.filter((t) => ["approved", "in_progress"].includes(t.status) && t.channel !== "phone_ai_voice").map((t) => <option key={t.id} value={t.id}>{t.channel} → {t.contact_name}</option>)}</select>
            <select name="contactId" className="input max-w-xs">{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select name="source" className="input max-w-xs"><option value="manual_notes">Caller notes</option><option value="uploaded_transcript">Recorded-call transcript</option></select>
            <label className="flex items-center gap-2"><input type="checkbox" name="recordingConsent" /> Contact consented to recording</label>
          </div>
          <textarea name="transcript" rows={6} className="input" placeholder="e.g. Asking rent is $9,500 per month. CAM about $400/month. Security deposit $28,500. 10-year lease. Available starting March 1, 2027. Café use is allowed. Rent is negotiable." />
          <button className="btn">Save & extract terms</button>
        </form>
        {calls.map((c) => <div key={c.id} className="border-t border-stone-100 pt-1 text-xs">{new Date(c.created_at).toLocaleString()} · {c.caller} · {c.transcript_source} · consent to record: {String(c.recording_consent)} · extraction <StatusBadge status={c.extraction_status} /></div>)}
      </div>

      <div className="card overflow-x-auto"><div className="h2 mb-2">Lease terms history</div>
        <table className="table"><thead><tr><th>When</th><th>Source</th><th>Rent</th><th>CAM/NNN</th><th>Deposit</th><th>Term</th><th>Negotiable</th><th>Missing</th><th>Status</th></tr></thead>
          <tbody>{terms.map((t) => <tr key={t.id}><td>{new Date(t.created_at).toLocaleDateString()}</td><td>{t.source_kind}<div className="text-xs text-stone-400">{t.extracted_by}</div></td><td>{usd(t.rent_monthly)}</td><td>{usd(t.cam_monthly)} / {usd(t.nnn_monthly)}</td><td>{usd(t.security_deposit)}</td><td>{t.lease_term_months ?? "—"}</td><td>{t.negotiable}</td><td className="text-xs">{t.missing_fields?.join(", ")}</td><td><StatusBadge status={t.status} /></td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

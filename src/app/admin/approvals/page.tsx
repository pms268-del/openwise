import Link from "next/link";
import { sql } from "@/lib/db";
import { requireUser, STAFF_ROLES } from "@/lib/auth/session";
import { decideApprovalAction } from "@/app/actions/admin";
import { Badge, Empty, Notice } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";

const TERM_FIELDS = ["rent_monthly", "cam_monthly", "nnn_monthly", "re_tax_monthly", "utilities_monthly", "electricity_monthly", "security_deposit", "lease_term_months", "free_rent_months", "ti_allowance"];

export default async function Approvals() {
  await requireUser(STAFF_ROLES);
  const [{ n: extracting }] = await sql`select count(*)::int as n from jobs where type = 'extract_call' and status in ('queued','running')`;
  const items = await sql`select a.*, u.name as requester from approvals a left join users u on u.id = a.requested_by where a.status = 'pending' order by a.created_at`;
  const termIds = items.filter((a) => a.kind === "lease_terms").map((a) => a.ref_id);
  const terms = termIds.length ? await sql`select lt.*, p.address, cr.transcript from lease_terms lt join properties p on p.id = lt.property_id left join call_records cr on cr.id = lt.source_ref where lt.id = any(${termIds})` : [];
  const taskIds = items.filter((a) => a.kind === "outreach_message" || a.kind === "ai_voice_call").map((a) => a.ref_id);
  const tasks = taskIds.length ? await sql`select ot.*, p.address, c.name as contact_name, c.email from outreach_tasks ot join properties p on p.id = ot.property_id left join contacts c on c.id = ot.contact_id where ot.id = any(${taskIds})` : [];
  return (
    <div className="space-y-4">
      <h1 className="h1">Human approvals</h1>
      <p className="muted">AI-extracted lease terms, outbound outreach messages, AI-voice requests, brokerage handoffs and final reports require a human decision before they reach clients or third parties.</p>
      {extracting > 0 && <><AutoRefresh /><Notice tone="blue">{extracting} call transcript(s) being processed — new items will appear here automatically.</Notice></>}
      {items.length === 0 && <Empty>Nothing waiting for approval.</Empty>}
      {items.map((a) => {
        const t = terms.find((x) => x.id === a.ref_id), o = tasks.find((x) => x.id === a.ref_id);
        return (
          <div key={a.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="violet">{a.kind.replace(/_/g, " ")}</Badge><span className="font-semibold">{t?.address ?? o?.address ?? a.payload?.address ?? ""}</span>
              <span className="ml-auto text-xs text-stone-500">{new Date(a.created_at).toLocaleString()} {a.requester && `· by ${a.requester}`}</span></div>
            {t && (
              <form className="space-y-3">
                <div className="text-xs text-stone-500">Extracted by {t.extracted_by} from {t.source_kind}. Edit values before approving if the transcript says otherwise.</div>
                <div className="grid gap-2 md:grid-cols-5">{TERM_FIELDS.map((f) => (
                  <div key={f}><label className="label">{f.replace(/_/g, " ")}</label><input name={`edit_${f}`} defaultValue={t[f] ?? ""} className="input" />
                    {t.field_evidence?.[f === "rent_monthly" ? "rent" : f]?.quote && <div className="mt-0.5 text-[11px] italic text-stone-500">“{t.field_evidence[f === "rent_monthly" ? "rent" : f].quote.slice(0, 120)}”{t.field_evidence[f === "rent_monthly" ? "rent" : f].verified_in_source === false && <span className="text-red-700"> (quote not found in transcript!)</span>}</div>}</div>))}</div>
                <div className="text-sm">Negotiable: <b>{t.negotiable}</b> · Permitted uses: {t.permitted_uses?.join(", ") || "—"} · Availability: {t.availability_date ? new Date(t.availability_date).toDateString() : "—"} · Concessions: {t.concessions ?? "—"}</div>
                {t.missing_fields?.length > 0 && <div className="text-sm text-amber-800">Missing: {t.missing_fields.join(", ")}</div>}
                {t.field_evidence?._ambiguities?.length > 0 && <ul className="ml-4 list-disc text-xs text-stone-600">{t.field_evidence._ambiguities.map((x: string) => <li key={x}>{x}</li>)}</ul>}
                {t.transcript && <details><summary className="cursor-pointer text-sm">Transcript</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs">{t.transcript}</pre></details>}
                <div className="flex gap-2"><input name="reason" className="input max-w-sm" placeholder="Note (optional)" />
                  <button formAction={decideApprovalAction.bind(null, a.id, "approved")} className="btn">Approve terms</button>
                  <button formAction={decideApprovalAction.bind(null, a.id, "rejected")} className="btn-secondary">Reject</button></div>
              </form>
            )}
            {o && (
              <form className="space-y-2 text-sm">
                <div>Channel: <b>{o.channel}</b> · To: {o.contact_name} {o.email && `<${o.email}>`}</div>
                <div className="rounded bg-stone-50 p-3"><div className="font-semibold">{o.ai_draft?.emailSubject}</div><pre className="whitespace-pre-wrap font-sans">{o.ai_draft?.emailBody}</pre></div>
                <ul className="ml-4 list-disc text-xs text-stone-600">{(o.compliance?.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
                <div className="flex gap-2"><input name="reason" className="input max-w-sm" placeholder="Note (optional)" />
                  <button formAction={decideApprovalAction.bind(null, a.id, "approved")} className="btn" disabled={o.status === "blocked"}>Approve</button>
                  <button formAction={decideApprovalAction.bind(null, a.id, "rejected")} className="btn-secondary">Reject</button></div>
              </form>
            )}
            {(a.kind === "final_report" || a.kind === "brokerage_handoff") && (
              <form className="flex flex-wrap items-center gap-2 text-sm">
                {a.kind === "final_report" ? <span>Version {a.payload.version} · recommendation <b>{a.payload.recommendation}</b> — <Link className="underline" href={`/admin/e/${a.engagement_id}`}>review in workbench</Link></span>
                  : <span>Hand negotiation to licensed broker · {a.payload.note}</span>}
                <button formAction={decideApprovalAction.bind(null, a.id, "approved")} className="btn ml-auto">Approve</button>
                <button formAction={decideApprovalAction.bind(null, a.id, "rejected")} className="btn-secondary">Reject</button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

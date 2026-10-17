import type { ChecklistItem } from "@/lib/services/inspections";
import { Badge, StatusBadge } from "./ui";

export function InspectionView({ inspection, evidence }: { inspection: any; evidence: any[] }) {
  const items = inspection.checklist as ChecklistItem[];
  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto"><table className="table"><thead><tr><th>Item</th><th>Response</th><th>Source</th></tr></thead>
        <tbody>{items.map((c) => { const r = inspection.responses?.[c.id]; return (
          <tr key={c.id}><td><span className="text-xs uppercase text-stone-500">{c.category}</span><div>{c.question} {c.required && <span className="text-red-600">*</span>}</div></td>
            <td>{r ? <>{String(r.value)}{r.note && <div className="text-xs text-stone-500">{r.note}</div>}</> : <span className="text-stone-400">—</span>}</td><td><Badge>{c.source}</Badge></td></tr>); })}</tbody></table></div>
      {inspection.terms_confirmed && <div className="card text-sm"><div className="font-semibold">Terms confirmed on site</div>{Object.entries(inspection.terms_confirmed).filter(([, v]) => v !== null && v !== "").map(([k, v]) => <div key={k}>{k.replace(/_/g, " ")}: <b>{String(v)}</b></div>)}</div>}
      <div className="card"><div className="font-semibold">Evidence ({evidence.length})</div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">{evidence.map((e) => (
          <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" className="block rounded border border-stone-200 p-1 text-xs">
            {e.mime_type?.startsWith("image/") ? <img src={`/api/evidence/${e.id}`} alt={e.filename} className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-stone-50">📄</div>}
            <div className="truncate">{e.kind}: {e.filename}</div><div className="truncate text-stone-400">sha256 {e.sha256.slice(0, 12)}…</div></a>))}</div>
      </div>
      <div className="text-xs text-stone-500">Status <StatusBadge status={inspection.status} /> {inspection.reviewer_note && `· reviewer: ${inspection.reviewer_note}`}</div>
    </div>
  );
}

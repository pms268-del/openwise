const STEPS = [
  { key: "research", label: "Market research", statuses: ["draft", "researching"] },
  { key: "report", label: "Free report", statuses: ["free_report_ready", "payment_pending"] },
  { key: "discovery", label: "Property discovery", statuses: ["active", "discovery"] },
  { key: "feasibility", label: "Feasibility", statuses: ["feasibility"] },
  { key: "fieldwork", label: "Field verification", statuses: ["fieldwork"] },
  { key: "final", label: "Decision report", statuses: ["final_review", "delivered"] },
];
export function Stepper({ status }: { status: string }) {
  const idx = STEPS.findIndex((s) => s.statuses.includes(status));
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s.key} className={`rounded-full px-3 py-1 ${i < idx || status === "delivered" ? "bg-emerald-100 text-emerald-800" : i === idx ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-500"}`}>
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

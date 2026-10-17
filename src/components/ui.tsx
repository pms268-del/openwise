import type { ReactNode } from "react";

export function Badge({ children, tone = "stone" }: { children: ReactNode; tone?: "stone" | "green" | "amber" | "red" | "blue" | "violet" }) {
  const t = { stone: "bg-stone-100 text-stone-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800", blue: "bg-sky-100 text-sky-800", violet: "bg-violet-100 text-violet-800" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function SourceBadge({ status }: { status: string }) {
  if (status === "live") return <Badge tone="green">live</Badge>;
  if (status === "mock") return <Badge tone="amber">simulated</Badge>;
  return <Badge tone="stone">{status.replace(/_/g, " ")}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ["approved", "verified", "delivered", "done", "paid", "shortlisted", "recommended", "completed"].includes(status) ? "green"
    : ["rejected", "blocked", "failed", "cancelled", "unavailable"].includes(status) ? "red"
    : ["pending_approval", "pending", "extracted", "submitted", "payment_pending", "final_review"].includes(status) ? "amber" : "blue";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-stone-400">n/a</span>;
  const c = score >= 65 ? "bg-emerald-600" : score >= 45 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded bg-stone-200"><div className={`h-2 rounded ${c}`} style={{ width: `${Math.max(2, score)}%` }} /></div>
      <span className="text-xs tabular-nums">{score}</span>
    </div>
  );
}

export const usd = (n: number | null | undefined, opts: { compact?: boolean } = {}) =>
  n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: opts.compact ? "compact" : "standard" });

export function Notice({ tone = "amber", children }: { tone?: "amber" | "blue" | "red" | "green"; children: ReactNode }) {
  const t = { amber: "border-amber-300 bg-amber-50 text-amber-900", blue: "border-sky-300 bg-sky-50 text-sky-900", red: "border-red-300 bg-red-50 text-red-900", green: "border-emerald-300 bg-emerald-50 text-emerald-900" }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${t}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children}</div>;
}

import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadEngagementFor } from "@/lib/authz";
import { Stepper } from "@/components/Stepper";
import { Badge } from "@/components/ui";

export default async function EngagementLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  const e = await loadEngagementFor(u, id);
  const tabs: [string, string, boolean][] = [
    ["", "Market report", true], ["/properties", "Properties", e.tier === "paid"], ["/financials", "Financials", e.tier === "paid"], ["/report", "Decision report", e.tier === "paid"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="h1">{e.business_name}</h1>
          <div className="muted">{e.concept} · {e.target_area} · radius {e.target_radius_m} m</div>
        </div>
        <Badge tone={e.tier === "paid" ? "green" : "stone"}>{e.tier === "paid" ? "Paid research" : "Free tier"}</Badge>
      </div>
      <Stepper status={e.status} />
      <nav className="flex gap-1 border-b border-stone-200">
        {tabs.map(([path, label, enabled]) => enabled
          ? <Link key={path} href={`/app/e/${id}${path}`} className="rounded-t-lg px-3 py-2 text-sm text-stone-700 hover:bg-white">{label}</Link>
          : <span key={path} className="px-3 py-2 text-sm text-stone-400" title="Available after activating paid research">{label} 🔒</span>)}
      </nav>
      {children}
    </div>
  );
}

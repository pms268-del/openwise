import Link from "next/link";
import { getUser, homeFor } from "@/lib/auth/session";
import { logoutAction } from "@/app/actions/auth";

const LINKS: Record<string, [string, string][]> = {
  sme_owner: [["/app", "My research"], ["/app/new", "New research"]],
  sme_member: [["/app", "My research"]],
  admin: [["/admin", "Pipeline"], ["/admin/approvals", "Approvals"], ["/admin/properties", "Property CRM"], ["/admin/outreach", "Outreach"], ["/admin/inspections", "Inspections"], ["/admin/costs", "Costs"], ["/admin/audit", "Audit"]],
  analyst: [["/admin", "Pipeline"], ["/admin/approvals", "Approvals"], ["/admin/properties", "Property CRM"], ["/admin/outreach", "Outreach"], ["/admin/inspections", "Inspections"]],
  field_agent: [["/field", "My inspections"]],
  broker: [["/field", "My assignments"]],
  property_owner: [["/owner", "My properties"], ["/owner/new", "Submit property"]],
};

export async function Nav() {
  const u = await getUser();
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <Link href={u ? homeFor(u.role) : "/"} className="text-lg font-bold text-emerald-800">SiteIQ</Link>
        {u && (LINKS[u.role] ?? []).map(([href, label]) => (
          <Link key={href} href={href} className="text-sm text-stone-600 hover:text-stone-900">{label}</Link>
        ))}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {u ? (
            <>
              <span className="text-stone-500">{u.name} · <span className="font-mono text-xs">{u.role}</span></span>
              <form action={logoutAction}><button className="text-stone-600 hover:underline">Sign out</button></form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-stone-600 hover:underline">Sign in</Link>
              <Link href="/register" className="btn">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

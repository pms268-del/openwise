import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { isSme, isStaff } from "@/lib/authz";
import { getFile } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [ev] = await sql`select ev.*, i.assigned_to, e.org_id from evidence ev left join inspections i on i.id = ev.inspection_id left join engagements e on e.id = ev.engagement_id where ev.id = ${id}`;
  const ok = ev && (isStaff(u) || ev.assigned_to === u.id || (isSme(u) && ev.org_id === u.orgId));
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await getFile(ev.storage_backend, ev.storage_path);
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": ev.mime_type ?? "application/octet-stream", "Content-Disposition": `inline; filename="${ev.filename.replace(/"/g, "")}"`, "Cache-Control": "private, max-age=300" } });
}

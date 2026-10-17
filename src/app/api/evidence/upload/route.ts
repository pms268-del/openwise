import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, putFile } from "@/lib/storage";

// Field agents/brokers upload evidence for inspections assigned to them; staff may upload for any.
export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fd = await req.formData();
  const inspectionId = String(fd.get("inspectionId") ?? "");
  const [i] = await sql`select * from inspections where id = ${inspectionId}`;
  if (!i || !(isStaff(u) || i.assigned_to === u.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["assigned", "scheduled", "rejected", "submitted"].includes(i.status) && !isStaff(u)) return NextResponse.json({ error: "Inspection is closed" }, { status: 409 });
  const kind = String(fd.get("kind") ?? "photo");
  if (!["photo", "document", "landlord_confirmation", "observation", "other"].includes(kind)) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  const saved = [];
  for (const f of fd.getAll("files")) {
    if (!(f instanceof File)) continue;
    if (f.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `${f.name} exceeds 15MB` }, { status: 413 });
    if (!ALLOWED_MIME.test(f.type)) return NextResponse.json({ error: `${f.name}: unsupported type ${f.type}` }, { status: 415 });
    const s = await putFile(`inspections/${inspectionId}`, f.name, Buffer.from(await f.arrayBuffer()), f.type);
    const [ev] = await sql`insert into evidence (engagement_id, property_id, inspection_id, kind, storage_backend, storage_path, filename, mime_type, size_bytes, sha256, description, uploaded_by)
      values (${i.engagement_id}, ${i.property_id}, ${inspectionId}, ${kind}, ${s.backend}, ${s.key}, ${f.name}, ${f.type}, ${f.size}, ${s.sha256}, ${String(fd.get("description") ?? "") || null}, ${u.id}) returning id`;
    saved.push(ev.id);
  }
  await audit(u, "evidence.upload", "inspection", inspectionId, { count: saved.length, kind });
  const back = String(fd.get("redirect") ?? "");
  if (back.startsWith("/")) return NextResponse.redirect(new URL(back, req.url), 303);
  return NextResponse.json({ ids: saved });
}

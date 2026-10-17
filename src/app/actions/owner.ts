"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { assertOwnerProperty } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { geocode } from "@/lib/integrations/google";
import { missingTermFields } from "@/lib/services/common";

const num = z.coerce.number().nonnegative().optional().or(z.literal("").transform(() => undefined));
const Sub = z.object({
  address: z.string().min(5), borough: z.string().optional(), sqft: num, lat: num, lng: z.coerce.number().optional().or(z.literal("").transform(() => undefined)),
  rent_monthly: num, cam_monthly: num, nnn_monthly: num, re_tax_monthly: num, utilities_monthly: num, electricity_monthly: num, security_deposit: num,
  lease_term_months: num, availability_date: z.string().optional(), permitted_uses: z.string().optional(), concessions: z.string().optional(),
  negotiable: z.enum(["yes", "no", "unknown"]).default("unknown"),
});

async function saveTerms(propertyId: string, d: z.infer<typeof Sub>, userId: string) {
  const t = { rent_monthly: d.rent_monthly ?? null, cam_monthly: d.cam_monthly ?? null, nnn_monthly: d.nnn_monthly ?? null, re_tax_monthly: d.re_tax_monthly ?? null,
    utilities_monthly: d.utilities_monthly ?? null, electricity_monthly: d.electricity_monthly ?? null, security_deposit: d.security_deposit ?? null,
    lease_term_months: d.lease_term_months ?? null, availability_date: d.availability_date || null, permitted_uses: d.permitted_uses ? d.permitted_uses.split(",").map((s) => s.trim()).filter(Boolean) : [],
    concessions: d.concessions || null, negotiable: d.negotiable };
  const [lt] = await sql`insert into lease_terms (property_id, source_kind, rent_monthly, cam_monthly, nnn_monthly, re_tax_monthly, utilities_monthly, electricity_monthly, security_deposit,
      lease_term_months, availability_date, permitted_uses, concessions, negotiable, missing_fields, status, extracted_by, field_evidence)
    values (${propertyId}, 'owner_portal', ${t.rent_monthly}, ${t.cam_monthly}, ${t.nnn_monthly}, ${t.re_tax_monthly}, ${t.utilities_monthly}, ${t.electricity_monthly}, ${t.security_deposit},
      ${t.lease_term_months}, ${t.availability_date}, ${t.permitted_uses}, ${t.concessions}, ${t.negotiable}, ${missingTermFields(t)}, 'extracted', ${`owner:${userId}`},
      ${sql.json({ _source: "Submitted by owner via portal" })}) returning id`;
  // Owner-stated terms still go through human review before clients see them.
  await sql`insert into approvals (kind, ref_table, ref_id, payload, requested_by) values ('lease_terms', 'lease_terms', ${lt.id}, ${sql.json({ via: "owner_portal" })}, ${userId})`;
}

export async function submitPropertyAction(fd: FormData) {
  const u = await requireUser(["property_owner"]);
  const p = Sub.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect(`/owner/new?error=${encodeURIComponent(p.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "))}`);
  const d = p.data;
  let lat = d.lat, lng = d.lng;
  if (lat == null || lng == null) {
    const g = await geocode(d.address);
    if (!g.data) redirect(`/owner/new?error=${encodeURIComponent("We could not locate this address automatically. Please enter latitude/longitude.")}`);
    lat = g.data.lat; lng = g.data.lng;
  }
  const facilities: Record<string, boolean> = {};
  for (const f of fd.getAll("facilities").map(String)) facilities[f] = true;
  const perms = { share_with_smes: fd.get("share") === "on", allow_outreach: fd.get("outreach") === "on", allow_inspections: fd.get("inspections") === "on" };
  const [row] = await sql`insert into properties (market_code, source_type, source_ref, source_license_note, address, borough, location, sqft, facilities, off_market, owner_org_id, owner_permissions, created_by)
    values ('nyc', 'owner_submission', ${`owner:${u.orgId}`}, 'Submitted by owner; owner-granted permissions apply', ${d.address}, ${d.borough ?? null},
            st_setsrid(st_makepoint(${lng!}, ${lat!}), 4326)::geography, ${d.sqft ?? null}, ${sql.json(facilities)}, true, ${u.orgId}, ${sql.json(perms)}, ${u.id}) returning id`;
  const [c] = await sql`insert into contacts (kind, name, email, user_id, source) values ('owner', ${u.name}, ${u.email}, ${u.id}, 'owner_portal') returning id`;
  await sql`insert into property_contacts (property_id, contact_id, relationship) values (${row.id}, ${c.id}, 'owner')`;
  if (d.rent_monthly != null) await saveTerms(row.id, d, u.id);
  await audit(u, "owner.submit_property", "property", row.id, perms);
  redirect(`/owner/p/${row.id}?saved=1`);
}

export async function updateOwnerPropertyAction(propertyId: string, fd: FormData) {
  const u = await requireUser(["property_owner"]);
  await assertOwnerProperty(u, propertyId);
  const perms = { share_with_smes: fd.get("share") === "on", allow_outreach: fd.get("outreach") === "on", allow_inspections: fd.get("inspections") === "on" };
  const available = fd.get("available") === "on";
  await sql`update properties set owner_permissions = ${sql.json(perms)}, status = ${available ? sql`case when status = 'unavailable' then 'lead' else status end` : sql`'unavailable'`}, updated_at = now() where id = ${propertyId}`;
  const p = Sub.partial().safeParse(Object.fromEntries(fd));
  if (p.success && p.data.rent_monthly != null) await saveTerms(propertyId, { negotiable: "unknown", address: "x", ...p.data } as never, u.id);
  await audit(u, "owner.update_property", "property", propertyId, { perms, available });
  revalidatePath(`/owner/p/${propertyId}`);
}

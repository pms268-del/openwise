// Seeds reference data, staff/demo accounts, and clearly-labeled MOCK properties for local demos.
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";
import { INDUSTRIES, MARKETS } from "../src/lib/industries";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/siteiq", { max: 1, onnotice: () => {} });
const PW = process.env.SEED_PASSWORD ?? "demo1234";

async function main() {
  for (const [code, m] of Object.entries(MARKETS))
    await sql`insert into markets (code, name, config) values (${code}, ${m.name}, ${sql.json(m.config as never)}) on conflict (code) do update set config = excluded.config`;
  for (const [code, i] of Object.entries(INDUSTRIES))
    await sql`insert into industries (code, name, google_place_types, config) values (${code}, ${i.name}, ${i.config.googlePlaceTypes}, ${sql.json(i.config as never)})
              on conflict (code) do update set config = excluded.config, google_place_types = excluded.google_place_types`;

  const org = async (name: string, kind: string) => {
    const [o] = await sql`select id from organizations where name = ${name}`;
    return o?.id ?? (await sql`insert into organizations (name, kind) values (${name}, ${kind}) returning id`)[0].id;
  };
  const user = async (orgId: string, email: string, name: string, role: string, license?: string) =>
    (await sql`insert into users (org_id, email, name, role, password_hash, broker_license_number, broker_license_state)
               values (${orgId}, ${email}, ${name}, ${role}, ${hashPassword(PW)}, ${license ?? null}, ${license ? "NY" : null})
               on conflict (email) do update set role = excluded.role returning id`)[0].id;

  const platform = await org("SiteIQ Platform", "platform");
  const admin = await user(platform, "admin@siteiq.dev", "Avery Admin", "admin");
  await user(platform, "analyst@siteiq.dev", "Riley Analyst", "analyst");
  await user(platform, "agent@siteiq.dev", "Jordan Field", "field_agent");
  const brokerOrg = await org("Partner Brokerage (demo)", "brokerage");
  const broker = await user(brokerOrg, "broker@siteiq.dev", "Sam Broker", "broker", "10401234567");
  await user(await org("Demo Coffee Co.", "sme"), "sme@siteiq.dev", "Casey Founder", "sme_owner");
  const ownerOrg = await org("Demo Holdings LLC", "owner");
  await user(ownerOrg, "owner@siteiq.dev", "Morgan Owner", "property_owner");

  const [{ n }] = await sql`select count(*)::int as n from properties where is_mock`;
  if (n === 0) {
    // [MOCK] demo inventory near several neighborhoods. Coordinates are near real streets but listings are fictitious.
    const P = [
      { a: "[MOCK] 210 Bedford Ave (demo)", b: "Brooklyn", nb: "Williamsburg", lat: 40.7172, lng: -73.9573, sqft: 950, f: { water: true, electrical_capacity: true, ada: true, restroom: true, storefront: true }, rent: 9800, cam: 450, dep: 29400, term: 120, neg: "yes", st: "approved" },
      { a: "[MOCK] 145 N 7th St (demo)", b: "Brooklyn", nb: "Williamsburg", lat: 40.7197, lng: -73.9577, sqft: 1250, f: { water: true, ada: null, restroom: true }, rent: 12500, cam: null, dep: null, term: null, neg: "unknown", st: "extracted" },
      { a: "[MOCK] 88 Grand St (demo)", b: "Brooklyn", nb: "Williamsburg", lat: 40.7140, lng: -73.9640, sqft: 800, f: {}, rent: null },
      { a: "[MOCK] 301 Metropolitan Ave (demo)", b: "Brooklyn", nb: "Williamsburg", lat: 40.7140, lng: -73.9555, sqft: 1100, f: { water: false, electrical_capacity: true, ada: true, restroom: true }, rent: 8200, cam: 300, dep: 24600, term: 60, neg: "no", st: "approved" },
      { a: "[MOCK] 120 Avenue A (demo)", b: "Manhattan", nb: "East Village", lat: 40.7262, lng: -73.9838, sqft: 700, f: { water: true, restroom: true }, rent: 11000, cam: 0, dep: 33000, term: 120, neg: "yes", st: "approved" },
      { a: "[MOCK] 52 E 7th St (demo)", b: "Manhattan", nb: "East Village", lat: 40.7275, lng: -73.9870, sqft: 900, f: {}, rent: null },
      { a: "[MOCK] 31-10 Broadway (demo)", b: "Queens", nb: "Astoria", lat: 40.7616, lng: -73.9240, sqft: 1300, f: { water: true, electrical_capacity: true, ada: true, restroom: true }, rent: 7200, cam: 250, dep: 21600, term: 120, neg: "yes", st: "approved" },
      { a: "[MOCK] 412 7th Ave (demo)", b: "Brooklyn", nb: "Park Slope", lat: 40.6662, lng: -73.9826, sqft: 1000, f: {}, rent: null },
    ];
    for (const p of P) {
      const [row] = await sql`insert into properties (market_code, source_type, source_ref, source_license_note, address, borough, neighborhood, location, sqft, facilities, status, is_mock, off_market, created_by)
        values ('nyc', 'mock', ${"DEMO-" + p.a.slice(7, 20)}, 'SIMULATED demo record', ${p.a}, ${p.b}, ${p.nb}, st_setsrid(st_makepoint(${p.lng}, ${p.lat}), 4326)::geography, ${p.sqft},
                ${sql.json(p.f as never)}, ${p.rent ? "terms_collected" : "lead"}, true, ${!p.rent}, ${admin}) returning id`;
      const [c] = await sql`insert into contacts (kind, name, company, email, phone, consent_recording, is_mock, source)
        values ('landlord', ${"[MOCK] Landlord of " + p.a.slice(7, 24)}, 'Demo Realty (fictitious)', ${"landlord+" + row.id.slice(0, 6) + "@example.com"}, '+1-212-555-0100', false, true, 'seed') returning id`;
      await sql`insert into property_contacts (property_id, contact_id) values (${row.id}, ${c.id})`;
      if (p.rent) {
        const t = { rent_monthly: p.rent, cam_monthly: p.cam ?? null, security_deposit: p.dep ?? null, lease_term_months: p.term ?? null, negotiable: p.neg ?? "unknown" };
        const missing = ["utilities_monthly", "electricity_monthly", "availability_date", "permitted_uses", ...(t.cam_monthly == null ? ["cam_or_nnn"] : []), ...(t.security_deposit == null ? ["security_deposit"] : []), ...(t.lease_term_months == null ? ["lease_term_months"] : []), ...(t.negotiable === "unknown" ? ["negotiable"] : [])];
        await sql`insert into lease_terms (property_id, source_kind, rent_monthly, cam_monthly, security_deposit, lease_term_months, negotiable, missing_fields, status, extracted_by, approved_by, approved_at, field_evidence)
          values (${row.id}, 'mock', ${t.rent_monthly}, ${t.cam_monthly}, ${t.security_deposit}, ${t.lease_term_months}, ${t.negotiable}, ${missing}, ${p.st}, 'seed', ${p.st === "approved" ? admin : null}, ${p.st === "approved" ? new Date() : null}, ${sql.json({ _source: "SIMULATED demo terms" })})`;
        if (p.st === "extracted") await sql`insert into approvals (kind, ref_table, ref_id, payload) select 'lease_terms', 'lease_terms', id, ${sql.json({ address: p.a })} from lease_terms where property_id = ${row.id}`;
      }
    }
    // A licensed broker contact for brokerage handoffs.
    await sql`insert into contacts (kind, name, company, email, phone, license_number, license_state, user_id, is_mock, source)
              values ('broker', 'Sam Broker', 'Partner Brokerage (demo)', 'broker@siteiq.dev', '+1-212-555-0199', '10401234567', 'NY', ${broker}, true, 'seed')`;
  }
  console.log(`Seeded. Demo accounts (password "${PW}"): sme@, admin@, analyst@, agent@, broker@, owner@ siteiq.dev`);
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

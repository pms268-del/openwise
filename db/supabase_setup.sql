-- SiteIQ one-shot Supabase setup: schema + reference data + demo accounts/SIMULATED demo properties.
-- Paste into Supabase Dashboard > SQL Editor and Run once.
-- SiteIQ core schema. Target: Supabase Postgres (or any Postgres 15+) with PostGIS.
-- All application access goes through the server (service connection). Row Level Security
-- is enabled with no client policies (see 002_rls.sql), so anon/authenticated Supabase keys
-- cannot read business data directly; org isolation is enforced in the server data layer.

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------- Tenancy & identity ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('sme','platform','owner','brokerage')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null check (role in ('sme_owner','sme_member','admin','analyst','field_agent','broker','property_owner')),
  password_hash text,                -- local auth only; null when Supabase Auth is the identity provider
  supabase_user_id uuid unique,
  broker_license_number text,        -- required for role=broker before brokerage tasks can be assigned
  broker_license_state text,
  created_at timestamptz not null default now()
);
create index on users(org_id);

-- ---------- Configurable markets & industries (multi-city / multi-vertical) ----------
create table markets (
  code text primary key,                -- 'nyc'
  name text not null,
  config jsonb not null default '{}'    -- bounds, census state/county FIPS, data adapters enabled
);

create table industries (
  code text primary key,                -- 'coffee_shop'
  name text not null,
  google_place_types text[] not null default '{}',
  config jsonb not null default '{}'    -- default financial assumptions, required facilities, checklist seeds
);

-- ---------- SME onboarding ----------
create table business_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  industry_code text not null references industries(code),
  market_code text not null references markets(code),
  business_name text not null,
  concept text not null,
  target_area text not null,                  -- free text the SME typed (e.g. "Williamsburg, Brooklyn")
  target_location geography(Point,4326),      -- geocoded centroid
  target_radius_m integer not null default 800,
  target_customers text,
  startup_budget numeric(14,2) not null,
  max_monthly_rent numeric(12,2) not null,
  min_sqft integer,
  max_sqft integer,
  required_facilities text[] not null default '{}',
  opening_timeline text,                     -- e.g. '3-6 months'
  geocode_source text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on business_profiles(org_id);
create index on business_profiles using gist(target_location);

create table engagements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_profile_id uuid not null references business_profiles(id) on delete cascade,
  status text not null default 'draft' check (status in (
    'draft','researching','free_report_ready','payment_pending','active',
    'discovery','feasibility','fieldwork','final_review','delivered','cancelled')),
  tier text not null default 'free' check (tier in ('free','paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on engagements(org_id);

-- ---------- Payments ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  engagement_id uuid not null references engagements(id),
  provider text not null check (provider in ('stripe','mock')),
  provider_session_id text unique,
  provider_payment_intent text,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null check (status in ('pending','paid','failed','refunded','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table stripe_events (                -- webhook idempotency
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- ---------- External data cache (license-aware) ----------
-- Google Maps Platform terms: place_id may be stored indefinitely; other Places content
-- may only be cached temporarily (we use <= 30 days via expires_at) and must be shown with attribution.
create table data_cache (
  key text primary key,
  source text not null,
  payload jsonb not null,
  is_mock boolean not null default false,
  license_note text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on data_cache(expires_at);

-- ---------- Market research ----------
create table market_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  version integer not null,
  status text not null default 'ready' check (status in ('generating','ready','failed')),
  input_hash text not null,               -- hash of compact inputs; identical inputs reuse narrative
  metrics jsonb not null,                 -- deterministic metrics + suitability score breakdown
  competitors jsonb not null,             -- compact list (place_id, name, rating, distance) for map
  narrative jsonb,                        -- AI synthesis (structured)
  data_sources jsonb not null,            -- [{source, status: live|mock|unavailable, fetched_at, license}]
  limitations jsonb not null,
  created_at timestamptz not null default now(),
  unique (engagement_id, version)
);

-- ---------- Property CRM (proprietary) ----------
create table properties (
  id uuid primary key default gen_random_uuid(),
  market_code text not null references markets(code),
  source_type text not null check (source_type in (
    'broker_api','public_record','licensed_broker','owner_submission','manual_research','mock')),
  source_ref text,                        -- listing id / BBL / broker reference
  source_license_note text,
  address text not null,
  unit text,
  borough text,
  neighborhood text,
  bbl text,
  location geography(Point,4326) not null,
  sqft integer,
  frontage_ft numeric(6,1),
  floor text default 'ground',
  property_type text default 'retail',
  zoning text,
  facilities jsonb not null default '{}', -- {venting:bool|null, water:bool, grease_trap, ada, outdoor_seating,...}
  status text not null default 'lead' check (status in (
    'lead','contacted','terms_collected','inspection_pending','verified','unavailable','rejected')),
  off_market boolean not null default false,
  owner_org_id uuid references organizations(id),
  owner_permissions jsonb not null default '{}', -- owner portal: {share_with_smes, allow_outreach, allow_inspections}
  is_mock boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on properties using gist(location);
create index on properties(owner_org_id);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('landlord','owner','broker','property_manager','other')),
  name text not null,
  company text,
  email text,
  phone text,
  license_number text,
  license_state text,
  -- TCPA / consent tracking. AI voice calls require express prior consent recorded here.
  consent_ai_voice boolean not null default false,
  consent_recording boolean not null default false,
  consent_recorded_at timestamptz,
  consent_method text,
  do_not_contact boolean not null default false,
  source text,
  notes text,
  user_id uuid references users(id),      -- linked owner/broker user if they have a portal account
  is_mock boolean not null default false,
  created_at timestamptz not null default now()
);

create table property_contacts (
  property_id uuid not null references properties(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  relationship text not null default 'landlord',
  primary key (property_id, contact_id)
);

-- Versioned lease terms. Each row is a snapshot from one source; approval required before SME sees it.
create table lease_terms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'call_transcript','email','owner_portal','broker_listing','inspection','manual','mock')),
  source_ref uuid,                        -- call_records.id / evidence.id / inspections.id
  rent_monthly numeric(12,2),
  rent_annual numeric(14,2),
  rent_psf_annual numeric(10,2),
  utilities_monthly numeric(10,2),
  electricity_monthly numeric(10,2),
  cam_monthly numeric(10,2),
  nnn_monthly numeric(10,2),
  re_tax_monthly numeric(10,2),
  security_deposit numeric(12,2),
  other_costs jsonb not null default '[]',   -- [{label, amount, frequency}]
  lease_term_months integer,
  availability_date date,
  permitted_uses text[],
  concessions text,
  free_rent_months numeric(4,1),
  ti_allowance numeric(12,2),
  negotiable text check (negotiable in ('yes','no','unknown')) default 'unknown',
  field_evidence jsonb not null default '{}', -- field -> {quote, source_ref}
  missing_fields text[] not null default '{}',
  status text not null default 'extracted' check (status in ('extracted','approved','rejected','verified')),
  extracted_by text,                      -- 'ai:<model>' | 'human:<user id>'
  approved_by uuid references users(id),
  approved_at timestamptz,
  verified_by uuid references users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index on lease_terms(property_id, created_at desc);

-- Engagement <-> property (candidate pool and shortlist)
create table engagement_properties (
  engagement_id uuid not null references engagements(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  status text not null default 'candidate' check (status in ('candidate','shortlisted','rejected','recommended')),
  match_score numeric(5,1),
  score_breakdown jsonb,
  distance_m integer,
  notes text,
  added_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (engagement_id, property_id)
);

-- ---------- Outreach ----------
create table outreach_tasks (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references engagements(id) on delete set null,
  property_id uuid not null references properties(id) on delete cascade,
  contact_id uuid references contacts(id),
  channel text not null check (channel in ('email','phone_human','phone_ai_voice')),
  status text not null default 'draft' check (status in (
    'draft','pending_approval','approved','in_progress','completed','blocked','cancelled')),
  ai_draft jsonb,                         -- {subject, body, call_script[], questions[]}
  compliance jsonb not null default '{}', -- result of deterministic compliance gate
  assigned_to uuid references users(id),
  approved_by uuid references users(id),
  outcome text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table call_records (
  id uuid primary key default gen_random_uuid(),
  outreach_task_id uuid references outreach_tasks(id) on delete set null,
  property_id uuid not null references properties(id) on delete cascade,
  contact_id uuid references contacts(id),
  initiated_by text not null check (initiated_by in ('human','ai_voice')),
  caller_user_id uuid references users(id),
  recording_consent boolean not null default false,
  consent_note text,
  transcript text,
  transcript_source text check (transcript_source in ('manual_notes','uploaded_transcript','speech_to_text')),
  duration_s integer,
  extraction_status text not null default 'pending' check (extraction_status in ('pending','queued','done','failed')),
  created_at timestamptz not null default now()
);

-- ---------- Financial models (deterministic) ----------
create table financial_models (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  version integer not null,
  lease_terms_id uuid references lease_terms(id),
  assumptions jsonb not null,
  results jsonb not null,
  engine_version text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (engagement_id, property_id, version)
);

-- ---------- Field verification (the one offline stage) ----------
create table inspections (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  status text not null default 'requested' check (status in (
    'requested','assigned','scheduled','submitted','verified','rejected','cancelled')),
  assigned_to uuid references users(id),
  requires_licensed_broker boolean not null default false,
  checklist jsonb not null default '[]',  -- [{id, category, question, type: bool|number|text|photo, required}]
  responses jsonb not null default '{}',  -- item id -> {value, note, evidence_ids[]}
  terms_confirmed jsonb,                  -- terms confirmed on site (feeds a lease_terms row with source_kind='inspection')
  scheduled_for timestamptz,
  submitted_at timestamptz,
  verified_by uuid references users(id),
  verified_at timestamptz,
  reviewer_note text,
  requested_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references engagements(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  inspection_id uuid references inspections(id) on delete cascade,
  kind text not null check (kind in ('photo','document','landlord_confirmation','observation','transcript','other')),
  storage_backend text not null,
  storage_path text not null,
  filename text not null,
  mime_type text,
  size_bytes integer,
  sha256 text not null,
  description text,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ---------- Human approvals for regulated / outward-facing actions ----------
create table approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'lease_terms','outreach_message','ai_voice_call','brokerage_handoff','final_report')),
  ref_table text not null,
  ref_id uuid not null,
  engagement_id uuid references engagements(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  payload jsonb not null default '{}',
  requested_by uuid references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create index on approvals(status, kind);

-- ---------- Final decision report ----------
create table final_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','approved','delivered')),
  input_hash text not null,
  content jsonb not null,              -- deterministic sections
  narrative jsonb,                     -- AI synthesis
  recommendation text check (recommendation in ('proceed','negotiate','change_location','revise_business','reject','insufficient_evidence')),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (engagement_id, version)
);

-- ---------- Durable background jobs (Postgres queue, SKIP LOCKED) ----------
create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  dedupe_key text unique,
  engagement_id uuid references engagements(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs(status, run_after);

-- ---------- Cost tracking ----------
create table ai_usage (
  id bigserial primary key,
  engagement_id uuid references engagements(id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(10,5) not null default 0,
  is_mock boolean not null default false,
  created_at timestamptz not null default now()
);
create table api_usage (
  id bigserial primary key,
  engagement_id uuid references engagements(id) on delete set null,
  provider text not null,
  endpoint text not null,
  cached boolean not null default false,
  is_mock boolean not null default false,
  cost_usd numeric(10,5) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Audit ----------
create table audit_logs (
  id bigserial primary key,
  org_id uuid references organizations(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on audit_logs(entity_type, entity_id);

-- Defense in depth for Supabase: enable RLS on every table with no permissive policies.
-- The anon/authenticated roles therefore cannot read or write business data through the
-- Supabase REST/Realtime APIs; the Next.js server (service connection) is the only data path
-- and enforces per-organization and per-role isolation in src/lib/authz.ts.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now());
insert into schema_migrations (name) values ('001_init.sql'), ('002_rls.sql') on conflict do nothing;
alter table schema_migrations enable row level security;
\restrict 6uI7371wU3xYIoNQlMe0CENIprh4LN1YmkUjattyUvWcX2U7yJPDK4MQ5ffASXc
INSERT INTO public.organizations VALUES ('68804e61-9f81-4de8-bfb7-7cc04a061b35', 'SiteIQ Platform', 'platform', '2026-10-17 16:57:36.92699+00');
INSERT INTO public.organizations VALUES ('dae877f3-c7c6-4c6b-9a36-7a016a59401f', 'Partner Brokerage (demo)', 'brokerage', '2026-10-17 16:57:37.062854+00');
INSERT INTO public.organizations VALUES ('0b46ae79-1367-4309-8411-ce7b7ed23378', 'Demo Coffee Co.', 'sme', '2026-10-17 16:57:37.103102+00');
INSERT INTO public.organizations VALUES ('5d66a4b9-99db-4ee7-bd37-e41ddbe0fc7e', 'Demo Holdings LLC', 'owner', '2026-10-17 16:57:37.148826+00');
INSERT INTO public.users VALUES ('9e601c71-7e70-43ad-a23c-3dc1e624af69', '68804e61-9f81-4de8-bfb7-7cc04a061b35', 'admin@siteiq.dev', 'Avery Admin', 'admin', 'scrypt$5db51dffd9c1e038e56a17dabe792e5e$1371244895c8c3e9e5399fdaa62d5dab1265adcf2665dc3e27ecb9dfff08d3f2338b689c2deff5c6ccfaea3c6315bce491067b24e0058ed10a9d867418f78a32', NULL, NULL, NULL, '2026-10-17 16:57:36.974839+00');
INSERT INTO public.users VALUES ('5077a5c3-fbbc-4bbc-9c58-a281d3d1979a', '68804e61-9f81-4de8-bfb7-7cc04a061b35', 'analyst@siteiq.dev', 'Riley Analyst', 'analyst', 'scrypt$bc0b6da1fd4c77377196f1e5ec276184$b4c8b8dc0e2d4277a172baeecb293154395512df01cfc3069cc44d585ce9f3a8c3c8c2f0f78643c7db05b578f6c3058a51e897b6d349a4874a21fa3ddb2e1722', NULL, NULL, NULL, '2026-10-17 16:57:37.020923+00');
INSERT INTO public.users VALUES ('7a5801ec-5154-462c-9ac6-21d776ae1d7c', '68804e61-9f81-4de8-bfb7-7cc04a061b35', 'agent@siteiq.dev', 'Jordan Field', 'field_agent', 'scrypt$90fe313ba9267500373b8a4798c443c0$aed55b6bae6d02b732e4bbc747beb45526756bb434125519b6e35e2763af7a32e3aa36050ed26a31ef3197e1a0730fa211c3f924b70e706b7507072e852c9719', NULL, NULL, NULL, '2026-10-17 16:57:37.059773+00');
INSERT INTO public.users VALUES ('8493bc4e-d637-43f0-97aa-15172057aefb', 'dae877f3-c7c6-4c6b-9a36-7a016a59401f', 'broker@siteiq.dev', 'Sam Broker', 'broker', 'scrypt$1601847d6b26d65a21b7c9c96c3841b5$b859ef1832af8ae10496e73cb1ba96b2fa600494e4bcee5ac76aa6cd5da6147e3795b3f00e8b63faeb078e67dc9971c46f5912b8221c397d326ed929d52c574c', NULL, '10401234567', 'NY', '2026-10-17 16:57:37.10115+00');
INSERT INTO public.users VALUES ('839732bd-810b-403c-a867-524b733c6305', '0b46ae79-1367-4309-8411-ce7b7ed23378', 'sme@siteiq.dev', 'Casey Founder', 'sme_owner', 'scrypt$7869bf4a3b8ed8c08566d5a1509ac4b6$1dd3c7a15d11551e0b74493f53f174ab2c5122a45316d9d00f01c5cea7303285f5ec36bd299250dfab936ed31f12e162d0aebcfeb5f7439ff018d157c6e3fdb9', NULL, NULL, NULL, '2026-10-17 16:57:37.146607+00');
INSERT INTO public.users VALUES ('4753e917-27ef-4776-b448-9e2cdf3b3b58', '5d66a4b9-99db-4ee7-bd37-e41ddbe0fc7e', 'owner@siteiq.dev', 'Morgan Owner', 'property_owner', 'scrypt$04e0062bfc6156768f967a3d2c2ba59a$9a78365517fa6c929ae4b6adae8397ed2f05b9cb692d4504162e3c5a6029509c851986918374b27444250280ca7644084222afc90299ffda3665190a466dd811', NULL, NULL, NULL, '2026-10-17 16:57:37.195746+00');
INSERT INTO public.approvals VALUES ('dfca04b2-0fd3-46b1-bf92-5683cd3c81d2', 'lease_terms', 'lease_terms', '439342dd-c8bb-41ab-bb61-567a268fc2d6', NULL, 'pending', '{"address": "[MOCK] 145 N 7th St (demo)"}', NULL, NULL, NULL, NULL, '2026-10-17 16:57:37.221202+00');
INSERT INTO public.contacts VALUES ('94716873-74e5-4e02-8d9f-784fdcbd7dd1', 'landlord', '[MOCK] Landlord of 210 Bedford Ave (', 'Demo Realty (fictitious)', 'landlord+34c750@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.208751+00');
INSERT INTO public.contacts VALUES ('bea316cb-e9f0-414c-a6c2-e3b4c75e810d', 'landlord', '[MOCK] Landlord of 145 N 7th St (dem', 'Demo Realty (fictitious)', 'landlord+0e1f0b@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.217493+00');
INSERT INTO public.contacts VALUES ('be68f129-bbfc-4fec-9b99-0fed09fbd21e', 'landlord', '[MOCK] Landlord of 88 Grand St (demo', 'Demo Realty (fictitious)', 'landlord+495f01@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.224842+00');
INSERT INTO public.contacts VALUES ('daf804fb-3361-49b0-84d5-e1d4f4a23588', 'landlord', '[MOCK] Landlord of 301 Metropolitan ', 'Demo Realty (fictitious)', 'landlord+2689d3@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.227319+00');
INSERT INTO public.contacts VALUES ('eae4b970-f043-418a-b9f5-252e43054e26', 'landlord', '[MOCK] Landlord of 120 Avenue A (dem', 'Demo Realty (fictitious)', 'landlord+816f74@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.230432+00');
INSERT INTO public.contacts VALUES ('b6c5e238-fd5b-46b0-9442-7e68c3d14cba', 'landlord', '[MOCK] Landlord of 52 E 7th St (demo', 'Demo Realty (fictitious)', 'landlord+4df28a@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.235272+00');
INSERT INTO public.contacts VALUES ('52ebb98e-af74-4a30-8012-5132e4ff7943', 'landlord', '[MOCK] Landlord of 31-10 Broadway (d', 'Demo Realty (fictitious)', 'landlord+f80247@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.237288+00');
INSERT INTO public.contacts VALUES ('b44739ab-e1b0-4607-a037-51a75681bb59', 'landlord', '[MOCK] Landlord of 412 7th Ave (demo', 'Demo Realty (fictitious)', 'landlord+99d87d@example.com', '+1-212-555-0100', NULL, NULL, false, false, NULL, NULL, false, 'seed', NULL, NULL, true, '2026-10-17 16:57:37.239957+00');
INSERT INTO public.contacts VALUES ('a546448b-1654-4107-b37e-84d14d9d854e', 'broker', 'Sam Broker', 'Partner Brokerage (demo)', 'broker@siteiq.dev', '+1-212-555-0199', '10401234567', 'NY', false, false, NULL, NULL, false, 'seed', NULL, '8493bc4e-d637-43f0-97aa-15172057aefb', true, '2026-10-17 16:57:37.240934+00');
INSERT INTO public.industries VALUES ('coffee_shop', 'Coffee shop / café', '{coffee_shop,cafe}', '{"finance": {"cogsPct": 0.28, "avgTicket": 8.5, "equipment": 85000, "rampCurve": [0.5, 0.6, 0.7, 0.8, 0.88, 0.95], "cardFeesPct": 0.03, "laborMonthly": 22000, "contingencyPct": 0.15, "buildoutPerSqft": 110, "permitsLicenses": 6000, "preOpeningLabor": 15000, "softwareMonthly": 250, "ventingRetrofit": 35000, "initialInventory": 8000, "insuranceMonthly": 450, "marketingMonthly": 800, "otherOpexMonthly": 900, "payrollBurdenPct": 0.14, "plumbingRetrofit": 18000, "professionalFees": 12000, "repairsPctRevenue": 0.015, "depositMonthsDefault": 3, "workingCapitalMonths": 3, "utilitiesPerSqftMonthly": 0.35, "baselineDailyTransactions": 300, "electricityPerSqftMonthly": 0.9}, "googlePlaceTypes": ["coffee_shop", "cafe"], "competitorKeywords": ["coffee", "cafe", "espresso"], "requiredFacilities": [{"key": "water", "label": "Water supply & drainage at prep area", "critical": true}, {"key": "electrical_capacity", "label": "Electrical capacity for espresso machine (typically 208/240V, 30A+)", "critical": true}, {"key": "grease_trap", "label": "Grease interceptor (if any cooking)", "critical": false}, {"key": "venting", "label": "Kitchen exhaust / venting (only if hot food)", "critical": false}, {"key": "ada", "label": "ADA-accessible entrance & restroom", "critical": true}, {"key": "restroom", "label": "Customer restroom", "critical": true}, {"key": "storefront", "label": "Street-level storefront visibility", "critical": false}, {"key": "outdoor_seating", "label": "Sidewalk café eligibility", "critical": false}]}');
INSERT INTO public.markets VALUES ('nyc', 'New York City', '{"bounds": {"east": -73.7004, "west": -74.2591, "north": 40.9176, "south": 40.4774}, "center": {"lat": 40.7128, "lng": -74.006}, "censusState": "36", "boroughCounties": {"Bronx": "005", "Queens": "081", "Brooklyn": "047", "Manhattan": "061", "Staten Island": "085"}}');
INSERT INTO public.properties VALUES ('34c75084-4d8e-41cf-96de-e1f8fc80fd73', 'nyc', 'mock', 'DEMO-210 Bedford A', 'SIMULATED demo record', '[MOCK] 210 Bedford Ave (demo)', NULL, 'Brooklyn', 'Williamsburg', NULL, '0101000020E61000007E1D3867447D52C07958A835CD5B4440', 950, NULL, 'ground', 'retail', NULL, '{"ada": true, "water": true, "restroom": true, "storefront": true, "electrical_capacity": true}', 'terms_collected', false, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.199712+00', '2026-10-17 16:57:37.199712+00');
INSERT INTO public.properties VALUES ('0e1f0ba4-fb78-4c17-be10-948495860624', 'nyc', 'mock', 'DEMO-145 N 7th St ', 'SIMULATED demo record', '[MOCK] 145 N 7th St (demo)', NULL, 'Brooklyn', 'Williamsburg', NULL, '0101000020E610000045D8F0F44A7D52C032772D211F5C4440', 1250, NULL, 'ground', 'retail', NULL, '{"ada": null, "water": true, "restroom": true}', 'terms_collected', false, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.215891+00', '2026-10-17 16:57:37.215891+00');
INSERT INTO public.properties VALUES ('495f01b8-7489-495d-868a-21beedf717ba', 'nyc', 'mock', 'DEMO-88 Grand St (', 'SIMULATED demo record', '[MOCK] 88 Grand St (demo)', NULL, 'Brooklyn', 'Williamsburg', NULL, '0101000020E610000004560E2DB27D52C008AC1C5A645B4440', 800, NULL, 'ground', 'retail', NULL, '{}', 'lead', true, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.223825+00', '2026-10-17 16:57:37.223825+00');
INSERT INTO public.properties VALUES ('2689d333-74e3-4382-a7f5-faeafe0fe0da', 'nyc', 'mock', 'DEMO-301 Metropoli', 'SIMULATED demo record', '[MOCK] 301 Metropolitan Ave (demo)', NULL, 'Brooklyn', 'Williamsburg', NULL, '0101000020E6100000FED478E9267D52C008AC1C5A645B4440', 1100, NULL, 'ground', 'retail', NULL, '{"ada": true, "water": false, "restroom": true, "electrical_capacity": true}', 'terms_collected', false, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.226395+00', '2026-10-17 16:57:37.226395+00');
INSERT INTO public.properties VALUES ('816f744f-28ce-4d39-b236-e02e03aaa7ab', 'nyc', 'mock', 'DEMO-120 Avenue A ', 'SIMULATED demo record', '[MOCK] 120 Avenue A (demo)', NULL, 'Manhattan', 'East Village', NULL, '0101000020E610000082734694F67E52C0772D211FF45C4440', 700, NULL, 'ground', 'retail', NULL, '{"water": true, "restroom": true}', 'terms_collected', false, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.229475+00', '2026-10-17 16:57:37.229475+00');
INSERT INTO public.properties VALUES ('4df28ad8-dd5c-4160-a1ba-a2e02a6e3a4a', 'nyc', 'mock', 'DEMO-52 E 7th St (', 'SIMULATED demo record', '[MOCK] 52 E 7th St (demo)', NULL, 'Manhattan', 'East Village', NULL, '0101000020E6100000BA490C022B7F52C085EB51B81E5D4440', 900, NULL, 'ground', 'retail', NULL, '{}', 'lead', true, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.234027+00', '2026-10-17 16:57:37.234027+00');
INSERT INTO public.properties VALUES ('f802478e-fe16-41da-b80f-9f17bfcae536', 'nyc', 'mock', 'DEMO-31-10 Broadwa', 'SIMULATED demo record', '[MOCK] 31-10 Broadway (demo)', NULL, 'Queens', 'Astoria', NULL, '0101000020E61000004260E5D0227B52C01A51DA1B7C614440', 1300, NULL, 'ground', 'retail', NULL, '{"ada": true, "water": true, "restroom": true, "electrical_capacity": true}', 'terms_collected', false, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.236611+00', '2026-10-17 16:57:37.236611+00');
INSERT INTO public.properties VALUES ('99d87dd5-7f48-4b75-a4c4-67c0a559cea2', 'nyc', 'mock', 'DEMO-412 7th Ave (', 'SIMULATED demo record', '[MOCK] 412 7th Ave (demo)', NULL, 'Brooklyn', 'Park Slope', NULL, '0101000020E61000002D431CEBE27E52C0304CA60A46554440', 1000, NULL, 'ground', 'retail', NULL, '{}', 'lead', true, NULL, '{}', true, '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.239239+00', '2026-10-17 16:57:37.239239+00');
INSERT INTO public.lease_terms VALUES ('49ec5c8c-5ead-4db1-823a-5d0f37c46f91', '34c75084-4d8e-41cf-96de-e1f8fc80fd73', 'mock', NULL, 9800.00, NULL, NULL, NULL, NULL, 450.00, NULL, NULL, 29400.00, '[]', 120, NULL, NULL, NULL, NULL, NULL, 'yes', '{"_source": "SIMULATED demo terms"}', '{utilities_monthly,electricity_monthly,availability_date,permitted_uses}', 'approved', 'seed', '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.212+00', NULL, NULL, '2026-10-17 16:57:37.21281+00');
INSERT INTO public.lease_terms VALUES ('439342dd-c8bb-41ab-bb61-567a268fc2d6', '0e1f0ba4-fb78-4c17-be10-948495860624', 'mock', NULL, 12500.00, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, 'unknown', '{"_source": "SIMULATED demo terms"}', '{utilities_monthly,electricity_monthly,availability_date,permitted_uses,cam_or_nnn,security_deposit,lease_term_months,negotiable}', 'extracted', 'seed', NULL, NULL, NULL, NULL, '2026-10-17 16:57:37.219766+00');
INSERT INTO public.lease_terms VALUES ('d74bf326-7424-4aa3-a279-74521c316ffb', '2689d333-74e3-4382-a7f5-faeafe0fe0da', 'mock', NULL, 8200.00, NULL, NULL, NULL, NULL, 300.00, NULL, NULL, 24600.00, '[]', 60, NULL, NULL, NULL, NULL, NULL, 'no', '{"_source": "SIMULATED demo terms"}', '{utilities_monthly,electricity_monthly,availability_date,permitted_uses}', 'approved', 'seed', '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.228+00', NULL, NULL, '2026-10-17 16:57:37.228489+00');
INSERT INTO public.lease_terms VALUES ('79ef13f4-17a6-44ba-8e51-c2d77641d6c0', '816f744f-28ce-4d39-b236-e02e03aaa7ab', 'mock', NULL, 11000.00, NULL, NULL, NULL, NULL, 0.00, NULL, NULL, 33000.00, '[]', 120, NULL, NULL, NULL, NULL, NULL, 'yes', '{"_source": "SIMULATED demo terms"}', '{utilities_monthly,electricity_monthly,availability_date,permitted_uses}', 'approved', 'seed', '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.232+00', NULL, NULL, '2026-10-17 16:57:37.232711+00');
INSERT INTO public.lease_terms VALUES ('f6255147-ce37-448b-9f69-76702a1e0fb8', 'f802478e-fe16-41da-b80f-9f17bfcae536', 'mock', NULL, 7200.00, NULL, NULL, NULL, NULL, 250.00, NULL, NULL, 21600.00, '[]', 120, NULL, NULL, NULL, NULL, NULL, 'yes', '{"_source": "SIMULATED demo terms"}', '{utilities_monthly,electricity_monthly,availability_date,permitted_uses}', 'approved', 'seed', '9e601c71-7e70-43ad-a23c-3dc1e624af69', '2026-10-17 16:57:37.238+00', NULL, NULL, '2026-10-17 16:57:37.238521+00');
INSERT INTO public.property_contacts VALUES ('34c75084-4d8e-41cf-96de-e1f8fc80fd73', '94716873-74e5-4e02-8d9f-784fdcbd7dd1', 'landlord');
INSERT INTO public.property_contacts VALUES ('0e1f0ba4-fb78-4c17-be10-948495860624', 'bea316cb-e9f0-414c-a6c2-e3b4c75e810d', 'landlord');
INSERT INTO public.property_contacts VALUES ('495f01b8-7489-495d-868a-21beedf717ba', 'be68f129-bbfc-4fec-9b99-0fed09fbd21e', 'landlord');
INSERT INTO public.property_contacts VALUES ('2689d333-74e3-4382-a7f5-faeafe0fe0da', 'daf804fb-3361-49b0-84d5-e1d4f4a23588', 'landlord');
INSERT INTO public.property_contacts VALUES ('816f744f-28ce-4d39-b236-e02e03aaa7ab', 'eae4b970-f043-418a-b9f5-252e43054e26', 'landlord');
INSERT INTO public.property_contacts VALUES ('4df28ad8-dd5c-4160-a1ba-a2e02a6e3a4a', 'b6c5e238-fd5b-46b0-9442-7e68c3d14cba', 'landlord');
INSERT INTO public.property_contacts VALUES ('f802478e-fe16-41da-b80f-9f17bfcae536', '52ebb98e-af74-4a30-8012-5132e4ff7943', 'landlord');
INSERT INTO public.property_contacts VALUES ('99d87dd5-7f48-4b75-a4c4-67c0a559cea2', 'b44739ab-e1b0-4607-a037-51a75681bb59', 'landlord');
\unrestrict 6uI7371wU3xYIoNQlMe0CENIprh4LN1YmkUjattyUvWcX2U7yJPDK4MQ5ffASXc

-- Private Storage bucket for inspection evidence (Supabase only; skipped elsewhere).
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;
  end if;
end $$;

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

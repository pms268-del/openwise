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

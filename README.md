# SiteIQ — AI location intelligence & commercial property platform

SiteIQ is an MVP that helps small businesses decide where to open a physical location. It starts with coffee shops in New York City. Markets and industries are configuration, so other cities and verticals can be added without changing the code.

**Workflow:** onboarding → free market report → Stripe payment → property discovery & landlord outreach → deterministic financial feasibility → field inspection (the one offline stage) → evidence-backed decision report (dashboard + PDF).

## Quick start (local)

Requirements: Node 20+, and Postgres 15+ with PostGIS. Supabase Postgres works.

```bash
cp .env.example .env.local          # every integration is optional
npm install
npm run db:setup                    # migrations + seed (demo accounts + SIMULATED demo properties)
npm run dev                         # http://localhost:3000
```

Demo accounts (password `demo1234`): `sme@`, `admin@`, `analyst@`, `agent@`, `broker@`, `owner@` at `siteiq.dev`.

```bash
npm test                            # unit tests: finance engine, scoring, matching, extraction, compliance gate
npm run build && npm start &        # then:
npx playwright test                 # E2E: full workflow across SME, admin, field-agent portals + org isolation
```

## Integration status

Each integration activates when its credentials are set. Until then it uses an adapter that is **explicitly labeled** "simulated", both in the UI and in the reports. Simulated data is never presented as real.

| Integration | Live when | Fallback |
|---|---|---|
| Google Geocoding + Places API (New) | `GOOGLE_MAPS_SERVER_KEY` | Built-in approximate NYC neighborhood centroids; simulated competitors |
| Google Maps JS | `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Leaflet + OpenStreetMap tiles (switch to a commercial tile provider for production traffic) |
| US Census ACS 5-yr + Census Geocoder | `ENABLE_LIVE_CENSUS=true` | Simulated tract demographics |
| NYC Open Data: MapPLUTO, DOHMH inspections | `ENABLE_LIVE_NYC_OPEN_DATA=true` | Simulated land use, permitted-café counts and public-record leads |
| Licensed listing feed | `BROKER_FEED_URL` + `BROKER_FEED_API_KEY` | Reported as "not configured" |
| Claude API | `ANTHROPIC_API_KEY` | Deterministic templates; rule-based lease-term extraction |
| Stripe Checkout + webhook | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | "Simulated checkout" page (no money moves) |
| Supabase Auth / Storage | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | Local scrypt passwords / local-disk evidence storage |
| AI voice calls | `ENABLE_AI_VOICE_CALLS` **and** `AI_VOICE_COMPLIANCE_ATTESTED` | **Disabled** (the default). No voice provider is wired; human calling is the workflow |

> The live code paths for Google, Census, NYC Open Data, Stripe, Supabase and Claude are implemented but were **not exercised** in the build sandbox, which had no credentials and no outbound access to those hosts. Verify each one with real keys before launch.

## Architecture

```
Next.js (App Router, server actions)  ── src/app
  /app/*      SME portal: onboarding, market report + map, checkout, properties, financials, decision report
  /admin/*    Staff: pipeline, engagement workbench, property CRM, outreach, approvals, inspections, costs, audit
  /field/*    Field agents & licensed brokers: mobile checklist, photo/document upload, terms confirmation
  /owner/*    Property owners: submissions, availability, terms, sharing permissions
  /api/*      Stripe webhook, job runner (cron), job kick, evidence upload/download, report PDF

src/lib
  market/analysis.ts   deterministic market metrics + suitability score (published weights)
  finance/model.ts     deterministic 3-scenario P&L, break-even, cash need, payback, sensitivity
  matching.ts          property↔profile match score + composite ranking
  integrations/*       Google, Census, NYC Open Data, listing feeds; license-aware cache (data_cache)
  ai/*                 Claude structured outputs (Zod), model tiering, cost logging, anti-fabrication check
  outreach/compliance  deterministic gate: do-not-contact, calling hours, consent, AI-voice lock
  services/*           research, discovery, outreach/extraction/approvals, feasibility, inspections, final report
  jobs/*               durable Postgres queue (FOR UPDATE SKIP LOCKED, retries, dedupe)
db/migrations          PostGIS schema; RLS enabled with no client policies (server is the only data path)
```

**Key design decisions**

- **No LLM arithmetic.** Scores, financials, rankings, missing-field detection and geospatial queries are all deterministic code with unit tests. The LLM only extracts lease terms (small model) and synthesizes narratives and recommendations (strong model), working from compact pre-computed JSON.
- **Anti-fabrication.**
  - Prompts forbid inventing facts.
  - `unsupportedNumbers()` flags any figure in AI prose that doesn't appear in the input.
  - Extraction quotes are checked against the transcript.
  - A guardrail downgrades "proceed" when the recommended property's terms are unverified or its conservative scenario loses money.
  - Reports never show success probabilities.
- **Human approval gates.** These all go through `approvals` and are audit-logged:
  - AI-extracted lease terms and owner-submitted terms, before any client sees them.
  - Outbound email drafts.
  - AI-voice requests.
  - Brokerage handoffs.
  - Final reports.
- **Regulated activity.** Negotiation and representation are routed to licensed brokers. An inspection flagged as "brokerage activity" can only be assigned to a `broker` user with a license number on file.
- **Data licensing.**
  - Google Places content is cached for ≤30 days; place IDs are retained.
  - Attribution is shown on the map and in the source lists.
  - Listing sites are never scraped. Leads come only from licensed feeds, public records, brokers and owners.
- **Tenancy.**
  - SMEs see only their organization's engagements, and only approved or verified terms. Landlord contacts stay in the CRM.
  - Field users see only the inspections assigned to them.
  - Owners see only their own properties.
  - Evidence and PDFs are served only through authorized routes.
- **Cost efficiency.**
  - External data is cached and reused across engagements.
  - Verified rent comparables are reused as a proprietary benchmark.
  - When inputs are unchanged (input hashes match), the previous narrative is reused at zero tokens.
  - The system prompt is prompt-cached.
  - Token and API cost is tracked per engagement (`/admin/costs`).
- **Durable jobs.** Jobs live in Postgres. Each action drains the queue after its response (`after()`), pages that are waiting nudge `/api/jobs/kick`, and Vercel Cron (`vercel.json`) is the backstop. `npm run jobs` runs a standalone worker.

## Deploying (Vercel + Supabase)

1. Create a Supabase project and enable PostGIS (the migration does `create extension postgis`). Set `DATABASE_URL` to the pooled connection string, then run `npm run db:migrate`. Run `db:seed` only for demo environments; it creates SIMULATED properties and demo accounts.
2. Create a private Storage bucket named `evidence`.
3. Set the env vars from `.env.example` in Vercel, including `SESSION_SECRET` and `CRON_SECRET`.
4. Add a Stripe webhook pointing to `/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `checkout.session.async_payment_failed`.
5. Vercel Hobby plans allow only daily crons, so on Hobby either upgrade or call `/api/jobs/run` from an external scheduler.

## Known limitations / next steps

- No automated email sending: approved drafts are sent by staff from their own mailbox and then marked "sent".
- No speech-to-text: call notes or consented transcripts are pasted in by hand.
- Google Places Nearby returns at most 20 places per query. Tile the search for dense areas.
- Demographics come from the single tract containing the target. Use population-weighted aggregation over the radius instead.
- The demand model uses proxies (density, income, transit share, review volume), not foot-traffic counts. A licensed foot-traffic dataset would improve it.
- Feedback from transaction outcomes (which leases were signed and how the businesses performed) isn't captured yet.

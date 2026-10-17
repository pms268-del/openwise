// Central configuration. Every external integration is optional: when its credentials are
// missing the platform uses an explicitly labeled mock adapter and says so in the UI and reports.
const e = process.env;

export const env = {
  databaseUrl: e.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/siteiq",
  sessionSecret: e.SESSION_SECRET ?? "dev-only-insecure-session-secret-change-me-0123456789",
  appUrl: e.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  cronSecret: e.CRON_SECRET ?? "",

  googleServerKey: e.GOOGLE_MAPS_SERVER_KEY ?? "",
  googleBrowserKey: e.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "",

  censusApiKey: e.CENSUS_API_KEY ?? "",
  liveCensus: e.ENABLE_LIVE_CENSUS === "true",
  nycOpenDataToken: e.NYC_OPEN_DATA_APP_TOKEN ?? "",
  liveNycOpenData: e.ENABLE_LIVE_NYC_OPEN_DATA === "true",

  anthropicKey: e.ANTHROPIC_API_KEY ?? "",
  modelReasoning: e.AI_MODEL_REASONING ?? "claude-opus-5-5",
  modelExtraction: e.AI_MODEL_EXTRACTION ?? "claude-haiku-5-5",

  stripeSecret: e.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET ?? "",
  paidResearchPriceCents: Number(e.PAID_RESEARCH_PRICE_CENTS ?? 49900),

  supabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: e.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseBucket: e.SUPABASE_STORAGE_BUCKET ?? "evidence",

  // AI voice calling stays disabled unless BOTH flags are set by an operator after legal review.
  aiVoiceEnabled: e.ENABLE_AI_VOICE_CALLS === "true" && e.AI_VOICE_COMPLIANCE_ATTESTED === "true",
};

export const integrations = {
  googleMaps: () => Boolean(env.googleServerKey),
  anthropic: () => Boolean(env.anthropicKey),
  stripe: () => Boolean(env.stripeSecret),
  supabaseAuth: () => Boolean(env.supabaseUrl && env.supabaseAnonKey),
  supabaseStorage: () => Boolean(env.supabaseUrl && env.supabaseServiceKey),
  census: () => env.liveCensus,
  nycOpenData: () => env.liveNycOpenData,
};

export function integrationStatus() {
  return {
    googleMaps: integrations.googleMaps() ? "live" : "mock",
    anthropic: integrations.anthropic() ? "live" : "mock",
    stripe: integrations.stripe() ? "live" : "mock",
    supabaseAuth: integrations.supabaseAuth() ? "live" : "local",
    storage: integrations.supabaseStorage() ? "supabase" : "local-disk",
    census: integrations.census() ? "live" : "mock",
    nycOpenData: integrations.nycOpenData() ? "live" : "mock",
    aiVoice: env.aiVoiceEnabled ? "enabled" : "disabled",
  } as const;
}

import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { Stat, usd } from "@/components/ui";

export default async function Costs() {
  await requireUser(["admin"]);
  const byPurpose = await sql`select purpose, model, count(*)::int as calls, sum(input_tokens)::int as input, sum(output_tokens)::int as output, sum(cache_read_tokens)::int as cached, sum(cost_usd) as cost, bool_or(is_mock) as mock from ai_usage group by 1,2 order by cost desc nulls last`;
  const byApi = await sql`select provider, count(*)::int as calls, count(*) filter (where cached)::int as cached, count(*) filter (where is_mock)::int as mock, sum(cost_usd) as cost from api_usage group by 1 order by 2 desc`;
  const perReport = await sql`select bp.business_name, e.id, e.status,
      (select coalesce(sum(cost_usd),0) from ai_usage a where a.engagement_id = e.id) as ai, (select coalesce(sum(cost_usd),0) from api_usage a where a.engagement_id = e.id) as api,
      (select count(*)::int from market_reports m where m.engagement_id = e.id) as market_versions, (select count(*)::int from final_reports f where f.engagement_id = e.id) as final_versions
    from engagements e join business_profiles bp on bp.id = e.business_profile_id order by e.created_at desc limit 50`;
  const total = perReport.reduce((s, r) => s + Number(r.ai) + Number(r.api), 0);
  const cacheHits = byApi.reduce((s, r) => s + r.cached, 0), apiCalls = byApi.reduce((s, r) => s + r.calls, 0);
  return (
    <div className="space-y-4">
      <h1 className="h1">AI & API cost tracking</h1>
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Total cost (recent engagements)" value={usd(total)} />
        <Stat label="Avg cost per engagement" value={`$${(total / Math.max(1, perReport.length)).toFixed(2)}`} />
        <Stat label="External data cache hit rate" value={`${Math.round((cacheHits / Math.max(1, apiCalls)) * 100)}%`} hint={`${cacheHits}/${apiCalls} lookups`} />
      </div>
      <div className="card overflow-x-auto"><div className="h2 mb-2">LLM usage by purpose</div><table className="table"><thead><tr><th>Purpose</th><th>Model</th><th>Calls</th><th>Input tok</th><th>Output tok</th><th>Cache-read tok</th><th>Cost</th></tr></thead>
        <tbody>{byPurpose.map((r) => <tr key={r.purpose + r.model}><td>{r.purpose}</td><td>{r.model}{r.mock && " (fallback, no cost)"}</td><td>{r.calls}</td><td>{r.input}</td><td>{r.output}</td><td>{r.cached}</td><td>${Number(r.cost ?? 0).toFixed(4)}</td></tr>)}</tbody></table></div>
      <div className="card overflow-x-auto"><div className="h2 mb-2">External APIs</div><table className="table"><thead><tr><th>Provider</th><th>Lookups</th><th>Served from cache</th><th>Simulated</th><th>Est. cost</th></tr></thead>
        <tbody>{byApi.map((r) => <tr key={r.provider}><td>{r.provider}</td><td>{r.calls}</td><td>{r.cached}</td><td>{r.mock}</td><td>${Number(r.cost ?? 0).toFixed(3)}</td></tr>)}</tbody></table></div>
      <div className="card overflow-x-auto"><div className="h2 mb-2">Cost per research engagement</div><table className="table"><thead><tr><th>Engagement</th><th>Status</th><th>AI</th><th>APIs</th><th>Market versions</th><th>Final versions</th></tr></thead>
        <tbody>{perReport.map((r) => <tr key={r.id}><td>{r.business_name}</td><td>{r.status}</td><td>${Number(r.ai).toFixed(4)}</td><td>${Number(r.api).toFixed(3)}</td><td>{r.market_versions}</td><td>{r.final_versions}</td></tr>)}</tbody></table></div>
    </div>
  );
}

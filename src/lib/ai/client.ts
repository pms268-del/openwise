// Claude API wrapper: structured JSON outputs validated with Zod, usage/cost tracking per engagement,
// model tiering (small model for extraction, strong model for synthesis), and prompt caching of the
// stable system prompt. Without ANTHROPIC_API_KEY a deterministic, labeled fallback is used.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { env, integrations } from "../env";
import { sql } from "../db";

// USD per 1M tokens [input, output, cache read]
const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: env.anthropicKey }));

export type AiResult<T> = { data: T; model: string; isMock: boolean; usage?: { input: number; output: number; cacheRead: number; costUsd: number } };

export class AiRefusalError extends Error {}

export async function aiStructured<S extends z.ZodType>(opts: {
  purpose: string;
  tier: "extraction" | "reasoning";
  system: string;
  input: unknown;                 // compact structured input; serialized once
  schema: S;
  fallback: () => z.infer<S>;     // deterministic template/rule-based output used when AI is not configured
  engagementId?: string | null;
  maxTokens?: number;
}): Promise<AiResult<z.infer<S>>> {
  if (!integrations.anthropic()) {
    await sql`insert into ai_usage (engagement_id, purpose, model, is_mock) values (${opts.engagementId ?? null}, ${opts.purpose}, 'fallback', true)`;
    return { data: opts.fallback(), model: "fallback", isMock: true };
  }
  const model = opts.tier === "extraction" ? env.modelExtraction : env.modelReasoning;
  const reasoning = opts.tier === "reasoning";
  const res = await getClient().beta.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(opts.input) }],
    output_config: { format: betaZodOutputFormat(opts.schema), effort: reasoning ? "high" : "low" },
    // Server-side refusal fallback for the reasoning tier (not supported on Haiku).
    ...(reasoning && model !== "claude-haiku-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  const u = res.usage;
  const [pi, po, pc] = PRICES[res.model] ?? PRICES[model] ?? [0, 0, 0];
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cost = (u.input_tokens * pi + u.output_tokens * po + cacheRead * pc + (u.cache_creation_input_tokens ?? 0) * pi * 1.25) / 1e6;
  await sql`insert into ai_usage (engagement_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
            values (${opts.engagementId ?? null}, ${opts.purpose}, ${res.model}, ${u.input_tokens}, ${u.output_tokens}, ${cacheRead}, ${cost})`;
  if (res.stop_reason === "refusal") throw new AiRefusalError(`Model declined (${res.stop_details?.category ?? "unknown"})`);
  if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new Error(`AI output incomplete (${res.stop_reason})`);
  return { data: res.parsed_output, model: res.model, isMock: false, usage: { input: u.input_tokens, output: u.output_tokens, cacheRead, costUsd: cost } };
}

/** Flags numbers in AI prose that do not appear in the structured input (anti-fabrication check). */
export function unsupportedNumbers(text: string, input: unknown): string[] {
  const src = JSON.stringify(input).replace(/,/g, "");
  const nums = text.replace(/,/g, "").match(/\$?\d+(\.\d+)?%?/g) ?? [];
  return [...new Set(nums)].filter((n) => {
    const bare = n.replace(/[$%]/g, "");
    if (Number(bare) < 10) return false; // small counts/ordinals are fine
    return !src.includes(bare) && !src.includes(String(Math.round(Number(bare))));
  });
}

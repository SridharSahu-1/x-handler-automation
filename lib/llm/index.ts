import { generateText, Output, embed, isStepCount, type ToolSet, type LanguageModel } from "ai";
import type { z } from "zod";
import { languageModels, embeddingModel, type ProviderName } from "./providers";
import { getSetting } from "../settings";
import { log } from "../log";
import { isMock, mockObject, mockText } from "./mock";

type Common = {
  system?: string;
  prompt: string;
  /** Put this provider first (e.g. the critic prefers a different model family than the writer). */
  prefer?: ProviderName;
  temperature?: number;
};

async function chain(prefer?: ProviderName): Promise<ProviderName[]> {
  const order = await getSetting("llmOrder").catch(() => ["gemini", "groq", "openrouter"] as ProviderName[]);
  return prefer ? [prefer, ...order.filter((p) => p !== prefer)] : order;
}

// Free tiers run out (daily quota) or get overloaded. Retrying those on every call burns the
// step's time budget, so a model that hit one sits out for a while (per warm instance).
const cooldownUntil = new Map<string, number>();
const QUOTA_COOLDOWN_MS = 30 * 60_000;
const OVERLOAD_COOLDOWN_MS = 3 * 60_000;

export function cooldownFor(message: string): number {
  // Per-day limits outlast any wait worth doing inside a run.
  if (/per day|\bTPD\b|\bRPD\b|exceeded your current quota/i.test(message)) return QUOTA_COOLDOWN_MS;
  // Per-minute limits (Groq: "tokens per minute ... try again in 50.6s") clear quickly.
  const retryIn = message.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  if (retryIn) return Math.ceil((Number(retryIn[1] ?? 0) * 60 + Number(retryIn[2])) * 1000) + 2000;
  if (/per minute|\b[TR]PM\b/i.test(message)) return 60_000;
  if (/quota|rate.?limit|too many requests|\b429\b|resource.?exhausted/i.test(message)) return QUOTA_COOLDOWN_MS;
  if (/high demand|overloaded|unavailable|\b503\b/i.test(message)) return OVERLOAD_COOLDOWN_MS;
  return 0;
}

/** Runs the request against each configured provider's models until one succeeds. */
async function withFallback<T>(prefer: ProviderName | undefined, fn: (model: LanguageModel) => Promise<T>): Promise<T> {
  const errors: string[] = [];
  const all = (await chain(prefer)).flatMap((p) => languageModels(p).map((m) => ({ ...m, key: `${p}:${m.id}` })));
  const ready = all.filter((m) => (cooldownUntil.get(m.key) ?? 0) <= Date.now());
  // If every model is cooling down, try them all anyway rather than fail outright.
  for (const m of ready.length ? ready : all) {
    try {
      return await fn(m.model);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${m.key}: ${msg}`);
      const pause = cooldownFor(msg);
      if (pause) cooldownUntil.set(m.key, Date.now() + pause);
      await log("llm", `${m.key} failed${pause ? ` (sitting out ${Math.round(pause / 1000)}s)` : ""}, falling back: ${msg.slice(0, 300)}`, { level: "warn" });
    }
  }
  throw new Error(`All LLM providers failed. ${errors.join(" | ") || "No provider configured."}`);
}

export async function llmText(opts: Common & { tools?: ToolSet; maxSteps?: number }) {
  if (isMock()) return mockText(opts.prompt);
  return withFallback(opts.prefer, async (model) => {
    const res = await generateText({
      model,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      tools: opts.tools,
      maxRetries: 1,
      stopWhen: isStepCount(opts.maxSteps ?? 1),
    });
    return res.text;
  });
}

export async function llmObject<S extends z.ZodType>(opts: Common & { schema: S }): Promise<z.infer<S>> {
  if (isMock()) return opts.schema.parse(mockObject(opts.system, opts.prompt));
  return withFallback(opts.prefer, async (model) => {
    const res = await generateText({
      model,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      output: Output.object({ schema: opts.schema }),
      maxRetries: 1,
    });
    return res.output as z.infer<S>;
  });
}

export async function embedText(text: string): Promise<number[] | null> {
  const model = embeddingModel();
  if (!model) return null;
  try {
    const { embedding } = await embed({ model, value: text });
    return embedding;
  } catch (e) {
    await log("llm", `embedding failed: ${e instanceof Error ? e.message : e}`, { level: "warn" });
    return null;
  }
}

export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

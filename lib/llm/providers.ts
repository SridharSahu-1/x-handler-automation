import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, EmbeddingModel } from "ai";
import { optionalEnv } from "../env";

export type ProviderName = "gemini" | "groq" | "openrouter";

const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: "gemini-3.5-flash,gemini-3.5-flash-lite",
  groq: "openai/gpt-oss-120b,openai/gpt-oss-20b",
  openrouter: "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free",
};
const MODEL_ENV: Record<ProviderName, string> = { gemini: "GEMINI_MODEL", groq: "GROQ_MODEL", openrouter: "OPENROUTER_MODEL" };

/**
 * The provider's models in fallback order. *_MODEL may be a comma-separated list: free tiers
 * meter each model separately, so a second model is extra daily quota, not just a backup.
 */
export function languageModels(name: ProviderName): { id: string; model: LanguageModel }[] {
  const ids = (optionalEnv(MODEL_ENV[name]) ?? DEFAULT_MODELS[name]).split(",").map((s) => s.trim()).filter(Boolean);
  const make = factory(name);
  return make ? ids.map((id) => ({ id, model: make(id) })) : [];
}

/** The provider's first model, or null when it has no key. */
export function languageModel(name: ProviderName): LanguageModel | null {
  return languageModels(name)[0]?.model ?? null;
}

function factory(name: ProviderName): ((id: string) => LanguageModel) | null {
  switch (name) {
    case "gemini": {
      const apiKey = optionalEnv("GOOGLE_GENERATIVE_AI_API_KEY");
      return apiKey ? createGoogleGenerativeAI({ apiKey }) : null;
    }
    case "groq": {
      const apiKey = optionalEnv("GROQ_API_KEY");
      return apiKey ? createGroq({ apiKey }) : null;
    }
    case "openrouter": {
      const apiKey = optionalEnv("OPENROUTER_API_KEY");
      return apiKey
        ? createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey, supportsStructuredOutputs: true })
        : null;
    }
  }
}

export function embeddingModel(): EmbeddingModel | null {
  const apiKey = optionalEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!apiKey) return null;
  return createGoogleGenerativeAI({ apiKey }).embedding(
    optionalEnv("GEMINI_EMBED_MODEL") ?? "gemini-embedding-001",
  );
}

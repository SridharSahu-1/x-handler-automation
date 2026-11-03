import { describe, it, expect } from "vitest";
import { cooldownFor } from "@/lib/llm";

describe("provider cooldown", () => {
  it("sits a provider out longer for quota than for overload, and not at all for schema errors", () => {
    const quota = cooldownFor("AI_APICallError: You exceeded your current quota, please check your plan");
    const busy = cooldownFor("This model is currently experiencing high demand. Spikes in demand are usually temporary.");
    expect(quota).toBeGreaterThan(busy);
    expect(busy).toBeGreaterThan(0);
    expect(cooldownFor("Rate limit reached for model openai/gpt-oss-120b")).toBe(quota);
  });

  it("per-minute limits wait only as long as the provider says", () => {
    const groq = "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7303, Requested 7452. Please try again in 50.6625s.";
    expect(cooldownFor(groq)).toBeGreaterThan(50_000);
    expect(cooldownFor(groq)).toBeLessThan(60_000);
    expect(cooldownFor("Please try again in 1m5.2s")).toBeGreaterThan(65_000);
    expect(cooldownFor("Rate limit reached on requests per minute (RPM)")).toBe(60_000);
    expect(cooldownFor("invalid JSON schema for response_format")).toBe(0);
    expect(cooldownFor("No object generated: response did not match schema.")).toBe(0);
  });
});

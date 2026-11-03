import { z } from "zod";
import { llmObject } from "../llm";
import { slopViolations } from "./rules";
import { tweetLength, MAX_TWEET } from "./length";
import { codeProblems } from "./codecheck";
import type { GateScores, Variant, SourceRef } from "../db/schema";

const criticSchema = z.object({
  human: z.number().min(0).max(10).describe("10 = indistinguishable from a sharp human dev; 0 = obvious AI"),
  originality: z.number().min(0).max(10).describe("10 = an angle or line nobody else posting about this would write; 0 = the generic take everyone posts"),
  specificity: z.number().min(0).max(10).describe("concrete names/numbers/versions vs vague"),
  value: z.number().min(0).max(10).describe("would a dev save, share or reply to this"),
  reportRisk: z.number().min(0).max(10).describe("chance it reads as rage-bait, punching down, or spam"),
  personal: z.number().min(0).max(10).describe("how much it is about the author's own life, habits, routine or feelings instead of the topic; 0 = purely about the topic"),
  notes: z.string().describe("the single most important fix, specific and short"),
});

export async function critique(text: string): Promise<GateScores> {
  return llmObject({
    prefer: "groq", // a different model family than the writer catches its tics
    schema: criticSchema,
    system:
      "You are a senior engineer with 10 years on dev Twitter and zero patience for AI-written posts, generic takes or engagement bait. Score harshly; 7+ should be rare.",
    prompt: `POST:\n"""${text}"""\n\nScore it.`,
    temperature: 0.2,
  });
}

const factSchema = z.object({
  unsupported: z.array(z.string()).describe("factual claims (names, numbers, versions, dates, features) NOT supported by the sources or author notes"),
});

export async function unsupportedClaims(text: string, sourcesText: string, voice: string): Promise<string[]> {
  if (!/\d|v\d|released|launch|announc|ships?|added|supports?/i.test(text)) return [];
  const { unsupported } = await llmObject({
    prefer: "groq",
    schema: factSchema,
    system: "You are a strict fact checker. Opinions are fine; only flag factual claims that are not backed by the provided material.",
    prompt: `SOURCES:\n${sourcesText.slice(0, 8000)}\n\nAUTHOR NOTES:\n${voice.slice(0, 3000)}\n\nPOST:\n"""${text}"""`,
    temperature: 0,
  });
  return unsupported;
}

export type GateResult = { pass: boolean; problems: string[]; scores?: GateScores };

/** All quality gates for one variant. Cheap deterministic checks run first. */
export async function runGates(
  v: Variant,
  ctx: { sourcesText: string; voice: string; bannedPhrases: string[]; personal?: boolean },
): Promise<GateResult> {
  const problems: string[] = [];
  const len = tweetLength(v.text);
  if (len > MAX_TWEET) problems.push(`too long: ${len}/280`);
  const slop = slopViolations(v.text, ctx.bannedPhrases);
  if (slop.length) problems.push(`AI-sounding: ${slop.join(", ")}`);
  if (/\b(af|lol|lmao|ngl|fr|tbh)\b/i.test(v.text)) problems.push("casual slang (af/lol/ngl): keep it professional");
  if (/https?:\/\//.test(v.text)) problems.push("link in main post (move it to selfReply)");
  // Structure is what makes a post readable on X; a long single block reads like a comment, not a post.
  if (!v.text.includes("\n") && v.text.length > 140) problems.push("one flat block: split into a hook line, 2-4 short lines, and a takeaway line");
  if (v.selfReply && tweetLength(v.selfReply) > MAX_TWEET) problems.push("selfReply too long");
  if (v.asset?.kind === "code") {
    const errs = codeProblems(v.asset.language, v.asset.code);
    if (errs.length) problems.push(`code snippet doesn't compile: ${errs.slice(0, 2).join("; ")}`);
    if (v.asset.code.split("\n").length > 16) problems.push("code snippet too long (max 16 lines)");
  }
  if (problems.length) return { pass: false, problems };

  const unsupported = await unsupportedClaims(v.text, ctx.sourcesText, ctx.voice);
  if (unsupported.length) problems.push(`unsupported claims: ${unsupported.join("; ")}`);

  const scores = await critique(v.text);
  if (scores.human < 7) problems.push(`sounds AI-written (${scores.human}/10): ${scores.notes}`);
  if ((scores.originality ?? 10) < 6) problems.push(`generic angle (${scores.originality}/10): ${scores.notes}`);
  if (scores.specificity < 6) problems.push(`too vague (${scores.specificity}/10): ${scores.notes}`);
  if (scores.reportRisk > 3) problems.push(`report risk ${scores.reportRisk}/10: ${scores.notes}`);
  if (!ctx.personal && (scores.personal ?? 0) >= 4) problems.push(`too personal (${scores.personal}/10): make it about the topic, not the author`);
  return { pass: problems.length === 0, problems, scores };
}

export function sourcesToText(sources: (SourceRef & { body?: string })[]) {
  return sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.body ?? s.excerpt ?? ""}`).join("\n\n---\n\n");
}

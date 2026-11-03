import { z } from "zod";
import { llmObject } from "../llm";
import { WRITER_SYSTEM, FORMAT_GUIDES, PERSONAL_NOTE } from "./prompts";
import type { Format } from "../settings";
import type { Variant, AssetSpec } from "../db/schema";

// Strict JSON modes (Groq, Gemini) need every key required, closed objects and no tuples, so optional
// fields are nullable and table rows are objects; toVariant() maps them back to AssetSpec.
const assetSchema = z.union([
  z.strictObject({ kind: z.literal("code"), language: z.string(), code: z.string(), title: z.string().nullable() }),
  z.strictObject({ kind: z.literal("list"), title: z.string(), items: z.array(z.string()).describe("3 to 8 items") }),
  z.strictObject({
    kind: z.literal("compare"),
    title: z.string(),
    left: z.string(),
    right: z.string(),
    rows: z.array(z.strictObject({ aspect: z.string(), left: z.string(), right: z.string() })).describe("2 to 7 rows"),
  }),
  z.strictObject({
    kind: z.literal("headline"),
    kicker: z.string().describe("2-4 word label, e.g. the benchmark, product or event name"),
    title: z.string().describe("the big stat or claim, max 60 chars"),
    points: z.array(z.string()).describe("2 or 3 key facts from the sources, max 50 chars each"),
  }),
  z.null(), // inside the union: .nullable() would nest anyOf, which Groq rejects
]);

const variantSchema = z.object({
  text: z.string().describe("the post itself, <= 250 chars, no links (the source link is added automatically)"),
  selfReply: z.string().nullable().describe("first reply: source link or extra detail, or null"),
  asset: assetSchema.describe("image content, or null if the post is stronger as plain text"),
});

type RawVariant = z.infer<typeof variantSchema>;

function toAsset(a: RawVariant["asset"]): AssetSpec | null {
  if (!a) return null;
  if (a.kind === "code") return { kind: "code", language: a.language, code: a.code, ...(a.title ? { title: a.title } : {}) };
  if (a.kind === "headline") return a.points.length ? { kind: "headline", kicker: a.kicker, title: a.title, points: a.points.slice(0, 3) } : null;
  if (a.kind === "list") return a.items.length >= 3 ? { kind: "list", title: a.title, items: a.items.slice(0, 8) } : null;
  if (a.rows.length < 2) return null;
  return { ...a, rows: a.rows.slice(0, 7).map((r) => [r.aspect, r.left, r.right] as [string, string, string]) };
}

// Models sometimes echo escaped text from web sources, even double-escaped ("-&amp;gt;").
const decodeOnce = (s: string) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const decode = (s: string) => decodeOnce(decodeOnce(s));

// Missing space after a comma ("springboot,express") copied from the author's casual samples; numbers like 1,000 stay.
const tidy = (s: string) => decode(s).replace(/,(?=[A-Za-z])/g, ", ").trim();

export function toVariant(v: RawVariant): Variant {
  return { text: tidy(v.text), ...(v.selfReply ? { selfReply: decode(v.selfReply).trim() } : {}), asset: toAsset(v.asset) };
}

export const variantsSchema = z.object({ variants: z.array(variantSchema).describe("exactly 3 variants") });

export async function writeVariants(input: {
  voice: string;
  pillar: string;
  format: Format;
  topic: string;
  sourcesText: string;
  avoid: string[];
  personal?: boolean;
}): Promise<Variant[]> {
  const { variants } = await llmObject({
    schema: variantsSchema,
    system: WRITER_SYSTEM,
    temperature: 0.9,
    prompt: `${input.voice ? `${input.voice}\n` : ""}${input.personal ? `\n${PERSONAL_NOTE}\n` : ""}
PILLAR: ${input.pillar}
FORMAT: ${input.format} — ${FORMAT_GUIDES[input.format]}
TOPIC: ${input.topic}

SOURCE PACK (only facts from here or the author notes):
${input.sourcesText.slice(0, 8000)}

RECENT POSTS (don't repeat these angles):
${input.avoid.map((a) => `- ${a}`).join("\n") || "- none yet"}

Write 3 genuinely different variants (different hooks/angles, not rephrasings), each structured as the system prompt describes. Every variant needs an image asset, the one that fits best: code (tip-code, real snippet), list (cheat-sheets), compare (X vs Y), headline (the key stat/claim + 2-3 facts; the default for news and takes). Asset facts must come from the sources.`,
  });
  if (!variants.length) throw new Error("writer returned no variants");
  return variants.slice(0, 3).map(toVariant);
}

export async function rewriteVariant(v: Variant, problems: string[], ctx: { voice: string; sourcesText: string; format: Format; personal?: boolean }) {
  const { variant } = await llmObject({
    schema: z.object({ variant: variantSchema }),
    system: WRITER_SYSTEM,
    temperature: 0.7,
    prompt: `${ctx.voice}

SOURCE PACK:
${ctx.sourcesText.slice(0, 8000)}

FORMAT: ${ctx.format} — ${FORMAT_GUIDES[ctx.format]}
${ctx.personal ? `\n${PERSONAL_NOTE}\n` : ""}
This draft failed review:
"""${v.text}"""
${v.asset ? `Asset: ${JSON.stringify(v.asset)}` : ""}

Problems to fix:
${problems.map((p) => `- ${p}`).join("\n")}

Rewrite it so every problem is fixed while keeping the core idea. Return the rewritten variant.`,
  });
  return toVariant(variant);
}

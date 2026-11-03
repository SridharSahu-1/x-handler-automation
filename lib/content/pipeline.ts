import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { getSettings, type Format } from "../settings";
import { collectTrends, recentUnusedTrends } from "../trends";
import { chooseArm } from "./bandit";
import { buildSourcePack } from "./research";
import { writerContext } from "./voice";
import { writeVariants, rewriteVariant } from "./draft";
import { runGates, sourcesToText } from "./gates";
import { maxSimilarity, recentPostEmbeddings } from "./novelty";
import { renderAsset } from "../assets/render";
import { storePng } from "../assets/store";
import type { Variant, SourceRef, AssetSpec } from "../db/schema";
import { tweetLength, MAX_TWEET } from "./length";
import { log } from "../log";

export type TopicPlan = {
  pillar: string;
  format: Format;
  topic: string;
  trendId: number | null;
  url: string | null;
};

/** Collect trends, then let the bandit choose pillar×format among pillars that have fresh material. */
export async function planTopic(opts: { forceTopic?: string } = {}): Promise<TopicPlan> {
  const s = await getSettings();
  if (opts.forceTopic) {
    const { pillar, format } = chooseArm(s.bandit, s.pillars);
    return { pillar, format, topic: opts.forceTopic, trendId: null, url: null };
  }
  let trends = await recentUnusedTrends(20);
  if (trends.length < 5) {
    await collectTrends(s.pillars);
    trends = await recentUnusedTrends(20);
  }
  const [last] = await db().select().from(schema.drafts).where(eq(schema.drafts.status, "posted")).orderBy(desc(schema.drafts.id)).limit(1);
  // Trending topics first: evergreen pillars only get a turn when nothing fresh fits any pillar.
  const available = new Set(trends.map((t) => t.pillar ?? "").filter((p) => s.pillars.includes(p)));
  if (!available.size) for (const p of s.pillars) available.add(p);
  const { pillar, format } = chooseArm(s.bandit, s.pillars, { avoidFormat: last?.format, availablePillars: available });
  const trend = trends.find((t) => t.pillar === pillar);
  if (trend) {
    await db().update(schema.trends).set({ usedAt: new Date() }).where(eq(schema.trends.id, trend.id));
    return { pillar, format, topic: trend.title, trendId: trend.id, url: trend.url };
  }
  // Evergreen: the writer picks a concrete sub-topic from the author's own notes.
  return { pillar, format, topic: `A specific, currently debated ${pillar} topic developers are discussing this month`, trendId: null, url: null };
}

// Drafting is split into stages so each fits in one workflow step (Vercel caps a step at 5 min)
// and a free-tier rate limit only retries the stage that hit it.
const STALE_MS = 30 * 60_000;

async function loadDraft(id: number) {
  const [d] = await db().select().from(schema.drafts).where(eq(schema.drafts.id, id));
  if (!d) throw new Error(`draft ${id} not found`);
  return d;
}

async function draftContext(d: { sources: SourceRef[]; format: string | null; personal: boolean }) {
  const s = await getSettings();
  return { sourcesText: sourcesToText(d.sources), voice: await writerContext(d.personal), bannedPhrases: s.bannedPhrases, format: (d.format ?? "take") as Format, personal: d.personal };
}

/** Stage 1: research + 3 unreviewed variants. Returns the draft id and how many variants to review. */
export async function startDraft(plan: TopicPlan, kind: "daily" | "manual" | "intro" = "daily") {
  // Drafts whose run died mid-way never reach a failed state on their own.
  await db()
    .update(schema.drafts)
    .set({ status: "failed", error: "Interrupted before it finished.", updatedAt: new Date() })
    .where(and(eq(schema.drafts.status, "generating"), lt(schema.drafts.updatedAt, new Date(Date.now() - STALE_MS))));
  // Most posts are professional takes on the topic; only an occasional one may use the author's own work.
  const personal = Math.random() < (await getSettings()).personalShare;
  const [draft] = await db()
    .insert(schema.drafts)
    .values({ kind, pillar: plan.pillar, format: plan.format, topic: plan.topic, trendId: plan.trendId, status: "generating", personal })
    .returning();
  try {
    const voice = await writerContext(personal);
    const pack = plan.url ? await buildSourcePack({ title: plan.topic, url: plan.url }) : [];
    // Bodies are kept (already trimmed by buildSourcePack) so later stages can fact-check without re-fetching.
    const sources: SourceRef[] = pack.map(({ title, url, excerpt, body }) => ({ title, url, excerpt, body }));
    const recentTexts = (await db().select({ text: schema.posts.text }).from(schema.posts).orderBy(desc(schema.posts.id)).limit(10)).map((r) => r.text);
    const variants = await writeVariants({ voice, pillar: plan.pillar, format: plan.format, topic: plan.topic, sourcesText: sourcesToText(sources), avoid: recentTexts, personal });
    await db().update(schema.drafts).set({ variants, sources, updatedAt: new Date() }).where(eq(schema.drafts.id, draft.id));
    return { draftId: draft.id, count: variants.length };
  } catch (e) {
    await failDraft(draft.id, e);
    throw e;
  }
}

const BULLET = /^\s*(?:[-→•*]|->)\s/;

/**
 * Free models often overshoot 280 even after a rewrite. Structured posts can lose their last
 * bullet (or trailing line) without losing the point; the hook line always stays.
 */
export function fitToLength(text: string): string {
  let lines = text.split("\n");
  while (tweetLength(lines.join("\n").trim()) > MAX_TWEET) {
    const content = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim());
    if (content.length <= 1) break;
    const bullets = content.filter(({ l, i }) => i > 0 && BULLET.test(l));
    const drop = bullets.length > 1 ? bullets[bullets.length - 1].i : content[content.length - 1].i;
    lines = lines.filter((_, i) => i !== drop);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Stage 2 (once per variant): quality gates with up to 2 rewrites, then the novelty check. */
export async function reviewVariant(draftId: number, index: number) {
  const d = await loadDraft(draftId);
  let v = d.variants[index];
  if (!v || v.scores || v.problems) return; // already reviewed (step replay)
  const ctx = await draftContext(d);
  // Rewrites are the expensive part on free tiers: at most 2, and none once the step's
  // time budget (Vercel stops a step at 5 min) is mostly used.
  const started = Date.now();
  let gate = await runGates(v, ctx);
  for (let attempt = 0; !gate.pass && attempt < 2 && Date.now() - started < 150_000; attempt++) {
    v = await rewriteVariant(v, gate.problems, ctx);
    gate = await runGates(v, ctx);
  }
  if (!gate.pass && gate.problems.every((p) => p.startsWith("too long"))) {
    const fitted = { ...v, text: fitToLength(v.text) };
    if (fitted.text !== v.text) {
      v = fitted;
      gate = await runGates(v, ctx);
    }
  }
  const novelty = await maxSimilarity(v.text, await recentPostEmbeddings());
  const problems = [...gate.problems];
  if (novelty.similarity > 0.9) problems.push(`too similar to a recent post (${novelty.similarity.toFixed(2)})`);
  const variants = [...(await loadDraft(draftId)).variants];
  variants[index] = { ...v, scores: gate.scores, problems };
  await db().update(schema.drafts).set({ variants, updatedAt: new Date() }).where(eq(schema.drafts.id, draftId));
}

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

/**
 * No post goes out as bare text: without a writer asset, the post itself becomes a headline card
 * (first line as the title, the next lines as points).
 */
export function fallbackAsset(text: string, kicker: string, sourceUrl?: string): AssetSpec {
  const lines = text.split("\n").map((l) => l.replace(/^[-→>•*]\s*/, "").trim()).filter(Boolean);
  const sentences = lines.length > 1 ? lines : text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  return {
    kind: "headline",
    kicker: clip(kicker, 40),
    title: clip(sentences[0] ?? text, 90),
    points: sentences.slice(1, 4).map((s) => clip(s, 70)),
    source: sourceUrl ? domainOf(sourceUrl) : undefined,
  };
}

/** Adds the source link where the settings say (end of post when it fits in 280, else the first reply). */
export function withSourceLink(v: Variant, url: string | undefined, placement: "post" | "reply"): Variant {
  if (!url || v.text.includes(url) || v.selfReply?.includes(url)) return v;
  const inPost = `${v.text}\n\n${url}`;
  if (placement === "post" && tweetLength(inPost) <= MAX_TWEET) return { ...v, text: inPost };
  return { ...v, selfReply: v.selfReply ? `${v.selfReply}\n\n${url}` : url };
}

/** Stage 3: best variant first, source link, images, hand over for approval. */
export async function finishDraft(draftId: number) {
  const d = await loadDraft(draftId);
  const s = await getSettings();
  // Best first: passing variants, then by critic score.
  const rank = (v: Variant) => (v.problems?.length ? 0 : 100) + (v.scores ? v.scores.human + v.scores.value + v.scores.specificity - v.scores.reportRisk : 0);
  const source = d.trendId ? d.sources[0]?.url : undefined;
  const variants = [...d.variants].sort((a, b) => rank(b) - rank(a)).map((v) => {
    const linked = withSourceLink(v, source, s.linkPlacement);
    const asset = linked.asset ?? fallbackAsset(v.text, d.pillar ?? "dev", source);
    if (asset.kind === "headline" && !asset.source && source) asset.source = domainOf(source);
    return { ...linked, asset };
  });
  for (const v of variants) {
    if (!v.asset || v.assetUrl) continue;
    try {
      v.assetUrl = await storePng(await renderAsset(v.asset), `draft-${draftId}`);
    } catch (e) {
      await log("assets", `render failed: ${e instanceof Error ? e.message : e}`, { level: "warn" });
      v.assetUrl = null;
    }
  }
  await db()
    .update(schema.drafts)
    .set({ variants, chosen: 0, assetUrl: variants[0]?.assetUrl ?? null, status: "pending", updatedAt: new Date() })
    .where(eq(schema.drafts.id, draftId));
  return draftId;
}

export async function failDraft(draftId: number, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  await db().update(schema.drafts).set({ status: "failed", error: msg, updatedAt: new Date() }).where(eq(schema.drafts.id, draftId));
}

/** All stages in one go, for callers outside a workflow (scripts, tests). */
export async function buildDraft(plan: TopicPlan, kind: "daily" | "manual" | "intro" = "daily"): Promise<number> {
  const { draftId, count } = await startDraft(plan, kind);
  try {
    for (let i = 0; i < count; i++) await reviewVariant(draftId, i);
    return await finishDraft(draftId);
  } catch (e) {
    await failDraft(draftId, e);
    throw e;
  }
}

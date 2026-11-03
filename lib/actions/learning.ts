import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getSettings, setSetting } from "../settings";
import { updateArm, armKey } from "../content/bandit";
import { log } from "../log";

/**
 * Manual-mode stand-in for metrics: your 1-tap verdict at +24h. Scores sit on the same scale as
 * engagementScore (weighted engagements per impression) so they rank sensibly against real numbers.
 */
export const RATING_SCORES: Record<number, number> = { 1: 0.002, 2: 0.01, 3: 0.03, 4: 0.08 };
export const RATING_LABELS: Record<number, string> = { 1: "💀 flopped", 2: "😐 meh", 3: "👍 decent", 4: "🔥 popped off" };

export async function recordRating(postId: number, rating: number) {
  const score = RATING_SCORES[rating];
  if (score === undefined) return "Unknown rating.";
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p) return "Post not found.";
  const existing = await db().select().from(schema.metrics).where(eq(schema.metrics.postId, postId));
  if (existing.some((m) => m.checkpoint === "24h")) return "Already rated.";
  await db().insert(schema.metrics).values({ postId, checkpoint: "24h", score });
  await updateBanditFor(postId);
  return `Noted: ${RATING_LABELS[rating]}. I'll lean ${rating >= 3 ? "into" : "away from"} ${p.format ?? "this format"} on ${p.pillar ?? "this topic"}.`;
}

/** Bandit update: did this pillar×format beat the median 24h score? */
export async function updateBanditFor(postId: number) {
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p?.pillar || !p.format) return;
  const all = await db().select().from(schema.metrics).where(eq(schema.metrics.checkpoint, "24h"));
  const mine = all.find((m) => m.postId === postId);
  if (!mine) return;
  const sorted = all.map((m) => m.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const s = await getSettings();
  await setSetting("bandit", updateArm(s.bandit, armKey(p.pillar, p.format), mine.score, median));
  await log("bandit", `${p.pillar}|${p.format} score ${mine.score.toFixed(4)} vs median ${median.toFixed(4)}`);
}

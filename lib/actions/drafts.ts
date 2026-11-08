import { and, desc, eq, inArray } from "drizzle-orm";
import { resumeHook } from "workflow/api";
import { FatalError } from "workflow";
import { db, schema } from "../db";
import { publish, unpublish, postUrl } from "../publisher";
import { embedText } from "../llm";
import { fitsTweet } from "../content/length";
import { log } from "../log";
import { canReviewDraft } from "../draft-status";
import { getSettings } from "../settings";

/** What the approval hook of a running daily-post workflow receives. Shared by Telegram + dashboard. */
export type Decision =
  | { action: "approve"; variant?: number; now?: boolean }
  | { action: "skip" }
  | { action: "regen"; reason?: string; note?: string };

export async function getDraft(id: number) {
  const [d] = await db().select().from(schema.drafts).where(eq(schema.drafts.id, id));
  return d ?? null;
}

export function draftText(d: NonNullable<Awaited<ReturnType<typeof getDraft>>>) {
  return d.editedText ?? d.variants[d.chosen]?.text ?? "";
}

/** Sends a decision to the waiting workflow; drafts outside a workflow are handled directly. */
export async function decide(draftId: number, decision: Decision): Promise<string> {
  const d = await getDraft(draftId);
  if (!d) return "Draft not found.";
  if (!canReviewDraft(d.status)) return `Draft is already ${d.status}.`;
  if (decision.action === "approve" && (await getSettings()).paused) return "Posting is paused. Resume before approving.";
  if (decision.action === "approve" && decision.variant !== undefined) {
    if (!Number.isInteger(decision.variant) || !d.variants[decision.variant]) return "Variant not found.";
    await db().update(schema.drafts).set({ chosen: decision.variant, editedText: null, updatedAt: new Date() }).where(eq(schema.drafts.id, draftId));
  }
  if (decision.action === "regen" && (decision.note || decision.reason)) {
    await db().insert(schema.feedback).values({ draftId, reason: decision.note ?? decision.reason! });
  }
  if (d.hookToken && d.status !== "expired") {
    try {
      await resumeHook(d.hookToken, decision);
      return decision.action === "approve" ? (decision.now ? "Posting now." : "Approved. It'll go out at the slot.") : decision.action === "skip" ? "Skipped." : "Regenerating…";
    } catch (e) {
      await log("actions", `resumeHook failed for draft ${draftId}: ${e instanceof Error ? e.message : e}`, { level: "warn" });
      // Workflow is gone (expired/cancelled): fall through to direct handling.
    }
  }
  if (decision.action === "approve") {
    const postId = await publishDraft(draftId);
    if (postId) {
      const { announcePosted } = await import("../telegram/posts");
      await announcePosted(postId);
    }
    return postId ? "Posted." : "Nothing to post.";
  }
  if (decision.action === "skip") {
    await setDraftStatus(draftId, "skipped");
    return "Skipped.";
  }
  return "This draft has no running workflow. Use /new to generate a fresh one.";
}

export async function setDraftStatus(id: number, status: string, error?: string) {
  await db().update(schema.drafts).set({ status, error, updatedAt: new Date() }).where(eq(schema.drafts.id, id));
}

/** Your edit becomes the post text AND a voice example (draft -> your version). */
export async function editDraft(draftId: number, text: string): Promise<string> {
  const d = await getDraft(draftId);
  if (!d) return "Draft not found.";
  if (!fitsTweet(text)) return "That's over 280 characters (X weighted count). Trim it and send again.";
  const original = d.variants[d.chosen]?.text ?? "";
  await db().update(schema.drafts).set({ editedText: text, updatedAt: new Date() }).where(eq(schema.drafts.id, draftId));
  if (original && original.trim() !== text.trim()) {
    await db().insert(schema.voiceSamples).values({ kind: "edit", prompt: original, text });
  }
  return "Saved your edit.";
}

/** Posts a draft to X (idempotent per draft) and records the post. Returns the post id. */
export async function publishDraft(draftId: number): Promise<number | null> {
  const d = await getDraft(draftId);
  if (!d) return null;
  const [existing] = await db().select().from(schema.posts).where(eq(schema.posts.draftId, draftId));
  if (existing) return existing.id;
  // Guard against double-posting if a previous attempt tweeted but crashed before recording it.
  if (d.status === "posting") {
    throw new FatalError(`Draft ${draftId} was mid-post when a previous attempt failed. Check X before retrying.`);
  }
  if (!canReviewDraft(d.status)) return null;
  const v = d.variants[d.chosen];
  const text = draftText(d);
  if (!text || !fitsTweet(text)) throw new Error("Draft text must be non-empty and fit within 280 characters.");
  const [claimed] = await db().update(schema.drafts).set({ status: "posting", updatedAt: new Date() })
    .where(and(eq(schema.drafts.id, draftId), inArray(schema.drafts.status, ["pending", "approved", "expired"])))
    .returning({ id: schema.drafts.id });
  if (!claimed) return null;
  let result: Awaited<ReturnType<typeof publish>>;
  try {
    result = await publish({ text, imageUrl: v?.assetUrl ?? null, selfReply: v?.selfReply ?? null });
  } catch (e) {
    // The provider rejected it, so nothing was posted: safe to allow another attempt.
    await setDraftStatus(draftId, "pending", e instanceof Error ? e.message : String(e));
    throw e;
  }
  const embedding = await embedText(text);
  const [post] = await db()
    .insert(schema.posts)
    .values({
      draftId,
      provider: result.provider,
      tweetId: result.tweetId,
      replyTweetId: result.replyTweetId,
      externalId: result.externalId,
      text,
      pillar: d.pillar,
      format: d.format,
      hasMedia: !!v?.assetUrl,
      embedding,
    })
    .returning();
  await setDraftStatus(draftId, "posted");
  return post.id;
}

/** Records the link of a post you published yourself (manual mode), so it shows up everywhere. */
export async function attachTweet(postId: number, tweetId: string) {
  await db().update(schema.posts).set({ tweetId, postedAt: new Date() }).where(eq(schema.posts.id, postId));
}

export async function deletePost(postId: number) {
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p) return "Post not found.";
  const how = await unpublish(p);
  await db().update(schema.posts).set({ deleted: true }).where(eq(schema.posts.id, postId));
  if (how === "deleted") return "Deleted from X.";
  const url = postUrl(p.tweetId);
  return url
    ? `Marked as deleted here. Delete it on X yourself: ${url} (⋯ → Delete). Only the paid X API can delete for you.`
    : "Marked as deleted here. If it's already on X, delete it from your profile (⋯ → Delete).";
}

export async function latestPendingDraft() {
  const [d] = await db().select().from(schema.drafts).where(eq(schema.drafts.status, "pending")).orderBy(desc(schema.drafts.id)).limit(1);
  return d ?? null;
}

import { optionalEnv, isDryRun } from "../env";
import { log } from "../log";
import { bufferCreatePost, bufferGetPost, bufferDeletePost, bufferMetrics, tweetIdFromUrl } from "./buffer";
import { publicCounts } from "./syndication";

/**
 * How posts reach X:
 * - "xapi":   official X API with your own keys (pay-per-use, ~$0.015/post). Full automation incl. profile.
 * - "buffer": Buffer's free API posts for you ($0). Metrics refresh daily; profile changes are manual.
 * - "manual": $0, no accounts. Telegram hands you the finished post + image; you tap to post it.
 * Picked automatically from which keys exist; PUBLISHER overrides.
 */
export type PublisherMode = "xapi" | "buffer" | "manual";

export function publisherMode(): PublisherMode {
  const forced = optionalEnv("PUBLISHER");
  if (forced === "xapi" || forced === "buffer" || forced === "manual") return forced;
  if (optionalEnv("X_API_KEY") && optionalEnv("X_API_SECRET") && optionalEnv("X_ACCESS_TOKEN") && optionalEnv("X_ACCESS_SECRET")) return "xapi";
  if (optionalEnv("BUFFER_API_KEY")) return "buffer";
  return "manual";
}

/** Whether the app can change your X profile itself (only the official API allows it). */
export const canEditProfile = () => publisherMode() === "xapi";

export type PublishInput = { text: string; imageUrl?: string | null; selfReply?: string | null };
export type PublishResult = {
  provider: PublisherMode;
  /** Known right away for xapi; for buffer once X confirms; for manual when you send the link. */
  tweetId: string | null;
  replyTweetId: string | null;
  externalId: string | null;
  /** True when you still have to post it yourself (manual mode). */
  handoff: boolean;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function publish(p: PublishInput): Promise<PublishResult> {
  const provider = publisherMode();
  if (isDryRun()) {
    await log("x", `DRY_RUN (${provider}): would post "${p.text.slice(0, 80)}..."`);
    return { provider, tweetId: `dry-${Date.now()}`, replyTweetId: p.selfReply ? `dry-reply-${Date.now()}` : null, externalId: null, handoff: false };
  }
  if (provider === "xapi") {
    const { postTweet } = await import("../x/client");
    const png = p.imageUrl ? new Uint8Array(await (await fetch(p.imageUrl)).arrayBuffer()) : null;
    const r = await postTweet({ text: p.text, png, selfReply: p.selfReply });
    return { provider, ...r, externalId: null, handoff: false };
  }
  if (provider === "buffer") {
    let post = await bufferCreatePost(p);
    await log("x", `buffer post ${post.id} created (${post.status})`);
    // shareNow usually lands within seconds; poll briefly so the announcement can carry the real link.
    for (let i = 0; i < 6 && (post.status === "sending" || post.status === "scheduled"); i++) {
      await wait(5000);
      post = await bufferGetPost(post.id).catch(() => post);
    }
    if (post.status === "error") throw new Error(`Buffer failed to publish: ${post.error?.message ?? "unknown error"}`);
    return { provider, tweetId: tweetIdFromUrl(post.externalLink), replyTweetId: null, externalId: post.id, handoff: false };
  }
  return { provider, tweetId: null, replyTweetId: null, externalId: null, handoff: true };
}

/** Fills in the tweet id for a Buffer post that was still sending when we announced it. */
export async function resolveTweetId(externalId: string): Promise<{ tweetId: string | null; failed?: string }> {
  const post = await bufferGetPost(externalId);
  if (post.status === "error") return { tweetId: null, failed: post.error?.message ?? "Buffer reported an error" };
  return { tweetId: tweetIdFromUrl(post.externalLink) };
}

export type PostMetrics = {
  impressions: number; likes: number; replies: number; reposts: number; quotes: number; bookmarks: number; profileClicks: number;
};

/**
 * Latest numbers for a post, or null when nothing is available yet.
 * - xapi: everything, from the API.
 * - buffer: impressions/reposts from Buffer (refreshed ~daily) + live likes/replies from X's public embed data.
 * - manual: live likes/replies from the embed data, once you've sent the post's link.
 */
export async function fetchMetrics(post: { provider: string; tweetId: string | null; externalId: string | null }): Promise<PostMetrics | null> {
  if (post.tweetId?.startsWith("dry-")) return null;
  if (post.provider === "xapi" && post.tweetId) {
    const { tweetMetrics } = await import("../x/client");
    return tweetMetrics(post.tweetId);
  }
  const live = post.tweetId ? await publicCounts(post.tweetId).catch(() => null) : null;
  const buffered = post.provider === "buffer" && post.externalId ? await bufferGetPost(post.externalId, true).catch(() => null) : null;
  const fromBuffer = buffered?.metrics?.length ? bufferMetrics(buffered.metrics) : null;
  if (!live && !fromBuffer) return null;
  const base = fromBuffer ?? { impressions: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, bookmarks: 0, profileClicks: 0 };
  // Buffer lags by up to a day, the embed data is live: take the fresher (larger) count.
  return { ...base, likes: Math.max(base.likes, live?.likes ?? 0), replies: Math.max(base.replies, live?.replies ?? 0) };
}

/**
 * Removes a post from X when the provider allows it. Buffer can't delete a tweet that's already out,
 * so then you get the link to delete it yourself.
 */
export async function unpublish(post: { provider: string; tweetId: string | null; replyTweetId: string | null; externalId: string | null }): Promise<"deleted" | "manual"> {
  if (post.tweetId?.startsWith("dry-")) return "deleted";
  if (post.provider === "xapi" && post.tweetId) {
    const { deleteTweet } = await import("../x/client");
    if (post.replyTweetId) await deleteTweet(post.replyTweetId).catch(() => {});
    await deleteTweet(post.tweetId);
    return "deleted";
  }
  if (post.provider === "buffer" && post.externalId && !post.tweetId) {
    // Still queued/sending in Buffer: deleting there stops it.
    try {
      await bufferDeletePost(post.externalId);
      return "deleted";
    } catch {
      return "manual";
    }
  }
  return "manual";
}

export function postUrl(tweetId: string | null | undefined) {
  return tweetId && !tweetId.startsWith("dry-") ? `https://x.com/i/status/${tweetId}` : null;
}

/** X's composer with the text pre-filled. Images can't be pre-attached, so you add the saved image. */
export function composeIntentUrl(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

import { TwitterApi, EUploadMimeType } from "twitter-api-v2";
import { env, isDryRun } from "../env";
import { log } from "../log";

let _client: TwitterApi | null = null;

/** OAuth 1.0a user context for your own account: covers v2 posting, media upload and v1.1 profile endpoints. */
export function x() {
  if (!_client) {
    _client = new TwitterApi({
      appKey: env("X_API_KEY"),
      appSecret: env("X_API_SECRET"),
      accessToken: env("X_ACCESS_TOKEN"),
      accessSecret: env("X_ACCESS_SECRET"),
    });
  }
  return _client;
}

let _me: { id: string; username: string } | null = null;
export async function me() {
  if (!_me) {
    const { data } = await x().v2.me();
    _me = { id: data.id, username: data.username };
  }
  return _me;
}

export async function uploadImage(png: Uint8Array): Promise<string> {
  return x().v2.uploadMedia(Buffer.from(png), { media_type: EUploadMimeType.Png, media_category: "tweet_image" });
}

export async function postTweet(input: { text: string; png?: Uint8Array | null; selfReply?: string | null }) {
  if (isDryRun()) {
    await log("x", `DRY_RUN: would post "${input.text.slice(0, 80)}..."`);
    return { tweetId: `dry-${Date.now()}`, replyTweetId: input.selfReply ? `dry-reply-${Date.now()}` : null };
  }
  const mediaId = input.png ? await uploadImage(input.png) : null;
  const { data } = await x().v2.tweet({
    text: input.text,
    ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
  });
  let replyTweetId: string | null = null;
  if (input.selfReply) {
    const r = await x().v2.reply(input.selfReply, data.id);
    replyTweetId = r.data.id;
  }
  await log("x", `posted ${data.id}`, { costUsd: 0.015 * (input.selfReply ? 2 : 1) });
  return { tweetId: data.id, replyTweetId };
}

export async function deleteTweet(id: string) {
  if (id.startsWith("dry-")) return;
  await x().v2.deleteTweet(id);
}

export async function tweetMetrics(id: string) {
  if (id.startsWith("dry-")) return null;
  const { data } = await x().v2.singleTweet(id, {
    "tweet.fields": ["public_metrics", "non_public_metrics", "organic_metrics"],
  });
  await log("x", `metrics read ${id}`, { costUsd: 0.001 });
  const pm = data.public_metrics;
  const npm = data.non_public_metrics as { impression_count?: number; user_profile_clicks?: number } | undefined;
  return {
    impressions: npm?.impression_count ?? (pm as { impression_count?: number } | undefined)?.impression_count ?? 0,
    likes: pm?.like_count ?? 0,
    replies: pm?.reply_count ?? 0,
    reposts: pm?.retweet_count ?? 0,
    quotes: pm?.quote_count ?? 0,
    bookmarks: (pm as { bookmark_count?: number } | undefined)?.bookmark_count ?? 0,
    profileClicks: npm?.user_profile_clicks ?? 0,
  };
}

export async function updateProfile(fields: { name?: string; description?: string; location?: string; url?: string }) {
  if (isDryRun()) return log("x", `DRY_RUN: would update profile ${JSON.stringify(fields)}`);
  await x().v1.updateAccountProfile(fields);
}

export async function updateAvatar(png: Uint8Array) {
  if (isDryRun()) return log("x", "DRY_RUN: would update avatar");
  await x().v1.updateAccountProfileImage(Buffer.from(png));
}

export async function updateBanner(png: Uint8Array) {
  if (isDryRun()) return log("x", "DRY_RUN: would update banner");
  await x().v1.updateAccountProfileBanner(Buffer.from(png));
}

/** Latest original posts from a user (for reply suggestions). Each post read costs ~$0.005. */
export async function recentPostsOf(userId: string, max = 5) {
  const res = await x().v2.userTimeline(userId, {
    max_results: Math.max(5, max),
    exclude: ["replies", "retweets"],
    "tweet.fields": ["created_at", "public_metrics"],
  });
  await log("x", `timeline read ${userId}`, { costUsd: 0.005 * res.tweets.length });
  return res.tweets;
}

export async function userIdFor(handle: string) {
  const { data } = await x().v2.userByUsername(handle.replace(/^@/, ""));
  return data?.id ?? null;
}

import { z } from "zod";
import { desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db";
import { llmObject } from "../llm";
import { voiceContext } from "../content/voice";
import { WRITER_SYSTEM } from "../content/prompts";
import { slopViolations } from "../content/rules";
import { getSettings } from "../settings";
import { tweetIdFromUrl } from "../publisher/buffer";
import { log } from "../log";

/** Starter list of mid-size, active dev accounts. Edit in the dashboard. */
export const DEFAULT_TARGETS = [
  "t3dotgg", "leeerob", "rauchg", "kentcdodds", "wesbos", "addyosmani", "swyx", "simonw",
  "karpathy", "mattpocockuk", "tannerlinsley", "housecor", "cassidoo", "levelsio", "dhh",
];

const REPLY_SYSTEM = `${WRITER_SYSTEM}\n\nNow you're drafting REPLIES. A great reply adds something: a specific experience, a counter-example, a gotcha, a number. Never "Great post!", never flattery, never self-promo, never a question just to farm engagement. Under 200 characters.`;

/**
 * Drafts reply suggestions for YOU to post manually. The app never auto-replies:
 * automated replies are the riskiest thing under X's automation rules.
 */
export async function generateReplySuggestions(): Promise<number> {
  const s = await getSettings();
  const budget = Math.max(0, s.dailyXReadBudget);
  let targets = await db().select().from(schema.replyTargets).where(eq(schema.replyTargets.active, true));
  if (!targets.length) {
    await db().insert(schema.replyTargets).values(DEFAULT_TARGETS.map((handle) => ({ handle }))).onConflictDoNothing();
    targets = await db().select().from(schema.replyTargets).where(eq(schema.replyTargets.active, true));
  }
  const already = new Set(
    (await db().select({ t: schema.replySuggestions.tweetId }).from(schema.replySuggestions).where(gte(schema.replySuggestions.createdAt, new Date(Date.now() - 3 * 864e5)))).map((r) => r.t),
  );
  // Rotate through targets: ~5 reads per account, within the daily read budget.
  const shuffled = targets.sort(() => Math.random() - 0.5).slice(0, Math.max(1, Math.floor(budget / 5)));
  const candidates: { handle: string; id: string; text: string; ageH: number }[] = [];
  for (const t of shuffled) {
    try {
      const { recentPostsOf, userIdFor } = await import("../x/client");
      let uid = t.userId;
      if (!uid) {
        uid = await userIdFor(t.handle);
        if (!uid) continue;
        await db().update(schema.replyTargets).set({ userId: uid }).where(eq(schema.replyTargets.id, t.id));
      }
      for (const tw of await recentPostsOf(uid, 5)) {
        const ageH = tw.created_at ? (Date.now() - new Date(tw.created_at).getTime()) / 36e5 : 99;
        if (ageH < 6 && !already.has(tw.id)) candidates.push({ handle: t.handle, id: tw.id, text: tw.text, ageH });
      }
    } catch (e) {
      await log("replies", `timeline failed for @${t.handle}: ${e instanceof Error ? e.message : e}`, { level: "warn" });
    }
  }
  if (!candidates.length) return 0;
  const picked = candidates.sort((a, b) => a.ageH - b.ageH).slice(0, s.replySuggestionsPerDay * 2);
  const voice = await voiceContext(8);
  const { replies } = await llmObject({
    schema: z.object({
      replies: z.array(z.object({ i: z.number().int(), reply: z.string(), worth: z.number().min(0).max(10) })),
    }),
    system: REPLY_SYSTEM,
    prompt: `${voice}\n\nPosts:\n${picked.map((c, i) => `${i}. @${c.handle}: ${c.text}`).join("\n\n")}\n\nDraft one reply per post where the author can genuinely add value, and rate worth 0-10. Skip posts where they can't.`,
  });
  const rows = replies
    .filter((r) => picked[r.i] && r.worth >= 6 && !slopViolations(r.reply).length)
    .sort((a, b) => b.worth - a.worth)
    .slice(0, s.replySuggestionsPerDay)
    .map((r) => ({ handle: picked[r.i].handle, tweetId: picked[r.i].id, tweetText: picked[r.i].text, suggestion: r.reply }));
  if (rows.length) await db().insert(schema.replySuggestions).values(rows);
  return rows.length;
}

export async function newReplySuggestions() {
  return db().select().from(schema.replySuggestions).where(eq(schema.replySuggestions.status, "new")).orderBy(desc(schema.replySuggestions.id)).limit(10);
}

/** Opens X's composer with the reply pre-filled; you press send. */
export function replyIntentUrl(tweetId: string, text: string) {
  return `https://x.com/intent/post?in_reply_to=${tweetId}&text=${encodeURIComponent(text)}`;
}

const decodeEntities = (t: string) =>
  t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, "—");

/**
 * Reads a public post through X's oEmbed endpoint (free, no key, the same one embeds use).
 * Returns null for protected/deleted posts.
 */
export async function fetchTweet(url: string): Promise<{ id: string; handle: string; text: string } | null> {
  const id = tweetIdFromUrl(url);
  if (!id) return null;
  const res = await fetch(`https://publish.x.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(`https://x.com/i/status/${id}`)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { html?: string; author_url?: string };
  const body = j.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
  if (!body) return null;
  return { id, handle: j.author_url?.split("/").pop() ?? "someone", text: decodeEntities(body).trim() };
}

/** You paste a post link, you get up to 3 reply options in your voice. Free in every mode. */
export async function suggestRepliesFor(url: string) {
  const tw = await fetchTweet(url);
  if (!tw) return { tweet: null, rows: [] as (typeof schema.replySuggestions.$inferSelect)[] };
  const voice = await voiceContext(8);
  const { replies } = await llmObject({
    schema: z.object({ replies: z.array(z.string()).min(1).max(3) }),
    system: REPLY_SYSTEM,
    prompt: `${voice}\n\nPost by @${tw.handle}:\n${tw.text}\n\nDraft 3 different replies (different angles). If there's genuinely nothing to add, return fewer.`,
  });
  const good = replies.filter((r) => r.length <= 280 && !slopViolations(r).length).slice(0, 3);
  if (!good.length) return { tweet: tw, rows: [] };
  const rows = await db()
    .insert(schema.replySuggestions)
    .values(good.map((suggestion) => ({ handle: tw.handle, tweetId: tw.id, tweetText: tw.text, suggestion })))
    .returning();
  return { tweet: tw, rows };
}

/** Free modes can't read timelines, so the daily nudge points you at a few accounts to check. */
export async function replyTargetsToCheck(n = 4) {
  let targets = await db().select().from(schema.replyTargets).where(eq(schema.replyTargets.active, true));
  if (!targets.length) {
    await db().insert(schema.replyTargets).values(DEFAULT_TARGETS.map((handle) => ({ handle }))).onConflictDoNothing();
    targets = await db().select().from(schema.replyTargets).where(eq(schema.replyTargets.active, true));
  }
  return targets.sort(() => Math.random() - 0.5).slice(0, n).map((t) => t.handle);
}

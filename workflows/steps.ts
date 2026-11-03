import { desc, eq, isNotNull } from "drizzle-orm";
import { InlineKeyboard, InputFile } from "grammy";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { RetryableError } from "workflow";
import { planTopic, startDraft, reviewVariant, finishDraft, failDraft, type TopicPlan } from "@/lib/content/pipeline";
import { cooldownFor } from "@/lib/llm";
import { publishDraft, getDraft, setDraftStatus } from "@/lib/actions/drafts";
import { sendDraftCard, notify, tg, ownerChatId } from "@/lib/telegram/send";
import { publisherMode, fetchMetrics, resolveTweetId, composeIntentUrl, postUrl } from "@/lib/publisher";
import { engagementScore, armTrials } from "@/lib/content/bandit";
import { updateBanditFor } from "@/lib/actions/learning";
import { getBotState, setBotState } from "@/lib/actions/onboarding";
import { slotDate } from "@/lib/time";
import { isDryRun, optionalEnv } from "@/lib/env";
import { log } from "@/lib/log";

export async function isPausedStep() {
  "use step";
  return (await getSettings()).paused;
}

export async function timingStep(manual: boolean, offsetMinutes = 0) {
  "use step";
  const s = await getSettings();
  const now = Date.now();
  if (manual) {
    const deadline = new Date(now + s.approvalTimeoutMinutes * 6e4);
    return { slot: new Date(now).toISOString(), deadline: deadline.toISOString(), threshold: s.autoPostThreshold, tz: s.timezone };
  }
  const jitter = Math.round((Math.random() * 2 - 1) * s.jitterMinutes * 6e4);
  let slot = slotDate(s.slotTime, s.timezone, new Date(now)).getTime() + offsetMinutes * 6e4 + jitter;
  // Cron fired late (or slot is too close): give yourself at least 20 min to review.
  if (slot < now + 20 * 6e4) slot = now + 20 * 6e4;
  return { slot: new Date(slot).toISOString(), deadline: new Date(slot).toISOString(), threshold: s.autoPostThreshold, tz: s.timezone };
}

export async function planStep(forceTopic?: string): Promise<TopicPlan> {
  "use step";
  return planTopic({ forceTopic });
}

/** Free-tier limits clear within minutes: wait them out instead of burning retries back to back. */
async function waitOutLimits<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pause = cooldownFor(msg);
    if (pause) throw new RetryableError(msg, { retryAfter: Math.min(pause, 5 * 60_000) });
    throw e;
  }
}

export async function startDraftStep(plan: TopicPlan, kind: "daily" | "manual" | "intro") {
  "use step";
  return waitOutLimits(() => startDraft(plan, kind));
}
startDraftStep.maxRetries = 4;

export async function reviewVariantStep(draftId: number, index: number) {
  "use step";
  return waitOutLimits(() => reviewVariant(draftId, index));
}
reviewVariantStep.maxRetries = 5;

export async function finishDraftStep(draftId: number) {
  "use step";
  return finishDraft(draftId);
}

export async function failDraftStep(draftId: number, message: string) {
  "use step";
  await failDraft(draftId, message);
  await notify(`❌ Draft #${draftId} failed: ${message.slice(0, 300)}\nTry /new again in a few minutes.`);
}

export async function presentStep(draftId: number, runId: string, token: string, slotIso: string | null) {
  "use step";
  await db()
    .update(schema.drafts)
    .set({ runId, hookToken: token, scheduledFor: slotIso ? new Date(slotIso) : null, updatedAt: new Date() })
    .where(eq(schema.drafts.id, draftId));
  const d = (await getDraft(draftId))!;
  const msgId = await sendDraftCard(d);
  if (msgId) await db().update(schema.drafts).set({ telegramMessageId: msgId }).where(eq(schema.drafts.id, draftId));
}

export async function markStep(draftId: number, status: string, message?: string) {
  "use step";
  await setDraftStatus(draftId, status);
  if (message) await notify(message);
}

/** On approval timeout: post only if the chosen variant passed every gate and clears the bar. */
export async function autoPostAllowedStep(draftId: number, threshold: number) {
  "use step";
  const d = await getDraft(draftId);
  if (!d || d.status !== "pending") return false;
  if (d.editedText) return true; // you already touched it
  const v = d.variants[d.chosen];
  return !!v && !v.problems?.length && (v.scores?.human ?? 0) >= threshold && (v.scores?.reportRisk ?? 10) <= 3;
}

export async function publishStep(draftId: number) {
  "use step";
  if ((await getSettings()).paused) {
    await setDraftStatus(draftId, "skipped");
    await notify(`⏸ Paused, so draft #${draftId} was not posted.`);
    return null;
  }
  return publishDraft(draftId);
}

export async function publisherModeStep() {
  "use step";
  return publisherMode();
}

async function postLink(tweetId: string | null) {
  const url = postUrl(tweetId);
  if (!url || publisherMode() !== "xapi") return url;
  try {
    const { me } = await import("@/lib/x/client");
    return `https://x.com/${(await me()).username}/status/${tweetId}`;
  } catch {
    return url;
  }
}

export async function announcePostedStep(postId: number) {
  "use step";
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (p.provider === "manual" && !isDryRun()) return handoffPost(p);
  const link = await postLink(p.tweetId);
  const via = p.provider === "buffer" ? " via Buffer" : "";
  await notify(
    `🟢 Posted${via}${isDryRun() ? " (dry run)" : ""}.\n${link ?? (p.provider === "buffer" ? "Buffer is still sending it; I'll grab the link." : "")}\n\nThe first hour matters most: reply to anyone who comments (mutual replies are weighted ×15 in the ranker).`,
    new InlineKeyboard().text("🗑 Delete", `del:${postId}`),
  );
}

/**
 * Manual mode: you're the one who presses Post. Sends the exact text (tap to copy), the image to save,
 * and a button that opens X's composer pre-filled. Reply with the post's link so I can track it.
 */
async function handoffPost(p: typeof schema.posts.$inferSelect) {
  const d = p.draftId ? await getDraft(p.draftId) : null;
  const v = d?.variants[d.chosen];
  const html = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const kb = new InlineKeyboard().url("✍️ Open X with this text", composeIntentUrl(p.text)).row().text("✅ Posted it", `mp:${p.id}`).text("⏭ Not posting", `np:${p.id}`);
  if (v?.assetUrl && optionalEnv("TELEGRAM_BOT_TOKEN")) {
    // Sent as a file so Telegram doesn't recompress it: long-press → save, then attach in X.
    await tg().sendDocument(ownerChatId(), new InputFile(new URL(v.assetUrl), "post.png"), { caption: "🖼 Image for the post: save it and attach it in X." }).catch(() => {});
  }
  await notify(
    [
      `📤 <b>Time to post #${p.id}</b> (tap the text to copy)`,
      "",
      `<code>${html(p.text)}</code>`,
      v?.selfReply ? `\n↳ Then reply to your own post with:\n<code>${html(v.selfReply)}</code>` : "",
      "",
      "After posting, send me the link to the post so I can track it.",
    ].filter((l) => l !== undefined).join("\n"),
    kb,
  );
  const chat = optionalEnv("TELEGRAM_CHAT_ID");
  if (chat && (await getBotState(chat)).mode === "idle") await setBotState(chat, "awaitlink", { postId: p.id });
}

/** Buffer: if the post was still sending when announced, fetch the real link once it's out. */
export async function resolveTweetStep(postId: number) {
  "use step";
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p || p.provider !== "buffer" || p.tweetId || !p.externalId) return;
  const r = await resolveTweetId(p.externalId);
  if (r.tweetId) {
    await db().update(schema.posts).set({ tweetId: r.tweetId }).where(eq(schema.posts.id, postId));
    await notify(`🔗 Post #${postId} is live: ${postUrl(r.tweetId)}`);
  } else if (r.failed) {
    await notify(`⚠️ Buffer couldn't publish post #${postId}: ${r.failed}`);
  }
}

export async function metricsStep(postId: number, checkpoint: "1h" | "6h" | "24h" | "72h") {
  "use step";
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p || p.deleted) return null;
  const m = await fetchMetrics(p);
  if (!m) {
    if (p.provider === "manual" && !p.tweetId && checkpoint === "1h" && !isDryRun()) {
      await notify(`🔗 Paste the link to post #${postId} here so I can track its likes and replies.`);
    } else if (!isDryRun()) {
      await log("metrics", `no metrics yet for post ${postId} at ${checkpoint}`, { level: "warn" });
    }
    return null;
  }
  const score = engagementScore(m);
  await db().insert(schema.metrics).values({ postId, checkpoint, ...m, score });
  const full = p.provider === "xapi";
  const parts = [
    m.impressions || full ? `👁 ${m.impressions}` : "",
    `❤️ ${m.likes}`,
    `💬 ${m.replies}`,
    m.reposts || full ? `🔁 ${m.reposts}` : "",
    full ? `🗨 ${m.quotes} · 🔖 ${m.bookmarks} · 👤 ${m.profileClicks}` : "",
  ].filter(Boolean);
  await notify(
    `📊 <b>${checkpoint}</b> · post #${postId}\n${parts.join(" · ")}\nscore ${score.toFixed(4)}${m.replies ? "\n→ go reply to the comments" : ""}`,
    checkpoint === "1h" ? new InlineKeyboard().text("🗑 Delete", `del:${postId}`) : undefined,
  );
  return score;
}

/** Manual mode has no metrics feed, so you rate the post in one tap; that trains the bandit. */
export async function askRatingStep(postId: number) {
  "use step";
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p || p.deleted || isDryRun()) return;
  const kb = new InlineKeyboard().text("💀", `rt:${postId}:1`).text("😐", `rt:${postId}:2`).text("👍", `rt:${postId}:3`).text("🔥", `rt:${postId}:4`);
  await notify(`📊 How did post #${postId} do after a day?${p.tweetId ? `\n${postUrl(p.tweetId)}` : ""}\n💀 flopped · 😐 meh · 👍 decent · 🔥 popped off`, kb);
}

export async function banditStep(postId: number) {
  "use step";
  await updateBanditFor(postId);
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export async function weeklyDigestStep() {
  "use step";
  const since = new Date(Date.now() - 7 * 864e5);
  const posts = await db().select().from(schema.posts).where(isNotNull(schema.posts.id)).orderBy(desc(schema.posts.id)).limit(20);
  const recent = posts.filter((p) => p.postedAt >= since && !p.deleted);
  const ms = await db().select().from(schema.metrics).where(eq(schema.metrics.checkpoint, "24h"));
  const rows = recent.map((p) => ({ p, m: ms.find((x) => x.postId === p.id) })).sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));
  const s = await getSettings();
  const arms = Object.entries(s.bandit)
    .map(([k, v]) => ({ k, mean: v.a / (v.a + v.b), n: armTrials(v) }))
    .filter((a) => a.n > 0)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 3);
  const totalImpr = rows.reduce((t, r) => t + (r.m?.impressions ?? 0), 0);
  await notify(
    [
      `🗓 <b>Weekly digest</b>: ${recent.length} posts, ${totalImpr} impressions`,
      rows[0] ? `🏆 Best: "${esc(rows[0].p.text.slice(0, 120))}" (${rows[0].m?.impressions ?? 0} impr)` : "",
      rows.length > 1 ? `📉 Weakest: "${esc(rows.at(-1)!.p.text.slice(0, 80))}"` : "",
      arms.length ? `What's working: ${esc(arms.map((a) => `${a.k} (${Math.round(a.mean * 100)}%)`).join(", "))}` : "Not enough data yet; still exploring formats.",
    ].filter(Boolean).join("\n"),
  );
}

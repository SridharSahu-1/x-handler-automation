import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { experimental_transcribe as transcribe } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { desc, eq, gte } from "drizzle-orm";
import { start } from "workflow/api";
import { env, optionalEnv, isDryRun } from "../env";
import { db, schema } from "../db";
import { getSettings, setSetting } from "../settings";
import { decide, editDraft, getDraft, deletePost, latestPendingDraft, attachTweet } from "../actions/drafts";
import { suggestRepliesFor, replyIntentUrl } from "../actions/replies";
import { recordRating } from "../actions/learning";
import { publisherMode, canEditProfile } from "../publisher";
import { tweetIdFromUrl } from "../publisher/buffer";
import { getBotState, setBotState, saveInterviewAnswer, draftStyleCard, finishOnboarding, resetInterview } from "../actions/onboarding";
import { proposeProfile, applyProfileChange, proposeAvatar, proposeBanner, PROFILE_EDIT_URL } from "../actions/profile";
import { INTERVIEW_QUESTIONS } from "../content/voice";
import { sendDraftCard, draftCaption, draftKeyboard } from "./send";
import { storeFile } from "../assets/store";
import { recentUnusedTrends, collectTrends } from "../trends";
import { slotDate, fmtLocal } from "../time";
import { dailyPost } from "@/workflows/daily-post";
import { replySuggestions } from "@/workflows/replies";

const REGEN_REASONS: Record<string, string> = {
  formal: "Too formal / stiff. Write more casually, like texting a dev friend.",
  boring: "Boring / obvious. Needs a sharper, less obvious angle or a concrete surprising detail.",
  topic: "Wrong topic for this account.",
  ai: "Sounds AI-written. More specific, less polished, fewer tidy parallel structures.",
};

const HELP = `<b>Commands</b>
/new [topic] - draft a post now (optionally about a topic)
/status - what's happening today
/pause · /resume - kill switch for all posting
/stats - last 7 days
/trends - today's top trends
/replies - reply ideas for you to post
(paste any X post link and I'll draft replies to it)
/profile - propose name/bio/location
/banner - propose a banner
/dp - send 1-5 photos of you, I'll make a profile pic
/intro - draft your pinned intro post
/interview - redo the voice interview
/voice &lt;text&gt; - add something you wrote as a voice sample
/topics a; b; c; d - set content pillars
/slot HH:mm - set daily posting time
/delete &lt;postId&gt; - delete a post
/cancel - leave edit/interview mode`;

function isOwner(ctx: Context) {
  return String(ctx.chat?.id ?? "") === env("TELEGRAM_CHAT_ID");
}

async function transcribeVoice(ctx: Context): Promise<string | null> {
  const key = optionalEnv("GROQ_API_KEY");
  const fileId = ctx.message?.voice?.file_id ?? ctx.message?.audio?.file_id;
  if (!key || !fileId) return null;
  const file = await ctx.api.getFile(fileId);
  const audio = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env("TELEGRAM_BOT_TOKEN")}/${file.file_path}`)).arrayBuffer());
  const { text } = await transcribe({ model: createGroq({ apiKey: key }).transcription("whisper-large-v3-turbo"), audio });
  return text.trim();
}

async function askQuestion(ctx: Context, i: number) {
  await ctx.reply(`<b>${i + 1}/${INTERVIEW_QUESTIONS.length}</b> ${INTERVIEW_QUESTIONS[i]}\n\n<i>Answer by text or voice note, however you'd naturally say it. /skip to skip.</i>`, { parse_mode: "HTML" });
}

async function handleUserText(ctx: Context, text: string) {
  const chatId = String(ctx.chat!.id);
  const st = await getBotState(chatId);
  if (st.mode === "interview") {
    const i = Number(st.data.i ?? 0);
    if (text !== "/skip") await saveInterviewAnswer(i, text);
    if (i + 1 < INTERVIEW_QUESTIONS.length) {
      await setBotState(chatId, "interview", { i: i + 1 });
      return askQuestion(ctx, i + 1);
    }
    await setBotState(chatId, "idle");
    await ctx.reply("Thanks. Writing your style card…");
    const card = await draftStyleCard();
    await setBotState(chatId, "stylecard", { card });
    return ctx.reply(`<b>Your style card</b>\n\n${escapeHtml(card)}\n\nLooks right? Reply with an edited version, or tap OK.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("👍 OK", "sc:ok"),
    });
  }
  if (st.mode === "stylecard") {
    await finishOnboarding(text);
    await setBotState(chatId, "idle");
    return afterOnboarding(ctx);
  }
  const link = text.match(/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S+\/status(?:es)?\/\d+\S*/)?.[0];
  if (link && (st.mode === "idle" || st.mode === "awaitlink")) return handleLink(ctx, link, st);
  if (st.mode === "edit") {
    const draftId = Number(st.data.draftId);
    const msg = await editDraft(draftId, text);
    if (msg.startsWith("Saved")) {
      await setBotState(chatId, "idle");
      const d = await getDraft(draftId);
      if (d) await sendDraftCard(d, "✏️ Your edit is in. Approve when ready.");
      return;
    }
    return ctx.reply(msg);
  }
  return ctx.reply("I only take commands here. /help");
}

/** A pasted post link: either the post you just published by hand, or something to reply to. */
async function handleLink(ctx: Context, link: string, st: { mode: string; data: Record<string, unknown> }) {
  const tweetId = tweetIdFromUrl(link)!;
  if (st.mode === "awaitlink") {
    const postId = Number(st.data.postId);
    return ctx.reply(`Is this post #${postId} that you just published, or one you want to reply to?`, {
      reply_markup: new InlineKeyboard().text(`📌 My post #${postId}`, `ml:${postId}:${tweetId}`).text("💬 Reply ideas", `rl:${tweetId}`),
    });
  }
  return sendReplyIdeas(ctx, tweetId);
}

async function sendReplyIdeas(ctx: Context, tweetId: string) {
  await ctx.reply("Reading the post and drafting replies…");
  const { tweet, rows } = await suggestRepliesFor(`https://x.com/i/status/${tweetId}`);
  if (!tweet) return ctx.reply("Couldn't read that post (deleted, protected, or not a post link).");
  if (!rows.length) return ctx.reply("Nothing worth adding to that one, honestly. Skip it and find a post where you've got a real take.");
  for (const r of rows) {
    await ctx.reply(`→ <code>${escapeHtml(r.suggestion)}</code>`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().url("✍️ Reply on X", replyIntentUrl(r.tweetId, r.suggestion)).text("✅ Done", `rs:${r.id}:used`),
    });
  }
}

async function afterOnboarding(ctx: Context) {
  await ctx.reply(
    "You're set up. Next steps:\n1. /profile to get your name and bio\n2. /dp then send photos for a profile pic\n3. /banner\n4. /intro for your pinned intro post\n5. Follow 50-100 devs in your niche manually.\n\nDaily drafts start automatically at your slot. /new makes one right now.",
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

let _bot: Bot | null = null;

export function getBot() {
  if (_bot) return _bot;
  const bot = new Bot(env("TELEGRAM_BOT_TOKEN"));

  // Only you. Everyone else gets silence.
  bot.use(async (ctx, next) => {
    if (!isOwner(ctx)) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    const s = await getSettings();
    if (s.onboarded) return ctx.reply(HELP, { parse_mode: "HTML" });
    await ctx.reply(
      `Hey 👋 Let's set up your account from scratch. I'll ask ${INTERVIEW_QUESTIONS.length} quick questions so posts sound like you, not like AI. Voice notes are great.${isDryRun() ? "\n\n(DRY_RUN is on, so nothing will actually be posted to X.)" : ""}`,
    );
    await setBotState(String(ctx.chat.id), "interview", { i: 0 });
    return askQuestion(ctx, 0);
  });
  bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
  bot.command("cancel", async (ctx) => {
    await setBotState(String(ctx.chat.id), "idle");
    return ctx.reply("OK, back to normal.");
  });
  bot.command("skip", (ctx) => handleUserText(ctx, "/skip"));
  bot.command("interview", async (ctx) => {
    await resetInterview();
    await setBotState(String(ctx.chat.id), "interview", { i: 0 });
    return askQuestion(ctx, 0);
  });

  bot.command("new", async (ctx) => {
    const topic = ctx.match?.trim() || undefined;
    const run = await start(dailyPost, [{ manual: true, forceTopic: topic }]);
    return ctx.reply(`On it${topic ? ` (topic: ${topic})` : ""}. Researching and drafting takes 1-3 min. Run ${run.runId.slice(-8)}`);
  });
  bot.command("intro", async (ctx) => {
    const s = await getSettings();
    await start(dailyPost, [
      {
        manual: true,
        kind: "intro",
        forceTopic: `Pinned intro post: who the author is (from their notes) and what they'll post about (${s.pillars.join(", ")}). Human, specific, not a résumé, no "Hi everyone!" opener.`,
      },
    ]);
    return ctx.reply("Drafting your intro post…");
  });

  bot.command("pause", async (ctx) => {
    await setSetting("paused", true);
    return ctx.reply("⏸ Paused. Nothing will be posted until /resume.");
  });
  bot.command("resume", async (ctx) => {
    await setSetting("paused", false);
    return ctx.reply("▶️ Resumed.");
  });

  bot.command("status", async (ctx) => {
    const s = await getSettings();
    const pending = await latestPendingDraft();
    const [lastPost] = await db().select().from(schema.posts).orderBy(desc(schema.posts.id)).limit(1);
    const next = slotDate(s.slotTime, s.timezone, new Date(), true);
    return ctx.reply(
      [
        s.paused ? "⏸ PAUSED" : "▶️ Running",
        isDryRun() ? "🧪 DRY_RUN on (not posting to X)" : "",
        `Posting via: ${{ xapi: "X API", buffer: "Buffer (free)", manual: "you (I prepare it, you tap post)" }[publisherMode()]}`,
        `Next slot: ${fmtLocal(next, s.timezone)}`,
        pending ? `Pending draft: #${pending.id}` : "No pending draft",
        lastPost ? `Last post: #${lastPost.id} at ${fmtLocal(lastPost.postedAt, s.timezone)}` : "No posts yet",
        `Pillars: ${s.pillars.join(" · ")}`,
      ].filter(Boolean).join("\n"),
    );
  });

  bot.command("stats", async (ctx) => {
    const since = new Date(Date.now() - 7 * 864e5);
    const posts = await db().select().from(schema.posts).where(gte(schema.posts.postedAt, since));
    const ms = await db().select().from(schema.metrics).where(gte(schema.metrics.fetchedAt, since));
    const latest = new Map<number, (typeof ms)[number]>();
    for (const m of ms) if (!latest.has(m.postId) || latest.get(m.postId)!.fetchedAt < m.fetchedAt) latest.set(m.postId, m);
    const sum = (k: "impressions" | "likes" | "replies" | "bookmarks") => [...latest.values()].reduce((t, m) => t + m[k], 0);
    return ctx.reply(`Last 7 days: ${posts.length} posts · ${sum("impressions")} impressions · ${sum("likes")} likes · ${sum("replies")} replies · ${sum("bookmarks")} bookmarks`);
  });

  bot.command("trends", async (ctx) => {
    let t = await recentUnusedTrends(24);
    if (!t.length) {
      await ctx.reply("Collecting trends…");
      await collectTrends((await getSettings()).pillars);
      t = await recentUnusedTrends(24);
    }
    const kb = new InlineKeyboard();
    t.slice(0, 6).forEach((x, i) => kb.text(`Write #${i + 1}`, `tw:${x.id}`).row());
    return ctx.reply(t.slice(0, 6).map((x, i) => `${i + 1}. ${escapeHtml(x.title)} <i>(${x.source}, ${x.score})</i>`).join("\n") || "No trends found.", {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.command("replies", async (ctx) => {
    await start(replySuggestions, []);
    return ctx.reply(publisherMode() === "xapi" ? "Looking for good posts to reply to…" : "Paste any X post link here and I'll draft replies in your voice. Sending a few accounts to check…");
  });

  bot.command("profile", async (ctx) => {
    await ctx.reply("Drafting profile options…");
    const rows = await proposeProfile();
    for (const r of rows) {
      await ctx.reply(`<b>${r.field}</b>: <code>${escapeHtml(r.value)}</code>`, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("Use this", `pa:${r.id}`),
      });
    }
  });
  bot.command("banner", async (ctx) => {
    const r = await proposeBanner();
    return ctx.replyWithPhoto(r.value, { caption: "Banner proposal", reply_markup: new InlineKeyboard().text("Use this", `pa:${r.id}`) });
  });
  bot.command("dp", async (ctx) => {
    await setBotState(String(ctx.chat.id), "dp");
    return ctx.reply("Send 1-5 clear photos of yourself (face visible, good light). I'll crop each into a profile pic. Real photos only, AI faces read as fake.");
  });

  bot.command("voice", async (ctx) => {
    const text = ctx.match?.trim();
    if (!text) return ctx.reply("Usage: /voice something you wrote");
    await db().insert(schema.voiceSamples).values({ kind: "sample", text });
    return ctx.reply("Added to your voice samples.");
  });
  bot.command("topics", async (ctx) => {
    const pillars = (ctx.match ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    if (pillars.length < 2) return ctx.reply("Usage: /topics AI tooling; TypeScript; career lessons; dev news");
    await setSetting("pillars", pillars);
    return ctx.reply(`Pillars set: ${pillars.join(" · ")}`);
  });
  bot.command("slot", async (ctx) => {
    const v = (ctx.match ?? "").trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return ctx.reply("Usage: /slot 19:30");
    await setSetting("slotTime", v);
    return ctx.reply(`Daily slot set to ${v}. Note the daily cron fires at 16:30 IST; slots before that post on the next run's day.`);
  });
  bot.command("delete", async (ctx) => {
    const id = Number(ctx.match);
    if (!id) return ctx.reply("Usage: /delete <postId>");
    return ctx.reply(await deletePost(id));
  });

  bot.on("callback_query:data", async (ctx) => {
    const [kind, a, b] = ctx.callbackQuery.data.split(":");
    const id = Number(a);
    let answer = "";
    try {
      switch (kind) {
        case "pk": {
          await db().update(schema.drafts).set({ chosen: Number(b), editedText: null }).where(eq(schema.drafts.id, id));
          const d = await getDraft(id);
          if (d) {
            const caption = draftCaption(d);
            const opts = { parse_mode: "HTML" as const, reply_markup: draftKeyboard(d) };
            if (ctx.callbackQuery.message?.photo) await ctx.editMessageCaption({ caption, ...opts }).catch(() => sendDraftCard(d));
            else await ctx.editMessageText(caption, { ...opts, link_preview_options: { is_disabled: true } }).catch(() => sendDraftCard(d));
            // Different variant may carry a different image: resend if so.
            if (d.variants[d.chosen]?.assetUrl && !ctx.callbackQuery.message?.photo) await sendDraftCard(d);
          }
          answer = `Variant ${Number(b) + 1}`;
          break;
        }
        case "ap":
          answer = await decide(id, { action: "approve" });
          break;
        case "pn":
          answer = await decide(id, { action: "approve", now: true });
          break;
        case "sk":
          answer = await decide(id, { action: "skip" });
          break;
        case "rg":
          answer = await decide(id, { action: "regen", reason: b, note: REGEN_REASONS[b] });
          break;
        case "ed":
          await setBotState(String(ctx.chat!.id), "edit", { draftId: id });
          await ctx.reply("Send me your version of the post (just the text). /cancel to stop.");
          answer = "Edit mode";
          break;
        case "del":
          answer = await deletePost(id);
          break;
        case "pa": {
          answer = await applyProfileChange(id);
          const [c] = await db().select().from(schema.profileChanges).where(eq(schema.profileChanges.id, id));
          if (!canEditProfile() && c?.status === "applied" && (c.field === "avatar" || c.field === "banner")) {
            // Full-quality file to upload yourself (photos get recompressed).
            await ctx.replyWithDocument(new InputFile(new URL(c.value), `${c.field}.png`), {
              caption: `Upload this as your ${c.field === "avatar" ? "profile photo" : "header"}: ${PROFILE_EDIT_URL}`,
            });
          }
          break;
        }
        case "mp":
          answer = "Nice. Paste the post's link here so I can track it.";
          break;
        case "np":
          await db().update(schema.posts).set({ deleted: true }).where(eq(schema.posts.id, id));
          await setBotState(String(ctx.chat!.id), "idle");
          answer = "OK, not posting that one.";
          break;
        case "rt":
          answer = await recordRating(id, Number(b));
          break;
        case "ml":
          await attachTweet(id, b);
          await setBotState(String(ctx.chat!.id), "idle");
          answer = `🔗 Tracking post #${id}. Stick around for the first hour and reply to anyone who comments.`;
          break;
        case "rl":
          await sendReplyIdeas(ctx, a);
          answer = "";
          break;
        case "sc": {
          const st = await getBotState(String(ctx.chat!.id));
          await finishOnboarding(String(st.data.card ?? ""));
          await setBotState(String(ctx.chat!.id), "idle");
          await afterOnboarding(ctx);
          answer = "Saved";
          break;
        }
        case "rs":
          await db().update(schema.replySuggestions).set({ status: b }).where(eq(schema.replySuggestions.id, id));
          answer = b === "used" ? "Nice" : "Dismissed";
          break;
        case "tw": {
          const [t] = await db().select().from(schema.trends).where(eq(schema.trends.id, id));
          if (t) await start(dailyPost, [{ manual: true, forceTopic: `${t.title} (${t.url})` }]);
          answer = "Drafting…";
          break;
        }
      }
    } catch (e) {
      answer = `Error: ${e instanceof Error ? e.message.slice(0, 150) : e}`;
    }
    await ctx.answerCallbackQuery({ text: answer.slice(0, 190) }).catch(() => {});
    if (answer && !["pk", "ed"].includes(kind) && answer.length > 30) await ctx.reply(answer);
  });

  bot.on("message:photo", async (ctx) => {
    const st = await getBotState(String(ctx.chat.id));
    if (st.mode !== "dp" && !/dp|avatar|profile/i.test(ctx.message.caption ?? "")) return ctx.reply("To make a profile pic, send /dp first.");
    const photo = ctx.message.photo.at(-1)!;
    const file = await ctx.api.getFile(photo.file_id);
    const bytes = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env("TELEGRAM_BOT_TOKEN")}/${file.file_path}`)).arrayBuffer());
    const sourceUrl = await storeFile(bytes, "photo-src.jpg", "image/jpeg");
    const r = await proposeAvatar(sourceUrl);
    return ctx.replyWithPhoto(r.value, { caption: "Profile pic option", reply_markup: new InlineKeyboard().text("Use this", `pa:${r.id}`) });
  });

  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const text = await transcribeVoice(ctx).catch(() => null);
    if (!text) return ctx.reply("Couldn't transcribe that (needs GROQ_API_KEY). Send text instead?");
    await ctx.reply(`🎙 "${text.slice(0, 500)}"`);
    return handleUserText(ctx, text);
  });

  bot.on("message:text", (ctx) => handleUserText(ctx, ctx.message.text));

  bot.catch((err) => console.error("bot error", err));
  _bot = bot;
  return bot;
}

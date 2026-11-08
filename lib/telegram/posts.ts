import { InlineKeyboard, InputFile } from "grammy";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getDraft } from "../actions/drafts";
import { getBotState, setBotState } from "../actions/onboarding";
import { publisherMode, composeIntentUrl, postUrl } from "../publisher";
import { isDryRun, optionalEnv } from "../env";
import { notify, tg, ownerChatId } from "./send";

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

export async function announcePosted(postId: number) {
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p) return;
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
    await tg().sendDocument(ownerChatId(), new InputFile(new URL(v.assetUrl), "post.png"), { caption: "🖼 Image for the post: save it and attach it in X." }).catch(async (error) => {
      console.error("telegram post image failed", error);
      await notify(`⚠️ Image delivery for post #${p.id} failed. Download it from the dashboard before posting.`);
    });
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


import { Api, InlineKeyboard, InputFile } from "grammy";
import { env, optionalEnv, isDryRun } from "../env";
import { tweetLength } from "../content/length";
import type { drafts } from "../db/schema";

let _api: Api | null = null;
export function tg() {
  if (!_api) _api = new Api(env("TELEGRAM_BOT_TOKEN"));
  return _api;
}
export const ownerChatId = () => env("TELEGRAM_CHAT_ID");

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Fire-and-forget notification to you. Never throws (Telegram must not break the pipeline). */
export async function notify(html: string, keyboard?: InlineKeyboard) {
  if (!optionalEnv("TELEGRAM_BOT_TOKEN") || !optionalEnv("TELEGRAM_CHAT_ID")) return null;
  try {
    const m = await tg().sendMessage(ownerChatId(), html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
    return m.message_id;
  } catch (e) {
    console.error("telegram notify failed", e);
    return null;
  }
}

export function draftKeyboard(d: typeof drafts.$inferSelect) {
  const kb = new InlineKeyboard();
  d.variants.forEach((_, i) => kb.text(i === d.chosen && !d.editedText ? `• ${i + 1} •` : `${i + 1}`, `pk:${d.id}:${i}`));
  kb.row()
    .text("✅ Approve", `ap:${d.id}`)
    .text("⚡ Post now", `pn:${d.id}`)
    .row()
    .text("✏️ Edit", `ed:${d.id}`)
    .text("⏭ Skip", `sk:${d.id}`)
    .row()
    .text("🔁 Too formal", `rg:${d.id}:formal`)
    .text("🔁 Boring", `rg:${d.id}:boring`)
    .row()
    .text("🔁 Wrong topic", `rg:${d.id}:topic`)
    .text("🔁 Sounds AI", `rg:${d.id}:ai`);
  return kb;
}

export function draftCaption(d: typeof drafts.$inferSelect, extra?: string) {
  const v = d.variants[d.chosen];
  const text = d.editedText ?? v?.text ?? "";
  const s = v?.scores;
  const lines = [
    `<b>Draft #${d.id}</b> · ${esc(d.pillar ?? "")} · <i>${esc(d.format ?? "")}</i>${isDryRun() ? " · DRY RUN" : ""}`,
    "",
    esc(text),
    "",
    v?.selfReply ? `↳ <i>self-reply:</i> ${esc(v.selfReply)}\n` : "",
    `<code>${tweetLength(text)}/280</code>${s ? ` · human ${s.human}${s.originality != null ? ` · original ${s.originality}` : ""} · value ${s.value} · specific ${s.specificity} · risk ${s.reportRisk}` : ""}${d.editedText ? " · ✏️ edited" : ""}`,
    v?.problems?.length ? `⚠️ ${esc(v.problems.join("; "))}` : "",
    d.sources.length ? `\nSources: ${d.sources.slice(0, 3).map((x, i) => `<a href="${esc(x.url)}">[${i + 1}]</a>`).join(" ")}` : "",
    d.scheduledFor ? `🕒 Slot: ${d.scheduledFor.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} IST` : "",
    extra ?? "",
  ];
  return lines.filter((l) => l !== "").join("\n").slice(0, 1020);
}

/** Sends (or refreshes) the approval card for a draft, with its image when it has one. */
export async function sendDraftCard(d: typeof drafts.$inferSelect, extra?: string): Promise<number | null> {
  if (!optionalEnv("TELEGRAM_BOT_TOKEN") || !optionalEnv("TELEGRAM_CHAT_ID")) return null;
  const v = d.variants[d.chosen];
  const caption = draftCaption(d, extra);
  const reply_markup = draftKeyboard(d);
  try {
    if (v?.assetUrl) {
      const m = await tg().sendPhoto(ownerChatId(), new InputFile(new URL(v.assetUrl)), { caption, parse_mode: "HTML", reply_markup });
      return m.message_id;
    }
    const m = await tg().sendMessage(ownerChatId(), caption, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });
    return m.message_id;
  } catch (e) {
    console.error("telegram draft card failed", e);
    return notify(`Draft #${d.id} is ready but the card failed to send. Open the dashboard.`);
  }
}

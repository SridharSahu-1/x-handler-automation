import { InlineKeyboard } from "grammy";
import { generateReplySuggestions, newReplySuggestions, replyIntentUrl, replyTargetsToCheck } from "@/lib/actions/replies";
import { notify } from "@/lib/telegram/send";
import { getSettings } from "@/lib/settings";
import { publisherMode } from "@/lib/publisher";

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

async function suggestStep() {
  "use step";
  const s = await getSettings();
  if (s.paused || s.replySuggestionsPerDay <= 0) return -1;
  // Reading other people's timelines needs the paid X API. Free modes nudge you instead.
  if (publisherMode() !== "xapi") return 0;
  return generateReplySuggestions();
}

async function sendSuggestionsStep() {
  "use step";
  const items = await newReplySuggestions();
  for (const r of items.slice(0, 5)) {
    const kb = new InlineKeyboard()
      .url("✍️ Reply on X", replyIntentUrl(r.tweetId, r.suggestion))
      .row()
      .text("✅ Done", `rs:${r.id}:used`)
      .text("✖ Dismiss", `rs:${r.id}:dismissed`);
    await notify(`💬 <b>Reply idea</b> for @${esc(r.handle)}\n<i>${esc(r.tweetText.slice(0, 300))}</i>\n\n→ ${esc(r.suggestion)}`, kb);
  }
}

async function nudgeStep() {
  "use step";
  const handles = await replyTargetsToCheck(4);
  const kb = new InlineKeyboard();
  handles.forEach((h, i) => {
    kb.url(`@${h}`, `https://x.com/${h}`);
    if (i % 2) kb.row();
  });
  await notify(
    "💬 <b>Reply time</b> (the fastest way to grow from zero)\nOpen a couple of these, find a post from the last few hours where you have something real to add, and paste its link here. I'll draft replies in your voice.",
    kb,
  );
}

export async function replySuggestions() {
  "use workflow";
  const n = await suggestStep();
  if (n > 0) await sendSuggestionsStep();
  if (n === 0) await nudgeStep();
  return { suggestions: Math.max(0, n) };
}

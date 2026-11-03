import { start } from "workflow/api";
import { dailyPost } from "@/workflows/daily-post";
import { replySuggestions } from "@/workflows/replies";
import { isCronAuthorized } from "@/lib/cron";
import { getSettings } from "@/lib/settings";
import { notify } from "@/lib/telegram/send";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const s = await getSettings();
  if (s.paused) return Response.json({ skipped: "paused" });
  if (!s.onboarded) {
    await notify("👋 Daily post skipped: finish setup first. Send /start.");
    return Response.json({ skipped: "not onboarded" });
  }
  const runs = [];
  // Extra posts are spaced 3h apart so the ranker's same-author decay doesn't eat them.
  for (let i = 0; i < Math.max(1, Math.min(3, s.postsPerDay)); i++) {
    runs.push((await start(dailyPost, [{ offsetMinutes: i * 180 }])).runId);
  }
  const replies = await start(replySuggestions, []);
  return Response.json({ runs, replies: replies.runId });
}

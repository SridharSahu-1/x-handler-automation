import { Api } from "grammy";
import { isCronAuthorized } from "@/lib/cron";

/**
 * One-time: registers the Telegram webhook + command menu.
 * curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/setup
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const api = new Api(process.env.TELEGRAM_BOT_TOKEN!);
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  await api.setWebhook(`${base}/api/telegram`, {
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await api.setMyCommands([
    { command: "new", description: "Draft a post now" },
    { command: "status", description: "Today's status" },
    { command: "trends", description: "Top trends" },
    { command: "replies", description: "Reply ideas" },
    { command: "stats", description: "Last 7 days" },
    { command: "pause", description: "Stop all posting" },
    { command: "resume", description: "Resume posting" },
    { command: "profile", description: "Name/bio proposals" },
    { command: "dp", description: "Make a profile pic" },
    { command: "banner", description: "Banner proposal" },
    { command: "intro", description: "Pinned intro post" },
    { command: "help", description: "All commands" },
  ]);
  return Response.json({ ok: true, webhook: `${base}/api/telegram`, info: await api.getWebhookInfo() });
}

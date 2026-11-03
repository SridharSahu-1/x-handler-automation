import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";
import { safeEqual } from "@/lib/auth";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID || !secret) {
    return new Response("telegram not configured", { status: 503 });
  }
  // Reject anything that isn't Telegram before touching the bot.
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) {
    return new Response("unauthorized", { status: 401 });
  }
  const handler = webhookCallback(getBot(), "std/http", {
    secretToken: secret,
    onTimeout: "return",
    timeoutMilliseconds: 55_000,
  });
  return handler(req);
}

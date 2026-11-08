import { SignJWT, jwtVerify } from "jose";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "xh_session";
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

export async function createSession(sub: string) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  return new SignJWT({ sub }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(key());
}

export async function verifySession(token: string | undefined) {
  if (!token || !process.env.SESSION_SECRET) return false;
  try {
    await jwtVerify(token, key());
    return true;
  } catch {
    return false;
  }
}

/** Verifies a Telegram Login Widget payload and that it's YOU (user id == TELEGRAM_CHAT_ID). */
export function verifyTelegramLogin(params: Record<string, string>): boolean {
  const { hash, ...rest } = params;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!hash || !token) return false;
  const dataCheck = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (expected.length !== hash.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return false;
  const authDate = Number(rest.auth_date);
  const age = Date.now() / 1000 - authDate;
  if (!Number.isFinite(authDate) || authDate <= 0 || age < -60 || age > 86400) return false;
  return rest.id === process.env.TELEGRAM_CHAT_ID?.trim();
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// A separate signing key keeps a short-lived login link from being used as a session cookie.
function telegramLinkKey() {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", key()).update("telegram-login-link").digest();
}

export async function createTelegramLoginToken() {
  const owner = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!owner) throw new Error("TELEGRAM_CHAT_ID is not set");
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(owner)
    .setAudience("telegram-login").setIssuedAt().setExpirationTime("5m").sign(telegramLinkKey());
}

export async function verifyTelegramLoginToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, telegramLinkKey(), { algorithms: ["HS256"], audience: "telegram-login" });
    return !!payload.sub && payload.sub === process.env.TELEGRAM_CHAT_ID?.trim() ? payload.sub : null;
  } catch {
    return null;
  }
}

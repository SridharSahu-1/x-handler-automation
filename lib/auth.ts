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
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!hash || !token) return false;
  const dataCheck = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (expected.length !== hash.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return false;
  if (Date.now() / 1000 - Number(rest.auth_date ?? 0) > 86400) return false;
  return rest.id === process.env.TELEGRAM_CHAT_ID;
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

import { describe, it, expect, beforeAll } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { verifyTelegramLogin, createSession, verifySession } from "@/lib/auth";

const TOKEN = "123:abc";
function sign(data: Record<string, string>) {
  const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join("\n");
  const hash = createHmac("sha256", createHash("sha256").update(TOKEN).digest()).update(check).digest("hex");
  return { ...data, hash };
}

describe("auth", () => {
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = "42";
    process.env.SESSION_SECRET = "s".repeat(40);
  });
  it("accepts the owner's signed login", () => {
    expect(verifyTelegramLogin(sign({ id: "42", first_name: "Me", auth_date: String(Math.floor(Date.now() / 1000)) }))).toBe(true);
  });
  it("rejects other Telegram users", () => {
    expect(verifyTelegramLogin(sign({ id: "7", first_name: "X", auth_date: String(Math.floor(Date.now() / 1000)) }))).toBe(false);
  });
  it("rejects tampered payloads", () => {
    const p = sign({ id: "7", auth_date: String(Math.floor(Date.now() / 1000)) });
    expect(verifyTelegramLogin({ ...p, id: "42" })).toBe(false);
  });
  it("rejects stale logins", () => {
    expect(verifyTelegramLogin(sign({ id: "42", auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400) }))).toBe(false);
  });
  it("round-trips sessions", async () => {
    expect(await verifySession(await createSession("me"))).toBe(true);
    expect(await verifySession("garbage")).toBe(false);
    expect(await verifySession(undefined)).toBe(false);
  });
});

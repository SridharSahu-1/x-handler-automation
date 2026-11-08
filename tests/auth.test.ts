import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { verifyTelegramLogin, createSession, verifySession, createTelegramLoginToken, verifyTelegramLoginToken } from "@/lib/auth";

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
  it("rejects missing, malformed, and future auth dates", () => {
    for (const date of [undefined, "invalid", "0", String(Math.floor(Date.now() / 1000) + 3600)]) {
      expect(verifyTelegramLogin(sign({ id: "42", ...(date ? { auth_date: date } : {}) }))).toBe(false);
    }
  });
  it("sets a usable session cookie on HTTP development and HTTPS deployments", async () => {
    const { GET } = await import("@/app/api/auth/telegram/route");
    const params = new URLSearchParams(sign({ id: "42", auth_date: String(Math.floor(Date.now() / 1000)) }));
    for (const origin of ["http://localhost:3000", "https://dashboard.example.com"]) {
      const response = await GET(new Request(`${origin}/api/auth/telegram?${params}`));
      expect(response.headers.get("location")).toBe(`${origin}/`);
      const cookie = response.cookies.get("xh_session");
      expect(await verifySession(cookie?.value)).toBe(true);
      expect(response.headers.get("set-cookie")?.includes("Secure")).toBe(origin.startsWith("https:"));
    }
  });
  it("accepts a bot login link without treating the link token as a session", async () => {
    const token = await createTelegramLoginToken();
    expect(await verifyTelegramLoginToken(token)).toBe("42");
    expect(await verifySession(token)).toBe(false);
    expect(await verifyTelegramLoginToken(await createSession("tg:42"))).toBeNull();
    expect(await verifyTelegramLoginToken(`${token}broken`)).toBeNull();
    const { GET } = await import("@/app/api/auth/telegram/route");
    const response = await GET(new Request(`https://dashboard.example.com/api/auth/telegram?token=${token}`));
    expect(response.headers.get("location")).toBe("https://dashboard.example.com/");
    expect(await verifySession(response.cookies.get("xh_session")?.value)).toBe(true);
  });
  it("expires bot login links after five minutes", async () => {
    vi.useFakeTimers();
    try {
      const token = await createTelegramLoginToken();
      vi.setSystemTime(Date.now() + 301_000);
      expect(await verifyTelegramLoginToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("round-trips sessions", async () => {
    expect(await verifySession(await createSession("me"))).toBe(true);
    expect(await verifySession("garbage")).toBe(false);
    expect(await verifySession(undefined)).toBe(false);
  });
});

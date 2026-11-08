import { NextResponse } from "next/server";
import { createSession, verifyTelegramLogin, verifyTelegramLoginToken, SESSION_COOKIE } from "@/lib/auth";

/** Telegram Login Widget redirects here with signed user data. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const owner = params.token
    ? await verifyTelegramLoginToken(params.token)
    : verifyTelegramLogin(params) ? params.id : null;
  if (!owner) return NextResponse.redirect(new URL("/login?error=telegram", req.url));
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, await createSession(`tg:${owner}`), {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return res;
}

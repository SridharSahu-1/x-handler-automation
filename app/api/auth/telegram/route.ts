import { NextResponse } from "next/server";
import { createSession, verifyTelegramLogin, SESSION_COOKIE } from "@/lib/auth";

/** Telegram Login Widget redirects here with signed user data. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  if (!verifyTelegramLogin(params)) return NextResponse.redirect(new URL("/login?error=telegram", req.url));
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, await createSession(`tg:${params.id}`), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return res;
}

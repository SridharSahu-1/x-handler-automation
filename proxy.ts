import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

// Dashboard is single-user. Webhooks/crons authenticate themselves with their own secrets.
export async function proxy(request: NextRequest) {
  const ok = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|login|generated/|api/telegram|api/cron|api/auth|api/setup|.well-known/workflow/).*)",
    },
  ],
};

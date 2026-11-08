"use client";

import { useEffect, useRef } from "react";

/** Official Telegram Login Widget; redirects to /api/auth/telegram with a signed payload. */
export function TelegramLogin({ bot }: { bot: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.childElementCount) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", bot.trim().replace(/^@/, ""));
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "8");
    s.setAttribute("data-auth-url", `${window.location.origin}/api/auth/telegram`);
    s.setAttribute("data-request-access", "write");
    el.appendChild(s);
    return () => el.replaceChildren();
  }, [bot]);
  return <div ref={ref} className="flex justify-center" />;
}

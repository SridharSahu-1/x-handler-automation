import { Suspense } from "react";
import { passwordLogin } from "../(dashboard)/actions";
import { TelegramLogin } from "@/components/telegram-login";

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-6">
        <div className="mb-5 font-mono text-sm font-semibold">
          <span className="text-accent">$</span> x-handler
        </div>
        <Suspense>
          <LoginForm searchParams={props.searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const telegramReady = bot && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;
  return (
    <>
      {error && <p className="mb-3 text-sm text-red-500">{error === "telegram" ? "Telegram login failed. Use your configured owner account and try again." : "Wrong password."}</p>}
      {telegramReady && (
        <>
          <TelegramLogin bot={bot} />
          <p className="mt-3 text-xs text-muted">You can also send /login to your bot for a private sign-in link. If the widget reports an invalid domain, use /setdomain in @BotFather.</p>
          <div className="my-4 text-center text-xs text-muted">or</div>
        </>
      )}
      {!telegramReady && process.env.TELEGRAM_BOT_TOKEN && <p className="mb-4 text-sm text-muted">Send /login to your Telegram bot for a private sign-in link.</p>}
      <form action={passwordLogin} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <input name="password" type="password" placeholder="Dashboard password" className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
        <button className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black">Log in</button>
      </form>
    </>
  );
}

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
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  return (
    <>
      {error && <p className="mb-3 text-sm text-red-500">{error === "telegram" ? "That Telegram account isn't allowed." : "Wrong password."}</p>}
      {bot && (
        <>
          <TelegramLogin bot={bot} />
          <div className="my-4 text-center text-xs text-muted">or</div>
        </>
      )}
      <form action={passwordLogin} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <input name="password" type="password" placeholder="Dashboard password" className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
        <button className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black">Log in</button>
      </form>
    </>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Card, Stat, Badge, PageTitle, Skeleton, Empty } from "@/components/ui";
import { PauseToggle, NewDraftButton } from "@/components/controls";
import { overviewData } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { slotDate, fmtLocal } from "@/lib/time";
import { isDryRun, optionalEnv } from "@/lib/env";
import { publisherMode } from "@/lib/publisher";
import { Countdown } from "@/components/countdown";

export default function Page() {
  return (
    <>
      <PageTitle sub="Today at a glance">Overview</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  await connection();
  const [s, data] = await Promise.all([getSettings(), overviewData()]);
  const next = slotDate(s.slotTime, s.timezone, new Date(), true);
  const sum = (k: "impressions" | "likes" | "replies" | "bookmarks") => [...data.metrics.values()].reduce((t, m) => t + m[k], 0);
  const pending = data.drafts.find((d) => d.status === "pending");
  const providers = [
    ["Gemini", optionalEnv("GOOGLE_GENERATIVE_AI_API_KEY")],
    ["Groq", optionalEnv("GROQ_API_KEY")],
    ["OpenRouter", optionalEnv("OPENROUTER_API_KEY")],
    ["Tavily", optionalEnv("TAVILY_API_KEY")],
    ["Exa", optionalEnv("EXA_API_KEY")],
    ["Serper", optionalEnv("SERPER_API_KEY")],
    [`Posting: ${{ xapi: "X API", buffer: "Buffer", manual: "manual (you tap post)" }[publisherMode()]}`, true],
    ["Telegram", optionalEnv("TELEGRAM_BOT_TOKEN")],
    ["Blob", optionalEnv("BLOB_READ_WRITE_TOKEN")],
  ] as const;

  return (
    <div className="space-y-4">
      {!s.onboarded && (
        <Card className="border-amber-500/40">
          <p className="text-sm">
            Setup isn&apos;t finished. Open your Telegram bot and send <code>/start</code> for the voice interview, or fill in your style card on the{" "}
            <Link className="underline" href="/voice">Voice</Link> page. Daily posts won&apos;t start until then.
          </p>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PauseToggle paused={s.paused} />
        <NewDraftButton />
        {isDryRun() && <Badge tone="warn">DRY RUN: not posting to X</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Next slot" value={<Countdown to={next.toISOString()} />} hint={fmtLocal(next, s.timezone)} />
        <Stat label="Posts (7d)" value={data.posts.length} />
        <Stat label="Impressions (7d)" value={sum("impressions").toLocaleString()} />
        <Stat label="Replies · Bookmarks" value={`${sum("replies")} · ${sum("bookmarks")}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Today's draft" right={<Link href="/drafts" className="text-xs text-muted hover:underline">All drafts →</Link>}>
          {pending ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap text-sm">{pending.editedText ?? pending.variants[pending.chosen]?.text}</p>
              <div className="flex gap-2 text-xs text-muted">
                <Badge tone="pending">pending</Badge> {pending.pillar} · {pending.format}
              </div>
              <Link href={`/drafts#d${pending.id}`} className="text-sm text-accent hover:underline">Review →</Link>
            </div>
          ) : (
            <Empty>No draft waiting. Latest: {data.drafts[0] ? <Badge tone={data.drafts[0].status}>{data.drafts[0].status}</Badge> : "none yet"}</Empty>
          )}
        </Card>
        <Card title="Health">
          <div className="flex flex-wrap gap-2">
            {providers.map(([n, ok]) => (
              <Badge key={n} tone={ok ? "posted" : "error"}>
                {ok ? "✓" : "✗"} {n}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Paid API spend (last 30 days, estimated): ${data.cost30d.toFixed(2)}</p>
          {data.logs.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {data.logs.map((l) => (
                <li key={l.id} className="truncate">
                  <Badge tone={l.level}>{l.level}</Badge> <span className="text-muted">[{l.step}]</span> {l.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

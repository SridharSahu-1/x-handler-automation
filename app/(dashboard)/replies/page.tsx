import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Empty, Badge, Button, inputCls } from "@/components/ui";
import { ReplyButtons, TargetToggle, RunReplies } from "@/components/small-actions";
import { repliesData } from "@/lib/queries";
import { replyIntentUrl } from "@/lib/actions/replies";
import { addReplyTarget } from "../actions";

export default function Page() {
  return (
    <>
      <PageTitle sub="The #1 growth lever at 0 followers. The app only drafts; you post each reply yourself (automated replies get accounts suspended).">Replies</PageTitle>
      <div className="mb-4"><RunReplies /></div>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const { targets, suggestions } = await repliesData();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {suggestions.length === 0 && <Empty>No suggestions yet. They arrive daily with the cron, or hit the button.</Empty>}
        {suggestions.map((r) => (
          <Card key={r.id} title={<span>@{r.handle} <Badge tone={r.status === "new" ? "pending" : r.status === "used" ? "posted" : undefined}>{r.status}</Badge></span>}>
            <p className="text-sm text-muted">{r.tweetText}</p>
            <p className="mt-2 text-sm">→ {r.suggestion}</p>
            {r.status === "new" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={replyIntentUrl(r.tweetId, r.suggestion)} target="_blank" rel="noreferrer" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black">Reply on X</a>
                <ReplyButtons id={r.id} />
              </div>
            )}
          </Card>
        ))}
      </div>
      <Card title={`Target accounts (${targets.filter((t) => t.active).length} active)`}>
        <form action={addReplyTarget} className="mb-3 flex gap-2">
          <input name="handles" placeholder="@handle, @handle2" className={inputCls} />
          <Button>Add</Button>
        </form>
        <p className="mb-2 text-xs text-muted">Best targets: active devs in your niche with 5k-200k followers who actually reply. Mega-accounts bury replies.</p>
        <ul className="space-y-1 text-sm">
          {targets.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <TargetToggle id={t.id} active={t.active} />
              <a href={`https://x.com/${t.handle}`} target="_blank" rel="noreferrer" className="hover:underline">@{t.handle}</a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

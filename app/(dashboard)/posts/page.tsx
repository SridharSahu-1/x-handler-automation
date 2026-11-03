import { Suspense } from "react";
import { connection } from "next/server";
import { PageTitle, Skeleton, Empty, Badge } from "@/components/ui";
import { DeletePostButton } from "@/components/small-actions";
import { postsWithMetrics } from "@/lib/queries";
import { postUrl } from "@/lib/publisher";

export default function Page() {
  return (
    <>
      <PageTitle sub="Everything that went out, with the numbers I could get for each (X API: +1h/+6h/+24h · Buffer: +24h/+72h · manual: your rating).">Posts</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  await connection();
  const posts = await postsWithMetrics();
  if (!posts.length) return <Empty>Nothing posted yet.</Empty>;
  return (
    <div className="space-y-3">
      {posts.map((p) => (
        <article key={p.id} className={`rounded-xl border border-line bg-panel p-4 ${p.deleted ? "opacity-50" : ""}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono">#{p.id}</span>
            <span>{new Date(p.postedAt).toLocaleString()}</span>
            <span>{p.pillar} · {p.format}</span>
            {p.hasMedia && <Badge>image</Badge>}
            {p.deleted && <Badge tone="error">deleted</Badge>}
            <Badge>{p.provider}</Badge>
            {p.tweetId?.startsWith("dry-") && <Badge tone="warn">dry run</Badge>}
            {!p.tweetId && !p.deleted && <Badge tone="pending">{p.provider === "manual" ? "waiting for your link" : "sending"}</Badge>}
            <span className="ml-auto flex gap-2">
              {postUrl(p.tweetId) && (
                <a className="underline" href={postUrl(p.tweetId)!} target="_blank" rel="noreferrer">Open on X</a>
              )}
              {!p.deleted && <DeletePostButton id={p.id} />}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{p.text}</p>
          {p.metrics.length > 0 && (
            <table className="mt-3 w-full text-xs tabular-nums">
              <thead className="text-muted">
                <tr><th className="text-left font-normal">at</th><th>👁</th><th>❤️</th><th>💬</th><th>🔁</th><th>🗨</th><th>🔖</th><th>👤</th><th>score</th></tr>
              </thead>
              <tbody>
                {p.metrics.sort((a, b) => a.id - b.id).map((m) => (
                  <tr key={m.id} className="text-center">
                    <td className="text-left">{m.checkpoint}</td><td>{m.impressions}</td><td>{m.likes}</td><td>{m.replies}</td><td>{m.reposts}</td><td>{m.quotes}</td><td>{m.bookmarks}</td><td>{m.profileClicks}</td><td>{m.score.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      ))}
    </div>
  );
}

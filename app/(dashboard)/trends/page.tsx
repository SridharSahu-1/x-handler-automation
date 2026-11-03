import { Suspense } from "react";
import { connection } from "next/server";
import { PageTitle, Skeleton, Empty, Badge } from "@/components/ui";
import { RefreshTrends, WriteAbout } from "@/components/small-actions";
import { trendsList } from "@/lib/queries";

export default function Page() {
  return (
    <>
      <PageTitle sub="From Hacker News, GitHub, Reddit, dev.to and Lobsters, scored for freshness and fit to your pillars.">Trends</PageTitle>
      <div className="mb-4"><RefreshTrends /></div>
      <Suspense fallback={<Skeleton />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  await connection();
  const trends = await trendsList();
  if (!trends.length) return <Empty>No trends in the last 48h. Hit refresh.</Empty>;
  return (
    <ul className="space-y-2">
      {trends.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <span className="w-10 tabular-nums text-muted">{t.score.toFixed(2)}</span>
          <a href={t.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">{t.title}</a>
          <Badge>{t.source}</Badge>
          {t.pillar && <Badge>{t.pillar}</Badge>}
          {t.usedAt ? <Badge tone="posted">used</Badge> : <WriteAbout topic={`${t.title} (${t.url})`} />}
        </li>
      ))}
    </ul>
  );
}

import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Empty } from "@/components/ui";
import { ImpressionsChart, HourChart } from "@/components/charts";
import { postsWithMetrics } from "@/lib/queries";
import { getSettings, FORMATS } from "@/lib/settings";
import { armKey, armTrials } from "@/lib/content/bandit";

export default function Page() {
  return (
    <>
      <PageTitle sub="What's working, from your own numbers. Score = weighted engagement / impressions.">Analytics</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const [posts, s] = await Promise.all([postsWithMetrics(200), getSettings()]);
  const live = posts.filter((p) => !p.deleted);
  if (!live.length) return <Empty>No data yet. Analytics fill in after your first posts reach their +24h check.</Empty>;

  const best = (p: (typeof live)[number]) => p.metrics.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0];
  const byDay = new Map<string, { impressions: number; engagement: number }>();
  const byHour = new Map<number, number[]>();
  for (const p of live) {
    const m = best(p);
    const day = p.postedAt.toISOString().slice(5, 10);
    const cur = byDay.get(day) ?? { impressions: 0, engagement: 0 };
    byDay.set(day, { impressions: cur.impressions + (m?.impressions ?? 0), engagement: cur.engagement + (m ? m.likes + m.replies + m.reposts + m.bookmarks : 0) });
    const hour = Number(p.postedAt.toLocaleString("en-US", { timeZone: s.timezone, hour: "2-digit", hourCycle: "h23" }));
    if (m) byHour.set(hour, [...(byHour.get(hour) ?? []), m.score]);
  }
  const days = [...byDay.entries()].sort().map(([day, v]) => ({ day, ...v }));
  const hours = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, xs]) => ({ hour: `${h}:00`, score: Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) }));

  return (
    <div className="space-y-4">
      <Card title="Impressions per day"><ImpressionsChart data={days} /></Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Avg score by posting hour"><HourChart data={hours} /></Card>
        <Card title="Top posts">
          <ol className="space-y-2 text-sm">
            {[...live].sort((a, b) => (best(b)?.score ?? 0) - (best(a)?.score ?? 0)).slice(0, 5).map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className="w-16 shrink-0 tabular-nums text-muted">{best(p)?.impressions ?? 0} 👁</span>
                <span className="line-clamp-2">{p.text}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Card title="What the learner thinks (pillar × format win-rate)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left font-normal text-muted">pillar</th>
                {FORMATS.map((f) => <th key={f} className="p-1 font-normal text-muted">{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {s.pillars.map((p) => (
                <tr key={p}>
                  <td className="p-1">{p}</td>
                  {FORMATS.map((f) => {
                    const a = s.bandit[armKey(p, f)];
                    const mean = a ? a.a / (a.a + a.b) : 0.5;
                    const n = armTrials(a);
                    return (
                      <td key={f} className="p-1 text-center tabular-nums" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(mean * 60)}%, transparent)` }}>
                        {n ? `${Math.round(mean * 100)}% (${n})` : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Each cell starts at 50%. With 1 post/day it takes a few weeks before this means much; the system keeps exploring until then.</p>
      </Card>
    </div>
  );
}

import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Badge, Empty } from "@/components/ui";
import { logsList, dailyCost } from "@/lib/queries";

export default function Page() {
  return (
    <>
      <PageTitle sub="Pipeline events and estimated X API spend. For step-by-step workflow runs: npx workflow web (local) or the Vercel dashboard → Workflows.">Logs</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const [logs, cost] = await Promise.all([logsList(), dailyCost()]);
  return (
    <div className="space-y-4">
      <Card title="Estimated X API cost per day">
        {cost.length === 0 ? <Empty>No spend yet.</Empty> : (
          <div className="flex flex-wrap gap-2 text-xs">
            {cost.map((c) => <span key={c.day} className="rounded-md border border-line px-2 py-1 tabular-nums">{c.day.slice(5)}: ${Number(c.cost).toFixed(3)}</span>)}
          </div>
        )}
      </Card>
      <Card title="Events">
        {logs.length === 0 ? <Empty>No events yet.</Empty> : (
          <ul className="space-y-1 font-mono text-xs">
            {logs.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="shrink-0 text-muted">{new Date(l.createdAt).toLocaleString()}</span>
                <Badge tone={l.level}>{l.level}</Badge>
                <span className="shrink-0 text-muted">[{l.step}]</span>
                <span className="break-all">{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

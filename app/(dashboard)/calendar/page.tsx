import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Badge } from "@/components/ui";
import { draftsList } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { slotDate, fmtLocal } from "@/lib/time";

export default function Page() {
  return (
    <>
      <PageTitle sub="Past 14 days and the next 7 slots. Format never repeats two days in a row; the learner picks pillar × format each day.">Calendar</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const [drafts, s] = await Promise.all([draftsList(60), getSettings()]);
  const now = new Date();
  const days: { date: Date; key: string }[] = [];
  for (let i = -13; i <= 7; i++) {
    const d = slotDate(s.slotTime, s.timezone, new Date(now.getTime() + i * 864e5));
    days.push({ date: d, key: d.toLocaleDateString("en-CA", { timeZone: s.timezone }) });
  }
  return (
    <Card>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map(({ date, key }) => {
          const ds = drafts.filter((d) => d.createdAt.toLocaleDateString("en-CA", { timeZone: s.timezone }) === key);
          const posted = ds.find((d) => d.status === "posted");
          const shown = posted ?? ds[0];
          const future = date > now;
          return (
            <div key={key} className={`min-h-24 rounded-lg border p-2 text-xs ${key === now.toLocaleDateString("en-CA", { timeZone: s.timezone }) ? "border-accent" : "border-line"}`}>
              <div className="mb-1 text-muted">{fmtLocal(date, s.timezone)}</div>
              {shown ? (
                <>
                  <Badge tone={shown.status}>{shown.status}</Badge>
                  <div className="mt-1 line-clamp-3">{shown.editedText ?? shown.variants[shown.chosen]?.text ?? shown.topic}</div>
                  <div className="mt-1 text-muted">{shown.format}</div>
                </>
              ) : (
                <span className="text-muted">{future ? (s.paused ? "paused" : "auto") : "-"}</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

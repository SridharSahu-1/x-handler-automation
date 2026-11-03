import { Suspense } from "react";
import { connection } from "next/server";
import { PageTitle, Skeleton, Empty } from "@/components/ui";
import { DraftCard } from "@/components/draft-card";
import { NewDraftButton } from "@/components/controls";
import { draftsList } from "@/lib/queries";

export default function Page() {
  return (
    <>
      <PageTitle sub="Pick a variant, edit inline, approve. Same actions as the Telegram buttons.">Drafts</PageTitle>
      <div className="mb-4"><NewDraftButton withTopic /></div>
      <Suspense fallback={<Skeleton />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  await connection();
  const drafts = await draftsList();
  if (!drafts.length) return <Empty>No drafts yet.</Empty>;
  return (
    <div className="space-y-4">
      {drafts.map((d) => (
        <DraftCard key={`${d.id}-${d.updatedAt.getTime()}`} d={d} />
      ))}
    </div>
  );
}

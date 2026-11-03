import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Button, inputCls, Empty } from "@/components/ui";
import { DeleteSample } from "@/components/small-actions";
import { Playground } from "@/components/playground";
import { voiceData } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { SLOP_PATTERNS } from "@/lib/content/rules";
import { addVoiceSample, saveStyleCard } from "../actions";

export default function Page() {
  return (
    <>
      <PageTitle sub="Everything the writer uses to sound like you. Edits you make to drafts are added here automatically.">Voice</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const [rows, s] = await Promise.all([voiceData(), getSettings()]);
  const groups = { interview: rows.filter((r) => r.kind === "interview"), sample: rows.filter((r) => r.kind === "sample"), edit: rows.filter((r) => r.kind === "edit") };
  return (
    <div className="space-y-4">
      <Card title="Playground"><Playground /></Card>
      <Card title="Style card">
        <form action={saveStyleCard} className="space-y-2">
          <textarea name="styleCard" defaultValue={s.styleCard} rows={8} className={inputCls} placeholder="- lowercase most of the time&#10;- dry humour, no exclamation marks&#10;- never uses emojis except 💀" />
          <div className="flex items-center gap-3">
            <Button>Save</Button>
            {!s.onboarded && (
              <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="markOnboarded" /> mark setup as complete (skip the Telegram interview)</label>
            )}
          </div>
        </form>
      </Card>
      <Card title="Add writing samples">
        <form action={addVoiceSample} className="space-y-2">
          <textarea name="text" rows={5} className={inputCls} placeholder="Paste things you wrote: Slack messages, README intros, LinkedIn posts. Separate samples with a blank line." />
          <Button>Add</Button>
        </form>
      </Card>
      {(["interview", "edit", "sample"] as const).map((k) => (
        <Card key={k} title={{ interview: "Interview answers", edit: "Learned from your edits", sample: "Writing samples" }[k] + ` (${groups[k].length})`}>
          {groups[k].length === 0 ? <Empty>None yet.</Empty> : (
            <ul className="space-y-3 text-sm">
              {groups[k].map((r) => (
                <li key={r.id} className="border-b border-line pb-2 last:border-0">
                  {r.prompt && <p className="text-xs text-muted">{k === "edit" ? "Draft: " : "Q: "}{r.prompt}</p>}
                  <p className="whitespace-pre-wrap">{r.text}</p>
                  <DeleteSample id={r.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Card title={`Built-in anti-slop rules (${SLOP_PATTERNS.length})`}>
        <p className="text-xs text-muted">{SLOP_PATTERNS.map((p) => p.why).join(" · ")}</p>
        <p className="mt-2 text-xs text-muted">Add your own banned phrases in Settings.</p>
      </Card>
    </div>
  );
}

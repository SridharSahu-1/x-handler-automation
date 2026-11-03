import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Button, inputCls } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { saveSettings } from "../actions";

export default function Page() {
  return (
    <>
      <PageTitle sub="Secrets/API keys live in Vercel env vars, not here.">Settings</PageTitle>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

async function Body() {
  await connection();
  const s = await getSettings();
  return (
    <form action={saveSettings} className="space-y-4">
      <Card title="Content">
        <div className="space-y-3">
          <Field label="Pillars" hint="One per line. 3-5 is ideal; staying in a niche helps the ranker match you to the right audience.">
            <textarea name="pillars" rows={5} defaultValue={s.pillars.join("\n")} className={inputCls} />
          </Field>
          <Field label="Extra banned phrases" hint="One per line, on top of the built-in anti-slop rules.">
            <textarea name="bannedPhrases" rows={4} defaultValue={s.bannedPhrases.join("\n")} className={inputCls} />
          </Field>
        </div>
      </Card>
      <Card title="Schedule & approval">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Daily slot (HH:mm)" hint="Cron starts at 16:30 IST; pick a slot after that."><input name="slotTime" defaultValue={s.slotTime} className={inputCls} /></Field>
          <Field label="Timezone"><input name="timezone" defaultValue={s.timezone} className={inputCls} /></Field>
          <Field label="Random jitter (± minutes)" hint="So posts don't land at the exact same minute daily."><input name="jitterMinutes" type="number" defaultValue={s.jitterMinutes} className={inputCls} /></Field>
          <Field label="Posts per day" hint="Start at 1. The ranker decays repeated posts from the same author."><input name="postsPerDay" type="number" min={1} max={3} defaultValue={s.postsPerDay} className={inputCls} /></Field>
          <Field label="Manual draft approval timeout (minutes)"><input name="approvalTimeoutMinutes" type="number" defaultValue={s.approvalTimeoutMinutes} className={inputCls} /></Field>
          <Field label="Source link" hint="Trend-based posts always carry their source link.">
            <select name="linkPlacement" defaultValue={s.linkPlacement} className={inputCls}>
              <option value="post">At the end of the post</option>
              <option value="reply">In the first reply</option>
            </select>
          </Field>
          <Field label="Personal posts (%)" hint="How often a post may use your own work experience. The rest are professional takes on trending topics. Your private life is never used."><input name="personalShare" type="number" min={0} max={100} defaultValue={Math.round(s.personalShare * 100)} className={inputCls} /></Field>
          <Field label="Auto-post bar (critic 'human' score 0-10)" hint="If you don't respond by the slot, it posts only if the draft scores at least this and passed every gate."><input name="autoPostThreshold" type="number" min={0} max={10} defaultValue={s.autoPostThreshold} className={inputCls} /></Field>
        </div>
      </Card>
      <Card title="Providers & budget">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="LLM order" hint="Comma separated: gemini, groq, openrouter"><input name="llmOrder" defaultValue={s.llmOrder.join(", ")} className={inputCls} /></Field>
          <Field label="Search order" hint="Comma separated: tavily, exa, serper"><input name="searchOrder" defaultValue={s.searchOrder.join(", ")} className={inputCls} /></Field>
          <Field label="Daily X read budget (posts)" hint="Reply suggestions read ~5 posts per target account at ~$0.005 each."><input name="dailyXReadBudget" type="number" defaultValue={s.dailyXReadBudget} className={inputCls} /></Field>
          <Field label="Reply suggestions per day"><input name="replySuggestionsPerDay" type="number" defaultValue={s.replySuggestionsPerDay} className={inputCls} /></Field>
        </div>
      </Card>
      <Button variant="primary">Save settings</Button>
    </form>
  );
}

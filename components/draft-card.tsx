"use client";

import { useState, useTransition } from "react";
import twitter from "twitter-text";
import type { drafts } from "@/lib/db/schema";
import { Badge, Button } from "./ui";
import { decideAction, pickVariant, saveEdit } from "@/app/(dashboard)/actions";

type Draft = typeof drafts.$inferSelect;

export function DraftCard({ d }: { d: Draft }) {
  const v = d.variants[d.chosen];
  const [text, setText] = useState(d.editedText ?? v?.text ?? "");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const parsed = twitter.parseTweet(text);
  const live = d.status === "pending" || d.status === "approved";
  const run = (fn: () => Promise<string | void>) => start(async () => setMsg((await fn()) || "Done"));

  return (
    <article id={`d${d.id}`} className="rounded-xl border border-line bg-panel p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono">#{d.id}</span>
        <Badge tone={d.status}>{d.status}</Badge>
        <span>{d.pillar}</span>·<span>{d.format}</span>
        {d.scheduledFor && <span>· slot {new Date(d.scheduledFor).toLocaleString()}</span>}
        <span className="ml-auto">{new Date(d.createdAt).toLocaleString()}</span>
      </header>
      {d.error && <p className="mb-2 text-xs text-red-500">{d.error}</p>}

      {d.variants.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          {d.variants.map((x, i) => (
            <button
              key={i}
              disabled={!live || pending}
              onClick={() =>
                start(async () => {
                  await pickVariant(d.id, i);
                  setText(x.text);
                })
              }
              className={`rounded-lg border p-3 text-left text-sm transition ${i === d.chosen ? "border-accent" : "border-line hover:border-stone-400"}`}
            >
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>Variant {i + 1}</span>
                {x.scores && <span>human {x.scores.human}{x.scores.originality != null && <> · original {x.scores.originality}</>} · value {x.scores.value} · risk {x.scores.reportRisk}</span>}
              </div>
              <p className="whitespace-pre-wrap">{x.text}</p>
              {x.assetUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.assetUrl} alt="" className="mt-2 rounded-md border border-line" />
              )}
              {x.selfReply && <p className="mt-2 text-xs text-muted">↳ {x.selfReply}</p>}
              {x.problems && x.problems.length > 0 && <p className="mt-2 text-xs text-amber-600">⚠ {x.problems.join("; ")}</p>}
            </button>
          ))}
        </div>
      )}

      {live && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full rounded-lg border border-line bg-bg p-3 text-sm" />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className={parsed.valid ? "text-muted" : "text-red-500"}>{parsed.weightedLength}/280</span>
              <Button variant="ghost" disabled={pending || text === (d.editedText ?? v?.text)} onClick={() => run(() => saveEdit(d.id, text))}>
                Save edit
              </Button>
            </div>
          </div>
          <TweetPreview text={text} image={v?.assetUrl ?? null} />
        </div>
      )}

      {live && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={() => run(() => decideAction(d.id, { action: "approve" }))}>Approve for slot</Button>
          <Button disabled={pending} onClick={() => run(() => decideAction(d.id, { action: "approve", now: true }))}>Post now</Button>
          <Button disabled={pending} onClick={() => run(() => decideAction(d.id, { action: "regen", reason: "boring", note: "Boring / obvious. Needs a sharper angle." }))}>Regenerate</Button>
          <Button disabled={pending} onClick={() => run(() => decideAction(d.id, { action: "regen", reason: "topic", note: "Wrong topic for this account." }))}>New topic</Button>
          <Button variant="danger" disabled={pending} onClick={() => run(() => decideAction(d.id, { action: "skip" }))}>Skip</Button>
          {msg && <span className="self-center text-xs text-muted">{msg}</span>}
        </div>
      )}

      {d.sources.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Sources ({d.sources.length})</summary>
          <ul className="mt-2 space-y-1">
            {d.sources.map((s, i) => (
              <li key={i}>
                <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function TweetPreview({ text, image }: { text: string; image: string | null }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <div className="flex gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-stone-500/30" />
        <div className="min-w-0">
          <div className="text-sm"><span className="font-semibold">You</span> <span className="text-muted">@you · now</span></div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-snug">{text}</p>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="mt-2 rounded-2xl border border-line" />
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import twitter from "twitter-text";
import { Button, inputCls } from "./ui";
import { playground } from "@/app/(dashboard)/actions";
import { FORMATS } from "@/lib/formats";

export function Playground() {
  const [format, setFormat] = useState<string>("take");
  const [topic, setTopic] = useState("");
  const [out, setOut] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={format} onChange={(e) => setFormat(e.target.value)} className={`${inputCls} w-36`}>
          {FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic, e.g. React Server Components caching" className={`${inputCls} flex-1`} />
        <Button disabled={pending || !topic} onClick={() => start(async () => setOut(await playground(format, topic)))}>{pending ? "Writing…" : "Generate"}</Button>
      </div>
      {out && (
        <div className="rounded-lg border border-line bg-bg p-3 text-sm">
          <p className="whitespace-pre-wrap">{out}</p>
          <p className="mt-2 text-xs text-muted">{twitter.parseTweet(out).weightedLength}/280 · not saved, not gated, just a test</p>
        </div>
      )}
    </div>
  );
}

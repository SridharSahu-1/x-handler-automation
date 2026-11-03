"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, inputCls } from "./ui";
import { setPaused, newDraft } from "@/app/(dashboard)/actions";

export function PauseToggle({ paused }: { paused: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant={paused ? "primary" : "danger"} disabled={pending} onClick={() => start(() => setPaused(!paused))}>
      {paused ? "▶ Resume posting" : "⏸ Pause all posting"}
    </Button>
  );
}

export function NewDraftButton({ withTopic = false }: { withTopic?: boolean }) {
  const [pending, start] = useTransition();
  const [topic, setTopic] = useState("");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {withTopic && <input className={`${inputCls} w-64`} placeholder="Optional topic or URL" value={topic} onChange={(e) => setTopic(e.target.value)} />}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await newDraft(topic);
            setMsg("Drafting… takes 1-3 min. It'll show up here and in Telegram.");
            setTimeout(() => router.refresh(), 60_000);
          })
        }
      >
        ✨ New draft now
      </Button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

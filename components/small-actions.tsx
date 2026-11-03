"use client";

import { useTransition, useState } from "react";
import { Button } from "./ui";
import { deletePostAction, markReply, toggleReplyTarget, deleteVoiceSample, profileAction, refreshTrends, runReplies, newDraft } from "@/app/(dashboard)/actions";

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return { pending, msg, run: (fn: () => Promise<unknown>) => start(async () => { const r = await fn(); setMsg(typeof r === "string" ? r : ""); }) };
}

export function DeletePostButton({ id }: { id: number }) {
  const { pending, run, msg } = useAct();
  const [confirm, setConfirm] = useState(false);
  if (msg) return <span>{msg}</span>;
  return confirm ? (
    <span className="flex gap-1">
      <Button variant="danger" disabled={pending} onClick={() => run(() => deletePostAction(id))}>Really delete</Button>
      <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
    </span>
  ) : (
    <button className="text-red-500 hover:underline" onClick={() => setConfirm(true)}>Delete</button>
  );
}

export function ReplyButtons({ id }: { id: number }) {
  const { pending, run } = useAct();
  return (
    <span className="flex gap-1">
      <Button disabled={pending} onClick={() => run(() => markReply(id, "used"))}>Done</Button>
      <Button variant="ghost" disabled={pending} onClick={() => run(() => markReply(id, "dismissed"))}>Dismiss</Button>
    </span>
  );
}

export function TargetToggle({ id, active }: { id: number; active: boolean }) {
  const { pending, run } = useAct();
  return (
    <input type="checkbox" checked={active} disabled={pending} onChange={() => run(() => toggleReplyTarget(id, !active))} />
  );
}

export function DeleteSample({ id }: { id: number }) {
  const { pending, run } = useAct();
  return <button disabled={pending} className="text-xs text-red-500 hover:underline" onClick={() => run(() => deleteVoiceSample(id))}>remove</button>;
}

export function ProfileButtons({ id, auto = true }: { id?: number; auto?: boolean }) {
  const { pending, run, msg } = useAct();
  if (id) return msg ? <span className="text-xs text-muted">{msg}</span> : <Button disabled={pending} onClick={() => run(() => profileAction("apply", id))}>{auto ? "Apply to X" : "Use this"}</Button>;
  return (
    <span className="flex gap-2">
      <Button disabled={pending} onClick={() => run(() => profileAction("propose"))}>Propose name/bio</Button>
      <Button disabled={pending} onClick={() => run(() => profileAction("banner"))}>Propose banner</Button>
      {pending && <span className="self-center text-xs text-muted">Working…</span>}
    </span>
  );
}

export function RefreshTrends() {
  const { pending, run } = useAct();
  return <Button disabled={pending} onClick={() => run(refreshTrends)}>{pending ? "Collecting…" : "Refresh trends"}</Button>;
}

export function RunReplies() {
  const { pending, run, msg } = useAct();
  return (
    <span className="flex items-center gap-2">
      <Button disabled={pending} onClick={() => run(async () => { await runReplies(); return "Started; suggestions arrive in a minute or two."; })}>Find reply ideas now</Button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}

export function WriteAbout({ topic }: { topic: string }) {
  const { pending, run, msg } = useAct();
  return msg ? <span className="text-xs text-muted">{msg}</span> : (
    <Button disabled={pending} onClick={() => run(async () => { await newDraft(topic); return "Drafting…"; })}>Write about this</Button>
  );
}

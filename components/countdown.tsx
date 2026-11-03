"use client";

import { useSyncExternalStore } from "react";

// Ticks every 30s; server render shows a placeholder to avoid hydration mismatch.
function subscribe(cb: () => void) {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
}
const roundedNow = () => Math.floor(Date.now() / 30_000) * 30_000;

export function Countdown({ to }: { to: string }) {
  const now = useSyncExternalStore(subscribe, roundedNow, () => null);
  if (now === null) return <span>…</span>;
  const ms = Math.max(0, new Date(to).getTime() - now);
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return <span>{h}h {m}m</span>;
}

import { db, schema } from "./db";

export async function log(
  step: string,
  message: string,
  opts: { level?: "info" | "warn" | "error"; runId?: string; costUsd?: number } = {},
) {
  const line = `[${step}] ${message}`;
  if (opts.level === "error") console.error(line);
  else console.log(line);
  try {
    await db().insert(schema.runLogs).values({
      step,
      message: message.slice(0, 4000),
      level: opts.level ?? "info",
      runId: opts.runId,
      costUsd: opts.costUsd ?? 0,
    });
  } catch {
    // logging must never break the pipeline
  }
}

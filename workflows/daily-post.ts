import { createHook, getWorkflowMetadata, sleep } from "workflow";
import type { Decision } from "@/lib/actions/drafts";
import {
  isPausedStep,
  timingStep,
  planStep,
  startDraftStep,
  reviewVariantStep,
  finishDraftStep,
  failDraftStep,
  presentStep,
  markStep,
  autoPostAllowedStep,
  publishStep,
  announcePostedStep,
  metricsStep,
  banditStep,
  publisherModeStep,
  resolveTweetStep,
  askRatingStep,
} from "./steps";

type Timeout = { action: "timeout" };
type Kind = "daily" | "manual" | "intro";

/** Research+write, then each variant's review, then images: one step each so none hits the step time limit. */
async function buildDraft(plan: Awaited<ReturnType<typeof planStep>>, kind: Kind) {
  const { draftId, count } = await startDraftStep(plan, kind);
  try {
    for (let i = 0; i < count; i++) await reviewVariantStep(draftId, i);
    return await finishDraftStep(draftId);
  } catch (e) {
    await failDraftStep(draftId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/**
 * One post, end to end: plan → draft → Telegram/dashboard approval (with regen loop)
 * → post at the slot (or on timeout if quality clears the bar) → metrics (or your rating) → bandit update.
 */
export async function dailyPost(
  opts: { manual?: boolean; forceTopic?: string; kind?: "daily" | "manual" | "intro"; offsetMinutes?: number } = {},
) {
  "use workflow";
  const manual = !!opts.manual;
  const kind = opts.kind ?? (manual ? "manual" : "daily");
  if (!manual && (await isPausedStep())) return { status: "paused" };

  const { workflowRunId } = getWorkflowMetadata();
  const timing = await timingStep(manual, opts.offsetMinutes ?? 0);
  const token = `approval:${workflowRunId}`;
  const hook = createHook<Decision>({ token });
  const events = hook[Symbol.asyncIterator]();

  let plan = await planStep(opts.forceTopic);
  let draftId = await buildDraft(plan, kind);
  await presentStep(draftId, workflowRunId, token, manual ? null : timing.slot);

  const deadline: Promise<Timeout> = sleep(new Date(timing.deadline)).then(() => ({ action: "timeout" }) as const);
  let postNow = manual;
  let regens = 0;

  for (;;) {
    const ev = await Promise.race([events.next().then((r) => r.value as Decision), deadline]);
    if (ev.action === "timeout") {
      if (!manual && (await autoPostAllowedStep(draftId, timing.threshold))) {
        await markStep(draftId, "approved", `⏰ No response, and draft #${draftId} cleared the quality bar, so it's going out now.`);
        break;
      }
      await markStep(draftId, "expired", `⌛ Draft #${draftId} missed its approval window${manual ? "" : " and didn't clear the auto-post bar"}. Nothing posted. You can still approve it or tap Post now later.`);
      return { status: "expired", draftId };
    }
    if (ev.action === "skip") {
      await markStep(draftId, "skipped");
      return { status: "skipped", draftId };
    }
    if (ev.action === "regen") {
      if (++regens > 6) {
        await markStep(draftId, "skipped", "Too many regenerations for one slot. Skipping today; tell me what's off with /voice or in the dashboard.");
        return { status: "skipped", draftId };
      }
      await markStep(draftId, "skipped");
      if (ev.reason === "topic") plan = await planStep(undefined);
      draftId = await buildDraft(plan, kind);
      await presentStep(draftId, workflowRunId, token, manual ? null : timing.slot);
      continue;
    }
    // approve
    await markStep(draftId, "approved");
    if (ev.now) postNow = true;
    break;
  }

  // Approved for the slot: keep listening so "Post now" or "Skip" still work while we wait.
  if (!postNow) {
    const slot: Promise<Timeout> = sleep(new Date(timing.slot)).then(() => ({ action: "timeout" }) as const);
    for (;;) {
      const ev = await Promise.race([events.next().then((r) => r.value as Decision), slot]);
      if (ev.action === "timeout" || (ev.action === "approve" && ev.now)) break;
      if (ev.action === "skip") {
        await markStep(draftId, "skipped");
        return { status: "skipped", draftId };
      }
      // A plain re-approve or a regen request after approval: ignore and keep waiting.
    }
  }
  const postId = await publishStep(draftId);
  if (!postId) return { status: "not-posted", draftId };
  await announcePostedStep(postId);

  // Learning loop. Each provider exposes different data, at different speeds.
  const mode = await publisherModeStep();
  if (mode === "xapi") {
    await sleep("1h");
    await metricsStep(postId, "1h");
    await sleep("5h");
    await metricsStep(postId, "6h");
    await sleep("18h");
    await metricsStep(postId, "24h");
    await banditStep(postId);
  } else if (mode === "buffer") {
    // Live likes/replies come from X's public embed data; Buffer adds impressions about once a day.
    await sleep("10m");
    await resolveTweetStep(postId);
    await sleep("50m");
    await metricsStep(postId, "1h");
    await sleep("5h");
    await metricsStep(postId, "6h");
    await sleep("20h");
    await metricsStep(postId, "24h");
    await banditStep(postId);
    await sleep("46h");
    await metricsStep(postId, "72h");
  } else {
    // Manual: numbers appear once you've pasted the post's link; without it, a 1-tap rating teaches the bandit.
    await sleep("1h");
    await metricsStep(postId, "1h");
    await sleep("5h");
    await metricsStep(postId, "6h");
    await sleep("18h");
    const score = await metricsStep(postId, "24h");
    if (score === null) await askRatingStep(postId);
    else await banditStep(postId);
  }
  return { status: "posted", draftId, postId };
}

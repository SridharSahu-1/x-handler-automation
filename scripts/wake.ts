// Dev helper: skip a run's pending sleep(s), e.g. to test the approval-timeout path.
// usage: pnpm tsx scripts/wake.ts <runId>
import { getRun } from "workflow/api";
getRun(process.argv[2]).wakeUp().then((r) => console.log("woke", r));

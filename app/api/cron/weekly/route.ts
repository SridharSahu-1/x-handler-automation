import { start } from "workflow/api";
import { weeklyDigest } from "@/workflows/weekly";
import { isCronAuthorized } from "@/lib/cron";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const run = await start(weeklyDigest, []);
  return Response.json({ run: run.runId });
}

import type { VercelConfig } from "@vercel/config/v1";

// Hobby cron fires anywhere inside the hour, so the daily job runs early (UTC)
// and the workflow sleeps until the exact posting slot.
export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    { path: "/api/cron/daily", schedule: "0 11 * * *" }, // 16:30 IST
    { path: "/api/cron/weekly", schedule: "0 6 * * 1" }, // Monday 11:30 IST
  ],
};

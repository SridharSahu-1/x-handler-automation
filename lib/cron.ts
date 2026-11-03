import { safeEqual } from "./auth";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  return !!secret && safeEqual(header, `Bearer ${secret}`);
}

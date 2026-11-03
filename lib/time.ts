/** Offset (ms) of `tz` from UTC at instant `at`. */
function tzOffsetMs(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** Today's HH:mm in `tz` as a UTC Date (tomorrow's if `rollover` and it already passed). */
export function slotDate(hhmm: string, tz: string, now = new Date(), rollover = false): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const offset = tzOffsetMs(tz, now);
  const local = new Date(now.getTime() + offset);
  let utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - offset;
  if (rollover && utc <= now.getTime()) utc += 864e5;
  return new Date(utc);
}

export function fmtLocal(d: Date, tz: string) {
  return d.toLocaleString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

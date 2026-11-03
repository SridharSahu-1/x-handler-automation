import { describe, it, expect } from "vitest";
import { chooseArm, sampleBeta, engagementScore, updateArm, armKey } from "@/lib/content/bandit";
import { slotDate } from "@/lib/time";
import { heat } from "@/lib/trends";

describe("bandit", () => {
  it("samples Beta in [0,1] with the right mean", () => {
    let sum = 0;
    for (let i = 0; i < 4000; i++) {
      const v = sampleBeta(8, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
    }
    expect(sum / 4000).toBeCloseTo(0.8, 1);
  });
  it("never picks the avoided format", () => {
    for (let i = 0; i < 200; i++) expect(chooseArm({}, ["a", "b"], { avoidFormat: "take" }).format).not.toBe("take");
  });
  it("exploits a clearly winning arm", () => {
    const arms = { [armKey("a", "list")]: { a: 60, b: 2 } };
    let wins = 0;
    for (let i = 0; i < 200; i++) if (chooseArm(arms, ["a", "b"]).format === "list") wins++;
    expect(wins).toBeGreaterThan(150);
  });
  it("respects available pillars", () => {
    for (let i = 0; i < 100; i++) expect(chooseArm({}, ["a", "b", "c"], { availablePillars: new Set(["b"]) }).pillar).toBe("b");
  });
  it("weights replies far above likes", () => {
    const base = { impressions: 1000, likes: 0, replies: 0, reposts: 0, quotes: 0, bookmarks: 0, profileClicks: 0 };
    expect(engagementScore({ ...base, replies: 1 })).toBeGreaterThan(engagementScore({ ...base, likes: 7 }));
    // unknown impressions (free modes) → scored against 1,000 nominal views, not zero
    expect(engagementScore({ ...base, impressions: 0, likes: 5 })).toBeCloseTo((5 * 0.66) / 1000);
  });
  it("updates Beta counts", () => {
    const a = updateArm({}, "k", 0.5, 0.1);
    expect(a.k).toEqual({ a: 3, b: 2 });
    expect(updateArm(a, "k", 0.05, 0.1).k).toEqual({ a: 3, b: 3 });
  });
});

describe("slotDate", () => {
  it("converts IST slot to UTC", () => {
    const now = new Date("2026-10-30T05:00:00Z"); // 10:30 IST
    expect(slotDate("19:30", "Asia/Kolkata", now).toISOString()).toBe("2026-10-30T14:00:00.000Z");
  });
  it("rolls over to tomorrow when passed", () => {
    const now = new Date("2026-10-30T15:00:00Z"); // 20:30 IST
    expect(slotDate("19:30", "Asia/Kolkata", now, true).toISOString()).toBe("2026-10-31T14:00:00.000Z");
  });
  it("handles the IST date boundary", () => {
    const now = new Date("2026-10-30T20:00:00Z"); // 01:30 IST on the 31st
    expect(slotDate("19:30", "Asia/Kolkata", now).toISOString()).toBe("2026-10-31T14:00:00.000Z");
  });
  it("handles DST zones", () => {
    const now = new Date("2026-07-01T12:00:00Z");
    expect(slotDate("09:00", "America/New_York", now).toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("trend heat", () => {
  it("decays with age", () => {
    const fresh = heat({ source: "hn", title: "", url: "", points: 100, ageHours: 1 }, 100);
    const old = heat({ source: "hn", title: "", url: "", points: 100, ageHours: 48 }, 100);
    expect(fresh).toBeGreaterThan(old * 3);
  });
});

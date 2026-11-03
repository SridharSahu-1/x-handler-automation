import { describe, it, expect } from "vitest";
import { slopViolations } from "@/lib/content/rules";
import { tweetLength, fitsTweet } from "@/lib/content/length";
import { codeProblems } from "@/lib/content/codecheck";

describe("slopViolations", () => {
  const slop = [
    "In today's fast-paced world, AI is a game-changer for devs 🚀",
    "Let's dive in to how Bun unlocks seamless DX",
    "It's not just about speed, it's about developer happiness",
    "Shipping is hard — but worth it",
    "The result? 10x faster builds. Thoughts?",
    "#react #typescript #webdev new hooks dropped",
    "**Key insight:** cache everything",
  ];
  it.each(slop)("flags: %s", (t) => expect(slopViolations(t).length).toBeGreaterThan(0));

  const human = [
    "spent 3 hours on a bug that was a missing await in a forEach. forEach doesn't wait. use for...of",
    "hot take: most apps don't need a state library. useState + server components covers 90% of what I've built",
    "postgres tip: `EXPLAIN (ANALYZE, BUFFERS)` tells you way more than plain EXPLAIN. the buffers line is where the truth is",
  ];
  it.each(human)("passes: %s", (t) => expect(slopViolations(t)).toEqual([]));

  it("respects custom banned phrases", () => {
    expect(slopViolations("this is a no-brainer", ["no-brainer"])).toContain('"no-brainer"');
  });
});

describe("tweet length", () => {
  it("counts URLs as 23", () => {
    expect(tweetLength("see https://example.com/a/very/long/path/that/goes/on/and/on")).toBe(4 + 23);
  });
  it("enforces 280", () => {
    expect(fitsTweet("a".repeat(280))).toBe(true);
    expect(fitsTweet("a".repeat(281))).toBe(false);
  });
});

describe("codeProblems", () => {
  it("accepts valid TS", () => {
    expect(codeProblems("ts", "const x: number = 1;\nexport function f(a: string) { return a.length + x; }")).toEqual([]);
  });
  it("rejects broken TS", () => {
    expect(codeProblems("typescript", "const x = {;\nfunction (").length).toBeGreaterThan(0);
  });
  it("skips unknown languages", () => {
    expect(codeProblems("rust", "fn main( {")).toEqual([]);
  });
});

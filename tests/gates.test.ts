import { describe, it, expect, vi } from "vitest";

// The critic says the post is mostly about the author's life.
vi.mock("@/lib/llm", () => ({
  llmObject: vi.fn(async ({ system }: { system: string }) =>
    system.includes("fact checker") ? { unsupported: [] } : { human: 9, originality: 8, specificity: 8, value: 7, reportRisk: 1, personal: 7, notes: "talks about their routine" },
  ),
}));

describe("quality gates", () => {
  const ctx = { sourcesText: "", voice: "", bannedPhrases: [] };
  const v = { text: "i stopped grinding dsa.\n\nnow i spend evenings reading old nodejs services instead" };

  it("rejects a personal post unless the draft is allowed to be personal", async () => {
    const { runGates } = await import("@/lib/content/gates");
    const strict = await runGates(v, ctx);
    expect(strict.pass).toBe(false);
    expect(strict.problems.join()).toContain("too personal");
    const allowed = await runGates(v, { ...ctx, personal: true });
    expect(allowed.pass).toBe(true);
  });

  it("sends a long single-block post back for structure", async () => {
    const { runGates } = await import("@/lib/content/gates");
    const flat = "stop letting public functions call other public functions, it ruins your api when you add optional parameters later, always make a private helper instead";
    const r = await runGates({ text: flat }, { ...ctx, personal: true });
    expect(r.problems.join()).toContain("one flat block");
  });
});

describe("research relevance", () => {
  it("keeps search hits about the same subject and drops unrelated news", async () => {
    const { isRelated } = await import("@/lib/content/research");
    const topic = "Mistral releases Le Chonk, a 400B open-weights model";
    expect(isRelated(topic, "Mistral's new Le Chonk AI model is big, open and available for download")).toBe(true);
    expect(isRelated(topic, "NASA officially ends Swift space telescope mission after failed rescue attempt")).toBe(false);
  });

  it("decodes HTML entities the model copies from web sources", async () => {
    const { toVariant } = await import("@/lib/content/draft");
    expect(toVariant({ text: "a -&gt; b &amp; c", selfReply: null, asset: null }).text).toBe("a -> b & c");
    expect(toVariant({ text: "a -&amp;gt; b", selfReply: null, asset: null }).text).toBe("a -> b");
  });
});

describe("images and links on every post", () => {
  it("adds the source link to the post when it fits, else to the first reply", async () => {
    const { withSourceLink } = await import("@/lib/content/pipeline");
    const url = "https://github.com/guregodevo/memdoor";
    expect(withSourceLink({ text: "short post" }, url, "post").text).toBe(`short post\n\n${url}`);
    const long = { text: "x".repeat(270) };
    expect(withSourceLink(long, url, "post")).toEqual({ ...long, selfReply: url });
    expect(withSourceLink({ text: "a" }, url, "reply").selfReply).toBe(url);
    expect(withSourceLink({ text: `a ${url}` }, url, "post").text).toBe(`a ${url}`);
  });

  it("turns a post without an asset into a headline card", async () => {
    const { fallbackAsset } = await import("@/lib/content/pipeline");
    const a = fallbackAsset("5 small models beat Fable 5 on LiveCodeBench Hard.\n\n- 27B each\n- runs locally\n\nensembles are back", "AI tooling", "https://www.example.com/x");
    expect(a).toMatchObject({ kind: "headline", kicker: "AI tooling", title: "5 small models beat Fable 5 on LiveCodeBench Hard.", points: ["27B each", "runs locally", "ensembles are back"], source: "example.com" });
  });

  it("rejects casual slang and fixes missing spaces after commas", async () => {
    const { toVariant } = await import("@/lib/content/draft");
    expect(toVariant({ text: "springboot,express and 1,000 users", selfReply: null, asset: null }).text).toBe("springboot, express and 1,000 users");
    const { runGates } = await import("@/lib/content/gates");
    const r = await runGates({ text: "this is crazy af" }, { sourcesText: "", voice: "", bannedPhrases: [] });
    expect(r.problems.join()).toContain("slang");
  });
});

describe("fitting to 280", () => {
  it("drops the last bullet, keeps the hook and the closing question", async () => {
    const { fitToLength } = await import("@/lib/content/pipeline");
    const { tweetLength } = await import("@/lib/content/length");
    const post = [
      "Millions of developer machines just auto-downloaded an SSH backdoor through an official IDE extension.",
      "",
      "→ Open VSX bundle trojanized",
      "→ Persistent access dropped on macOS, Linux, and Windows",
      "→ Patched silently without public incident disclosure",
      "",
      "How do you audit dependencies that update in the background?",
    ].join("\n");
    expect(tweetLength(post)).toBeGreaterThan(280);
    const fitted = fitToLength(post);
    expect(tweetLength(fitted)).toBeLessThanOrEqual(280);
    expect(fitted.startsWith("Millions of developer machines")).toBe(true);
    expect(fitted).toContain("How do you audit");
    expect(fitted).toContain("→ Open VSX bundle trojanized");
  });
});

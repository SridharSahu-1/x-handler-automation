import { describe, it, expect, afterEach, vi } from "vitest";
import { publisherMode, publish, unpublish, composeIntentUrl } from "@/lib/publisher";
import { bufferPostInput, tweetIdFromUrl, bufferMetrics } from "@/lib/publisher/buffer";
import { syndicationToken } from "@/lib/publisher/syndication";
import { fetchMetrics } from "@/lib/publisher";

const KEYS = ["PUBLISHER", "X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET", "BUFFER_API_KEY", "BUFFER_CHANNEL_ID", "DRY_RUN"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});
const clear = () => KEYS.forEach((k) => delete process.env[k]);

describe("publisher mode", () => {
  it("is manual with no keys, buffer with a Buffer key, xapi only with all 4 X keys", () => {
    clear();
    expect(publisherMode()).toBe("manual");
    process.env.BUFFER_API_KEY = "b";
    expect(publisherMode()).toBe("buffer");
    process.env.X_API_KEY = "k";
    process.env.X_ACCESS_TOKEN = "t";
    expect(publisherMode()).toBe("buffer"); // partial X keys don't count
    process.env.X_API_SECRET = "s";
    process.env.X_ACCESS_SECRET = "s";
    expect(publisherMode()).toBe("xapi");
    process.env.PUBLISHER = "manual";
    expect(publisherMode()).toBe("manual");
  });
});

describe("buffer helpers", () => {
  it("builds a shareNow post, with the self-reply as the 2nd thread item", () => {
    const plain = bufferPostInput("ch", { text: "hello" });
    expect(plain).toMatchObject({ channelId: "ch", text: "hello", mode: "shareNow", schedulingType: "automatic", assets: [] });
    expect(plain).not.toHaveProperty("metadata");
    const full = bufferPostInput("ch", { text: "hello", imageUrl: "https://blob/x.png", selfReply: "link: https://a.dev" });
    expect(full.assets).toEqual([{ image: { url: "https://blob/x.png" } }]);
    expect(full.metadata?.twitter.thread.map((t) => t.text)).toEqual(["hello", "link: https://a.dev"]);
    expect(full.metadata?.twitter.thread[0].assets).toEqual(full.assets); // first item must mirror the post
  });

  it("extracts tweet ids from x.com and twitter.com links", () => {
    expect(tweetIdFromUrl("https://x.com/someone/status/1850000000000000001?s=20")).toBe("1850000000000000001");
    expect(tweetIdFromUrl("https://twitter.com/a_b/status/123")).toBe("123");
    expect(tweetIdFromUrl("https://x.com/someone")).toBeNull();
    expect(tweetIdFromUrl(null)).toBeNull();
  });

  it("maps Buffer's normalized metrics", () => {
    const m = bufferMetrics([
      { type: "impressions", value: 1200 },
      { type: "reactions", value: 14 },
      { type: "comments", value: 3 },
      { type: "reposts", value: 2 },
      { type: "engagementRate", value: 1.6 },
    ]);
    expect(m).toEqual({ impressions: 1200, likes: 14, replies: 3, reposts: 2, quotes: 0, bookmarks: 0, profileClicks: 0 });
  });

  it("composer link pre-fills the text", () => {
    expect(composeIntentUrl("a & b")).toBe("https://x.com/intent/post?text=a%20%26%20b");
  });
});

describe("publish", () => {
  it("dry run never calls out, in any mode", async () => {
    clear();
    process.env.DRY_RUN = "1";
    process.env.BUFFER_API_KEY = "b";
    const f = vi.spyOn(globalThis, "fetch");
    const r = await publish({ text: "x" });
    expect(r.tweetId).toMatch(/^dry-/);
    expect(f).not.toHaveBeenCalled();
  });

  it("manual mode hands off without calling anything", async () => {
    clear();
    const f = vi.spyOn(globalThis, "fetch");
    const r = await publish({ text: "x" });
    expect(r).toMatchObject({ provider: "manual", handoff: true, tweetId: null });
    expect(f).not.toHaveBeenCalled();
    expect(await unpublish({ provider: "manual", tweetId: "1", replyTweetId: null, externalId: null })).toBe("manual");
  });

  it("buffer: creates with shareNow, polls until sent, returns the tweet id", async () => {
    clear();
    process.env.BUFFER_API_KEY = "key";
    process.env.BUFFER_CHANNEL_ID = "ch1";
    vi.useFakeTimers();
    const bodies: { query: string; variables: Record<string, unknown> }[] = [];
    let polls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer key");
      if (body.query.includes("createPost"))
        return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "bp1", status: "sending", externalLink: null, error: null } } } });
      polls++;
      const sent = polls >= 2;
      return Response.json({ data: { post: { id: "bp1", status: sent ? "sent" : "sending", externalLink: sent ? "https://x.com/me/status/999" : null, error: null } } });
    });
    const p = publish({ text: "hello", imageUrl: "https://blob/a.png" });
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r).toMatchObject({ provider: "buffer", tweetId: "999", externalId: "bp1", handoff: false });
    expect(bodies[0].variables.input).toMatchObject({ channelId: "ch1", mode: "shareNow" });
    expect(polls).toBe(2);
  });

  it("buffer: a rejected post throws (so the draft goes back to pending)", async () => {
    clear();
    process.env.BUFFER_API_KEY = "key";
    process.env.BUFFER_CHANNEL_ID = "ch1";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: { createPost: { __typename: "LimitReachedError", message: "queue full" } } }));
    await expect(publish({ text: "hello" })).rejects.toThrow(/queue full/);
  });

  it("buffer: a 429 says it's the rate limit", async () => {
    clear();
    process.env.BUFFER_API_KEY = "key";
    process.env.BUFFER_CHANNEL_ID = "ch1";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(publish({ text: "hello" })).rejects.toThrow(/rate limit/);
  });
});

describe("free metrics", () => {
  it("computes the embed token like X's own embed script", () => {
    expect(syndicationToken("20")).toMatch(/^[a-z0-9]+$/);
    expect(syndicationToken("2115623382721126826")).toBe(((2115623382721126826 / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ""));
  });

  it("manual: live likes/replies from the embed data once the link is known", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ __typename: "Tweet", favorite_count: 12, conversation_count: 3 }));
    expect(await fetchMetrics({ provider: "manual", tweetId: "123", externalId: null })).toMatchObject({ likes: 12, replies: 3, impressions: 0 });
    expect(await fetchMetrics({ provider: "manual", tweetId: null, externalId: null })).toBeNull();
  });

  it("buffer: impressions from Buffer, freshest likes/replies from either source", async () => {
    clear();
    process.env.BUFFER_API_KEY = "key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("syndication")) return Response.json({ __typename: "Tweet", favorite_count: 20, conversation_count: 1 });
      return Response.json({ data: { post: { id: "bp", status: "sent", externalLink: null, error: null, metrics: [{ type: "impressions", value: 900 }, { type: "reactions", value: 15 }, { type: "comments", value: 4 }, { type: "reposts", value: 2 }] } } });
    });
    expect(await fetchMetrics({ provider: "buffer", tweetId: "123", externalId: "bp" })).toMatchObject({ impressions: 900, likes: 20, replies: 4, reposts: 2 });
  });

  it("returns null (not zeros) when neither source answers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await fetchMetrics({ provider: "manual", tweetId: "123", externalId: null })).toBeNull();
  });
});

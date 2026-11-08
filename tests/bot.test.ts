import { describe, it, expect, beforeAll, vi } from "vitest";

// Workflows can't start outside the runtime in unit tests.
vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({ runId: "wrun_test" })), resumeHook: vi.fn() }));
vi.mock("@/workflows/daily-post", () => ({ dailyPost: () => {} }));
vi.mock("@/workflows/replies", () => ({ replySuggestions: () => {} }));

const OWNER = 4242;
const sent: { method: string; payload: Record<string, unknown> }[] = [];

async function setup() {
  process.env.DATABASE_URL = "pglite:"; // in-memory
  process.env.TELEGRAM_BOT_TOKEN = "1:test";
  process.env.TELEGRAM_CHAT_ID = String(OWNER);
  process.env.LLM_MOCK = "1";
  process.env.DRY_RUN = "1";
  const { db } = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db() as never, { migrationsFolder: "./drizzle" });
  const { getBot } = await import("@/lib/telegram/bot");
  const bot = getBot();
  bot.botInfo = { id: 1, is_bot: true, first_name: "t", username: "t_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as never;
  const record: Parameters<typeof bot.api.config.use>[0] = async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: sent.length, chat: { id: OWNER }, date: 0 } } as never;
  };
  bot.api.config.use(record);
  const { tg } = await import("@/lib/telegram/send");
  tg().config.use(record);
  return bot;
}

let bot: Awaited<ReturnType<typeof setup>>;
let uid = 1;
const msg = (text: string, chatId = OWNER) => ({
  update_id: uid++,
  message: {
    message_id: uid,
    date: 0,
    chat: { id: chatId, type: "private" as const, first_name: "me" },
    from: { id: chatId, is_bot: false, first_name: "me" },
    text,
    ...(text.startsWith("/") ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] } : {}),
  },
});
const lastText = () => String(sent.at(-1)?.payload.text ?? sent.at(-1)?.payload.caption ?? "");

describe("telegram bot", () => {
  beforeAll(async () => {
    bot = await setup();
  }, 60_000);

  it("ignores strangers completely", async () => {
    const before = sent.length;
    await bot.handleUpdate(msg("/status", 999));
    await bot.handleUpdate(msg("/pause", 999));
    await bot.handleUpdate(msg("/login", 999));
    expect(sent.length).toBe(before);
    const { getSettings } = await import("@/lib/settings");
    expect((await getSettings()).paused).toBe(false);
  });

  it("gives only the owner a short-lived dashboard login link", async () => {
    process.env.APP_URL = "https://dashboard.example.com";
    process.env.SESSION_SECRET = "test-secret-for-bot-login";
    await bot.handleUpdate(msg("/login"));
    const markup = sent.at(-1)?.payload.reply_markup as { inline_keyboard: { url: string }[][] };
    const url = new URL(markup.inline_keyboard[0][0].url);
    expect(url.origin).toBe("https://dashboard.example.com");
    const { verifyTelegramLoginToken } = await import("@/lib/auth");
    expect(await verifyTelegramLoginToken(url.searchParams.get("token")!)).toBe(String(OWNER));
  });

  it("runs the onboarding interview and saves answers", async () => {
    await bot.handleUpdate(msg("/start"));
    expect(lastText()).toContain("1/12");
    await bot.handleUpdate(msg("I build Next.js apps and Postgres stuff at a startup"));
    expect(lastText()).toContain("2/12");
    for (let i = 2; i <= 12; i++) await bot.handleUpdate(msg(i === 5 ? "/skip" : `answer ${i}`));
    expect(sent.some((s) => String(s.payload.text ?? "").includes("Your style card"))).toBe(true);
    const { interviewAnswers } = await import("@/lib/actions/onboarding");
    expect((await interviewAnswers()).length).toBe(11); // one skipped
    await bot.handleUpdate(msg("- lowercase\n- no emojis"));
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings();
    expect(s.onboarded).toBe(true);
    expect(s.styleCard).toContain("lowercase");
  });

  it("pause / resume flips the kill switch", async () => {
    const { getSettings } = await import("@/lib/settings");
    await bot.handleUpdate(msg("/pause"));
    expect((await getSettings()).paused).toBe(true);
    await bot.handleUpdate(msg("/status"));
    expect(lastText()).toContain("PAUSED");
    await bot.handleUpdate(msg("/resume"));
    expect((await getSettings()).paused).toBe(false);
  });

  it("validates /slot and /topics", async () => {
    await bot.handleUpdate(msg("/slot 25:99"));
    expect(lastText()).toContain("Usage");
    await bot.handleUpdate(msg("/slot 20:15"));
    await bot.handleUpdate(msg("/topics Rust; Postgres; career"));
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings();
    expect(s.slotTime).toBe("20:15");
    expect(s.pillars).toEqual(["Rust", "Postgres", "career"]);
  });

  it("edit mode stores your version and learns from it", async () => {
    const { db, schema } = await import("@/lib/db");
    const [d] = await db()
      .insert(schema.drafts)
      .values({ status: "pending", pillar: "Rust", format: "take", variants: [{ text: "original draft text" }] })
      .returning();
    await bot.handleUpdate({
      update_id: uid++,
      callback_query: { id: "cb1", chat_instance: "x", from: { id: OWNER, is_bot: false, first_name: "me" }, data: `ed:${d.id}`, message: { message_id: 1, date: 0, chat: { id: OWNER, type: "private", first_name: "me" } } },
    } as never);
    await bot.handleUpdate(msg("x".repeat(300)));
    expect(lastText()).toContain("over 280");
    await bot.handleUpdate(msg("my own better version"));
    const { getDraft } = await import("@/lib/actions/drafts");
    expect((await getDraft(d.id))?.editedText).toBe("my own better version");
    const edits = await db().select().from(schema.voiceSamples);
    expect(edits.some((e) => e.kind === "edit" && e.prompt === "original draft text")).toBe(true);
  });

  it("approving a draft with no workflow posts it directly (dry run) exactly once", async () => {
    const { db, schema } = await import("@/lib/db");
    const [d] = await db().insert(schema.drafts).values({ status: "pending", variants: [{ text: "ship it" }] }).returning();
    const cb = (data: string) => ({
      update_id: uid++,
      callback_query: { id: `cb${uid}`, chat_instance: "x", from: { id: OWNER, is_bot: false, first_name: "me" }, data, message: { message_id: 1, date: 0, chat: { id: OWNER, type: "private", first_name: "me" } } },
    });
    await bot.handleUpdate(cb(`ap:${d.id}`) as never);
    await bot.handleUpdate(cb(`ap:${d.id}`) as never);
    const posts = await db().select().from(schema.posts);
    expect(posts.filter((p) => p.draftId === d.id).length).toBe(1);
    const answers = sent.filter((s) => s.method === "answerCallbackQuery").map((s) => s.payload.text);
    expect(answers).toContain("Posted.");
    expect(answers.at(-1)).toContain("already posted");
  });

  const cbq = (data: string) => ({
    update_id: uid++,
    callback_query: { id: `cb${uid}`, chat_instance: "x", from: { id: OWNER, is_bot: false, first_name: "me" }, data, message: { message_id: 1, date: 0, chat: { id: OWNER, type: "private", first_name: "me" } } },
  });

  it("allows an expired draft with a stale hook to post exactly once", async () => {
    const { db, schema } = await import("@/lib/db");
    const { resumeHook } = await import("workflow/api");
    const { getDraft } = await import("@/lib/actions/drafts");
    const before = vi.mocked(resumeHook).mock.calls.length;
    const [d] = await db().insert(schema.drafts).values({ status: "expired", hookToken: "old-hook", scheduledFor: new Date(0), variants: [{ text: "missed yesterday, still worth posting" }] }).returning();
    await bot.handleUpdate(cbq(`pn:${d.id}`) as never);
    await bot.handleUpdate(cbq(`pn:${d.id}`) as never);
    expect((await getDraft(d.id))?.status).toBe("posted");
    expect((await db().select().from(schema.posts)).filter((p) => p.draftId === d.id)).toHaveLength(1);
    expect(vi.mocked(resumeHook).mock.calls).toHaveLength(before);
  });

  it("delivers text and the image when an expired draft is approved in manual mode", async () => {
    const { db, schema } = await import("@/lib/db");
    const dryRun = process.env.DRY_RUN;
    const publisher = process.env.PUBLISHER;
    process.env.DRY_RUN = "0";
    process.env.PUBLISHER = "manual";
    try {
      const [d] = await db().insert(schema.drafts).values({ status: "expired", variants: [{ text: "late manual post", assetUrl: "https://example.com/late.png" }] }).returning();
      const before = sent.length;
      await bot.handleUpdate(cbq(`pn:${d.id}`) as never);
      const out = sent.slice(before);
      expect(out.some((s) => s.method === "sendDocument")).toBe(true);
      expect(out.some((s) => String(s.payload.text).includes("late manual post") && JSON.stringify(s.payload.reply_markup).includes("intent/post"))).toBe(true);
    } finally {
      process.env.DRY_RUN = dryRun;
      if (publisher === undefined) delete process.env.PUBLISHER;
      else process.env.PUBLISHER = publisher;
      const { setBotState } = await import("@/lib/actions/onboarding");
      await setBotState(String(OWNER), "idle");
    }
  });

  it("keeps expired approvals subject to the pause switch", async () => {
    const { db, schema } = await import("@/lib/db");
    const { getDraft } = await import("@/lib/actions/drafts");
    const [d] = await db().insert(schema.drafts).values({ status: "expired", variants: [{ text: "wait until resumed" }] }).returning();
    await bot.handleUpdate(msg("/pause"));
    await bot.handleUpdate(cbq(`ap:${d.id}`) as never);
    expect((await getDraft(d.id))?.status).toBe("expired");
    expect(sent.at(-1)?.payload.text).toContain("paused");
    await bot.handleUpdate(msg("/resume"));
  });

  it("replaces the first variant's photo when a different variant is selected", async () => {
    const { db, schema } = await import("@/lib/db");
    const [d] = await db().insert(schema.drafts).values({ status: "expired", variants: [
      { text: "first", assetUrl: "https://example.com/first.png" },
      { text: "second", assetUrl: "https://example.com/second.png" },
      { text: "text only" },
    ] }).returning();
    const update = cbq(`pk:${d.id}:1`);
    Object.assign(update.callback_query.message, { photo: [{ file_id: "old-photo" }] });
    const before = sent.length;
    await bot.handleUpdate(update as never);
    const media = sent.slice(before).find((s) => s.method === "editMessageMedia");
    expect(media).toBeDefined();
    expect(media?.payload.media).toMatchObject({ type: "photo", caption: expect.stringContaining("second") });
    const input = (media?.payload.media as { media: { fileData: URL } }).media;
    expect(String(input.fileData)).toBe("https://example.com/second.png");
    const textUpdate = cbq(`pk:${d.id}:2`);
    Object.assign(textUpdate.callback_query.message, { photo: [{ file_id: "old-photo" }] });
    const textBefore = sent.length;
    await bot.handleUpdate(textUpdate as never);
    expect(sent.slice(textBefore).some((s) => s.method === "sendMessage" && String(s.payload.text).includes("text only"))).toBe(true);
    expect(sent.slice(textBefore).some((s) => s.method === "deleteMessage")).toBe(true);
  });

  function mockOembed() {
    const real = globalThis.fetch;
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).startsWith("https://publish.x.com/oembed"))
        return Response.json({ author_url: "https://x.com/somedev", html: '<blockquote><p lang="en">pnpm workspaces &amp; turbo are <a href="#">overkill</a> for 2 packages</p>&mdash; dev</blockquote>' });
      return real(url, init);
    });
  }

  it("a pasted post link turns into reply ideas with a pre-filled reply button", async () => {
    const spy = mockOembed();
    const before = sent.length;
    await bot.handleUpdate(msg("https://x.com/somedev/status/1850000000000000001?s=20"));
    spy.mockRestore();
    const out = sent.slice(before).filter((s) => s.method === "sendMessage");
    const ideas = out.filter((s) => String(s.payload.text).startsWith("→"));
    expect(ideas.length).toBe(2);
    const kb = JSON.stringify(ideas[0].payload.reply_markup);
    expect(kb).toContain("in_reply_to=1850000000000000001");
    const { db, schema } = await import("@/lib/db");
    const rows = await db().select().from(schema.replySuggestions);
    expect(rows.some((r) => r.handle === "somedev" && r.tweetText.includes("pnpm workspaces & turbo are overkill"))).toBe(true);
  });

  it("manual mode: after a handoff, your link attaches to the post (and someone else's can still get reply ideas)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { setBotState } = await import("@/lib/actions/onboarding");
    const [p] = await db().insert(schema.posts).values({ provider: "manual", text: "my post", pillar: "Rust", format: "take" }).returning();
    await setBotState(String(OWNER), "awaitlink", { postId: p.id });
    await bot.handleUpdate(msg("https://x.com/me/status/777"));
    expect(lastText()).toContain(`post #${p.id}`);
    expect(JSON.stringify(sent.at(-1)?.payload.reply_markup)).toContain(`ml:${p.id}:777`);
    await bot.handleUpdate(cbq(`ml:${p.id}:777`) as never);
    const [after] = await db().select().from(schema.posts).where((await import("drizzle-orm")).eq(schema.posts.id, p.id));
    expect(after.tweetId).toBe("777");
    const { getBotState } = await import("@/lib/actions/onboarding");
    expect((await getBotState(String(OWNER))).mode).toBe("idle");
  });

  it("a 1-tap rating records a score once and trains the bandit", async () => {
    const { db, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const [p] = await db().insert(schema.posts).values({ provider: "manual", tweetId: "778", text: "rated post", pillar: "Rust", format: "take" }).returning();
    await bot.handleUpdate(cbq(`rt:${p.id}:4`) as never);
    await bot.handleUpdate(cbq(`rt:${p.id}:1`) as never);
    const ms = await db().select().from(schema.metrics).where(eq(schema.metrics.postId, p.id));
    expect(ms.length).toBe(1);
    expect(ms[0].score).toBeGreaterThan(0.05);
    const { getSettings } = await import("@/lib/settings");
    expect((await getSettings()).bandit["Rust|take"]).toBeDefined();
    const answers = sent.filter((s) => s.method === "answerCallbackQuery").map((s) => String(s.payload.text));
    expect(answers.at(-1)).toContain("Already rated");
  });

  it("free mode: choosing a bio doesn't call X, it tells you where to paste it", async () => {
    const { db, schema } = await import("@/lib/db");
    const [c] = await db().insert(schema.profileChanges).values({ field: "bio", value: "TypeScript, Postgres, and whatever broke today" }).returning();
    const f = vi.spyOn(globalThis, "fetch");
    await bot.handleUpdate(cbq(`pa:${c.id}`) as never);
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
    expect(lastText()).toContain("x.com/settings/profile");
  });
});

import { config } from "dotenv";
config({ path: ".env.local" });
config();

/**
 * Phase-0 check of every external service with YOUR keys.
 *   pnpm smoke           read-only checks (safe)
 *   pnpm smoke --write   X API only: also posts + deletes a test tweet, uploads media, and re-saves your bio
 * Buffer has no --write check on purpose: it can't delete a tweet once it's out. Use /new with DRY_RUN=0 instead.
 */
const write = process.argv.includes("--write");
const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => Promise<string>) {
  try {
    results.push([name, true, await fn()]);
  } catch (e) {
    results.push([name, false, e instanceof Error ? e.message.slice(0, 200) : String(e)]);
  }
}

(async () => {
  delete process.env.LLM_MOCK;
  const { db, schema } = await import("../lib/db");
  const { languageModel } = await import("../lib/llm/providers");
  const { generateText } = await import("ai");
  const { tavily } = await import("../lib/research/tavily");
  const { exa } = await import("../lib/research/exa");
  const { serper } = await import("../lib/research/serper");
  const { readPage } = await import("../lib/research/reader");
  const { embedText } = await import("../lib/llm");

  await check("database", async () => `${(await db().select().from(schema.settings)).length} settings rows`);
  for (const p of ["gemini", "groq", "openrouter"] as const) {
    await check(`llm:${p}`, async () => {
      const m = languageModel(p);
      if (!m) return "skipped (no key)";
      const r = await generateText({ model: m, prompt: "Reply with exactly: ok" });
      return r.text.trim().slice(0, 40);
    });
  }
  await check("embeddings", async () => `${(await embedText("hello"))?.length ?? "none"} dims`);
  for (const [n, p] of Object.entries({ tavily, exa, serper })) {
    await check(`search:${n}`, async () => (p ? `${(await p("typescript release", { days: 7, max: 2 })).length} results` : "skipped (no key)"));
  }
  await check("jina reader", async () => `${(await readPage("https://example.com", 200)).length} chars`);

  await check("telegram", async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN) return "skipped (no token)";
    const { Api } = await import("grammy");
    const api = new Api(process.env.TELEGRAM_BOT_TOKEN);
    const me = await api.getMe();
    if (process.env.TELEGRAM_CHAT_ID) await api.sendMessage(process.env.TELEGRAM_CHAT_ID, "✅ x-handler smoke test: Telegram works.");
    return `@${me.username}${process.env.TELEGRAM_CHAT_ID ? ", test message sent" : " (set TELEGRAM_CHAT_ID: message the bot, then open https://api.telegram.org/bot<TOKEN>/getUpdates)"}`;
  });

  const { publisherMode } = await import("../lib/publisher");
  await check("publisher", async () => {
    const mode = publisherMode();
    return { xapi: "X API (paid, fully automatic)", buffer: "Buffer (free, auto-posts)", manual: "manual (free: Telegram hands you each post, you tap Post)" }[mode];
  });

  await check("buffer", async () => {
    if (!process.env.BUFFER_API_KEY) return "skipped (no key)";
    const { bufferChannelId } = await import("../lib/publisher/buffer");
    return `X channel ${await bufferChannelId()}`;
  });

  await check("x:read post (oEmbed)", async () => {
    const { fetchTweet } = await import("../lib/actions/replies");
    const t = await fetchTweet("https://x.com/jack/status/20");
    if (!t) throw new Error("oEmbed returned nothing; pasted-link reply ideas won't work");
    return `"${t.text}" by @${t.handle}`;
  });

  await check("x:public metrics", async () => {
    const { publicCounts } = await import("../lib/publisher/syndication");
    const c = await publicCounts("20");
    if (!c) throw new Error("embed data unavailable; free modes fall back to Buffer numbers / your rating");
    return `${c.likes} likes, ${c.replies} replies on a test post`;
  });

  await check("x:auth", async () => {
    if (!process.env.X_ACCESS_TOKEN) return "skipped (no keys)";
    const { me } = await import("../lib/x/client");
    const u = await me();
    return `@${u.username} (${u.id})`;
  });

  if (write && process.env.X_ACCESS_TOKEN) {
    process.env.DRY_RUN = "0";
    const { x, uploadImage } = await import("../lib/x/client");
    const { renderAsset } = await import("../lib/assets/render");
    await check("x:media upload", async () => uploadImage(await renderAsset({ kind: "list", title: "smoke test", items: ["a", "b", "c"] })));
    await check("x:post+delete", async () => {
      const { data } = await x().v2.tweet({ text: `setup check ${Date.now().toString(36)}, deleting this in a second` });
      await x().v2.deleteTweet(data.id);
      return `posted + deleted ${data.id}`;
    });
    await check("x:profile update", async () => {
      const before = await x().v1.verifyCredentials();
      await x().v1.updateAccountProfile({ description: before.description ?? "" });
      return "bio endpoint works (re-saved your current bio unchanged)";
    });
  }

  for (const [n, ok, msg] of results) console.log(`${ok ? "✅" : "❌"} ${n.padEnd(16)} ${msg}`);
  process.exit(results.some(([, ok]) => !ok) ? 1 : 0);
})();

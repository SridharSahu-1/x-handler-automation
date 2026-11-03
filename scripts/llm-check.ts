import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Runs every structured LLM call the app makes against each provider on its own,
 * so a schema one provider rejects shows up here instead of in a failed draft.
 *   DATABASE_URL=pglite: pnpm tsx scripts/llm-check.ts [gemini|groq|openrouter]
 */
(async () => {
  delete process.env.LLM_MOCK;
  const { db } = await import("../lib/db");
  if (process.env.DATABASE_URL?.startsWith("pglite")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db() as never, { migrationsFolder: "./drizzle" });
  }
  const { setSetting } = await import("../lib/settings");
  const { languageModel } = await import("../lib/llm/providers");
  const { writeVariants, rewriteVariant } = await import("../lib/content/draft");
  const { critique, unsupportedClaims } = await import("../lib/content/gates");
  const { proposeProfile } = await import("../lib/actions/profile");
  const { suggestRepliesFor } = await import("../lib/actions/replies");
  const { collectTrends } = await import("../lib/trends");

  const only = process.argv[2];
  const sources = "Bun 2.0 released 2026-10-20. Adds a built-in Postgres client and 30% faster installs.";
  const voice = "- lowercase mostly\n- short sentences\n- TypeScript and Postgres dev";
  let failed = 0;
  for (const p of ["gemini", "groq", "openrouter"] as const) {
    if (only && p !== only) continue;
    if (!languageModel(p)) {
      console.log(`-- ${p}: no key, skipped`);
      continue;
    }
    await setSetting("llmOrder", [p]);
    const run = async (name: string, fn: () => Promise<string>) => {
      const t = Date.now();
      try {
        const out = await fn();
        console.log(`✅ ${p.padEnd(10)} ${name.padEnd(12)} ${((Date.now() - t) / 1000).toFixed(0)}s ${out}`);
      } catch (e) {
        failed++;
        console.log(`❌ ${p.padEnd(10)} ${name.padEnd(12)} ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      }
    };
    let first: Awaited<ReturnType<typeof writeVariants>>[number] | undefined;
    await run("draft", async () => {
      const vs = await writeVariants({ voice, pillar: "web & TypeScript", format: "take", topic: "Bun 2.0", sourcesText: sources, avoid: [] });
      first = vs[0];
      return `${vs.length} variants, assets: ${vs.map((v) => v.asset?.kind ?? "none").join(",")} | ${vs[0].text.slice(0, 70)}`;
    });
    await run("rewrite", async () => {
      const v = await rewriteVariant(first ?? { text: "bun 2.0 is out and it is a game-changer" }, ["uses banned phrase 'game-changer'"], { voice, sourcesText: sources, format: "take" });
      return v.text.slice(0, 80);
    });
    await run("critic", async () => JSON.stringify(await critique("bun 2.0 ships a postgres client. one less dependency in every side project")).slice(0, 120));
    await run("factcheck", async () => JSON.stringify(await unsupportedClaims("bun 2.0 made installs 90% faster", sources, voice)));
    await run("profile", async () => `${(await proposeProfile()).length} proposals`);
    await run("replies", async () => `${(await suggestRepliesFor("https://x.com/jack/status/20")).rows.length} replies`);
    await run("trends", async () => `${(await collectTrends(["AI/LLM tooling", "web & TypeScript"])).length} trends scored`);
  }
  process.exit(failed ? 1 : 0);
})();

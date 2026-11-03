import { describe, it, expect, beforeAll } from "vitest";

describe("writer context", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = "pglite:";
    const { db, schema } = await import("@/lib/db");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db() as never, { migrationsFolder: "./drizzle" });
    const { setSetting } = await import("@/lib/settings");
    const { INTERVIEW_QUESTIONS } = await import("@/lib/content/voice");
    await setSetting("styleCard", "- lowercase, drops apostrophes, says af");
    await db().insert(schema.voiceSamples).values([
      { kind: "sample", text: "this is crazy af ngl" },
      { kind: "interview", prompt: INTERVIEW_QUESTIONS[0], text: "I build AI agents with Node.js at a startup" },
      { kind: "interview", prompt: INTERVIEW_QUESTIONS[9], text: "lowercase, af, no emojis" },
      { kind: "interview", prompt: INTERVIEW_QUESTIONS[11], text: "nothing about my employer" },
    ]);
  }, 60_000);

  it("never passes the author's style card or writing samples to the writer", async () => {
    const { writerContext } = await import("@/lib/content/voice");
    for (const personal of [false, true]) {
      const ctx = await writerContext(personal);
      expect(ctx).not.toContain("lowercase");
      expect(ctx).not.toContain("crazy af");
      expect(ctx).toContain("nothing about my employer");
    }
  });

  it("includes work facts only for the occasional personal post", async () => {
    const { writerContext } = await import("@/lib/content/voice");
    expect(await writerContext(false)).not.toContain("AI agents");
    expect(await writerContext(true)).toContain("AI agents");
  });
});

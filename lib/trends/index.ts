import { z } from "zod";
import { desc, gte, isNull, and } from "drizzle-orm";
import { ALL_SOURCES, type RawTrend } from "./sources";
import { llmObject } from "../llm";
import { db, schema } from "../db";
import { log } from "../log";

/** Points normalised per source, decayed by age (HN-style gravity). */
export function heat(t: RawTrend, maxPointsForSource: number) {
  const norm = maxPointsForSource > 0 ? t.points / maxPointsForSource : 0;
  return norm / Math.pow(1 + t.ageHours / 12, 1.2);
}

export async function collectTrends(pillars: string[]) {
  const settled = await Promise.allSettled(Object.entries(ALL_SOURCES).map(async ([name, fn]) => {
    const r = await fn();
    return { name, r };
  }));
  const raw: RawTrend[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") raw.push(...s.value.r);
    else await log("trends", `source failed: ${s.reason}`, { level: "warn" });
  }
  const maxBySource = new Map<string, number>();
  for (const t of raw) maxBySource.set(t.source, Math.max(maxBySource.get(t.source) ?? 0, t.points));
  const ranked = raw
    .filter((t) => t.ageHours < 72)
    .map((t) => ({ ...t, heat: heat(t, maxBySource.get(t.source) ?? 1) }))
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 40);
  if (!ranked.length) return [];

  // One LLM call scores niche fit for all candidates.
  const { items } = await llmObject({
    schema: z.object({
      items: z.array(z.object({ i: z.number().int(), pillar: z.string(), fit: z.number().min(0).max(10) })),
    }),
    system: "You classify developer news for a software developer's X account.",
    prompt: `Pillars:\n${pillars.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nFor each item give the best matching pillar (exact text, or "none") and fit 0-10: how likely developers on X would care, save or argue about it. Favour substantive industry items: launches, releases, benchmarks, outages, security issues, funding/acquisitions of dev tools, and active debates. Penalise personal blog stories, jokey or clickbait titles, beginner listicles, politics, drama, non-dev topics, and paywalled fluff (fit 3 or less).\n\n${ranked
      .map((t, i) => `${i}. [${t.source}] ${t.title}${t.summary ? ` — ${t.summary.slice(0, 160)}` : ""}`)
      .join("\n")}`,
  });

  const rows = items
    .filter((x) => ranked[x.i] && x.pillar !== "none" && x.fit >= 5)
    .map((x) => {
      const t = ranked[x.i];
      return {
        source: t.source,
        title: t.title,
        url: t.url,
        summary: t.summary ?? null,
        pillar: x.pillar,
        score: Math.round((x.fit / 10) * 0.6 * 1000 + Math.min(t.heat, 1) * 0.4 * 1000) / 1000,
      };
    });
  if (rows.length) await db().insert(schema.trends).values(rows);
  await log("trends", `collected ${raw.length} raw, stored ${rows.length} relevant`);
  return rows;
}

export async function recentUnusedTrends(hours = 30) {
  return db()
    .select()
    .from(schema.trends)
    .where(and(gte(schema.trends.collectedAt, new Date(Date.now() - hours * 36e5)), isNull(schema.trends.usedAt)))
    .orderBy(desc(schema.trends.score))
    .limit(30);
}

import { desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";

export async function overviewData() {
  const since = new Date(Date.now() - 7 * 864e5);
  const [drafts, posts, ms, logs, cost] = await Promise.all([
    db().select().from(schema.drafts).orderBy(desc(schema.drafts.id)).limit(5),
    db().select().from(schema.posts).where(gte(schema.posts.postedAt, since)).orderBy(desc(schema.posts.id)),
    db().select().from(schema.metrics).where(gte(schema.metrics.fetchedAt, since)),
    db().select().from(schema.runLogs).where(inArray(schema.runLogs.level, ["warn", "error"])).orderBy(desc(schema.runLogs.id)).limit(6),
    db()
      .select({ total: sql<number>`coalesce(sum(${schema.runLogs.costUsd}), 0)` })
      .from(schema.runLogs)
      .where(gte(schema.runLogs.createdAt, new Date(Date.now() - 30 * 864e5))),
  ]);
  return { drafts, posts, metrics: latestMetrics(ms), logs, cost30d: Number(cost[0]?.total ?? 0) };
}

/** Keeps only the newest checkpoint per post. */
export function latestMetrics<T extends { postId: number; fetchedAt: Date }>(rows: T[]) {
  const m = new Map<number, T>();
  for (const r of rows) if (!m.has(r.postId) || m.get(r.postId)!.fetchedAt < r.fetchedAt) m.set(r.postId, r);
  return m;
}

export async function draftsList(limit = 30) {
  return db().select().from(schema.drafts).orderBy(desc(schema.drafts.id)).limit(limit);
}

export async function postsWithMetrics(limit = 100) {
  const posts = await db().select().from(schema.posts).orderBy(desc(schema.posts.id)).limit(limit);
  const ms = posts.length ? await db().select().from(schema.metrics).where(inArray(schema.metrics.postId, posts.map((p) => p.id))) : [];
  return posts.map((p) => ({ ...p, metrics: ms.filter((m) => m.postId === p.id) }));
}

export async function logsList(limit = 200) {
  return db().select().from(schema.runLogs).orderBy(desc(schema.runLogs.id)).limit(limit);
}

export async function dailyCost(days = 30) {
  return db()
    .select({
      day: sql<string>`to_char(${schema.runLogs.createdAt}, 'YYYY-MM-DD')`,
      cost: sql<number>`sum(${schema.runLogs.costUsd})`,
    })
    .from(schema.runLogs)
    .where(gte(schema.runLogs.createdAt, new Date(Date.now() - days * 864e5)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

export async function voiceData() {
  return db().select().from(schema.voiceSamples).orderBy(desc(schema.voiceSamples.id)).limit(200);
}

export async function trendsList() {
  return db().select().from(schema.trends).where(gte(schema.trends.collectedAt, new Date(Date.now() - 48 * 36e5))).orderBy(desc(schema.trends.score)).limit(60);
}

export async function repliesData() {
  const [targets, suggestions] = await Promise.all([
    db().select().from(schema.replyTargets).orderBy(schema.replyTargets.handle),
    db().select().from(schema.replySuggestions).orderBy(desc(schema.replySuggestions.id)).limit(40),
  ]);
  return { targets, suggestions };
}

export async function draftById(id: number) {
  const [d] = await db().select().from(schema.drafts).where(eq(schema.drafts.id, id));
  return d ?? null;
}

import { and, gte, isNotNull } from "drizzle-orm";
import { db, schema } from "../db";
import { embedText, cosine } from "../llm";

export async function recentPostEmbeddings(days = 60) {
  return db()
    .select({ text: schema.posts.text, embedding: schema.posts.embedding })
    .from(schema.posts)
    .where(and(gte(schema.posts.postedAt, new Date(Date.now() - days * 864e5)), isNotNull(schema.posts.embedding)));
}

/** Highest cosine similarity of `text` vs recent posts (0 if no embeddings available). */
export async function maxSimilarity(text: string, recent: { text: string; embedding: number[] | null }[]) {
  const e = await embedText(text);
  if (!e) return { similarity: 0, embedding: null as number[] | null };
  let best = 0;
  for (const r of recent) if (r.embedding) best = Math.max(best, cosine(e, r.embedding));
  return { similarity: best, embedding: e };
}

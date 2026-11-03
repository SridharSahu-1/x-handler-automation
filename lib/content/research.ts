import { webSearch } from "../research/search";
import { readPage } from "../research/reader";
import type { SourceRef } from "../db/schema";
import { log } from "../log";

export type SourcePack = (SourceRef & { body?: string })[];

const STOP = new Set("the and for with that this from your what when have will just about into than then them they their more most over also only some like after before here there were been being does dont cant its it's how why who you are was not but all new now one can our out use using".split(" "));
const keywords = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? []);

/** A search hit counts only if it shares at least 2 meaningful words with the topic (clickbait titles pull in unrelated news). */
export function isRelated(topic: string, text: string) {
  const want = keywords(topic);
  let shared = 0;
  for (const w of keywords(text)) if (want.has(w) && ++shared >= 2) return true;
  return false;
}

/**
 * Builds the source pack: the trend itself first (with the most room), then fresh search
 * context about the same subject, each read in full. Order matters: later sources get trimmed.
 */
export async function buildSourcePack(topic: { title: string; url?: string | null }): Promise<SourcePack> {
  const urls = new Map<string, string>();
  if (topic.url) urls.set(topic.url, topic.title);
  const results = await webSearch(topic.title, { days: 7, max: 5 });
  for (const r of results) {
    if (urls.size >= 3 || urls.has(r.url)) continue;
    if (isRelated(topic.title, `${r.title} ${r.content ?? ""}`)) urls.set(r.url, r.title);
  }

  const entries = [...urls.entries()];
  const bodies = await Promise.all(
    entries.map(async ([url, title], i) => {
      let body: string | undefined;
      try {
        body = await readPage(url, 5000);
      } catch (e) {
        await log("research", `reader failed for ${url}: ${e instanceof Error ? e.message : e}`, { level: "warn" });
        body = results.find((r) => r.url === url)?.content;
      }
      // The main article gets ~1k tokens, supporting sources less: free LLM tiers have small per-minute budgets.
      return body ? { title, url, body: body.slice(0, i === 0 ? 4000 : 1800), excerpt: body.slice(0, 280) } : null;
    }),
  );
  return bodies.filter((b) => b !== null);
}

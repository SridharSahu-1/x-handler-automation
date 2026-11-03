import { tool } from "ai";
import { z } from "zod";
import { tavily } from "./tavily";
import { exa } from "./exa";
import { serper } from "./serper";
import type { SearchProvider, SearchResult } from "./types";
import { getSetting } from "../settings";
import { log } from "../log";

const PROVIDERS: Record<string, SearchProvider | null> = { tavily, exa, serper };

/** Web search through the configured provider chain (Tavily -> Exa -> Serper by default). */
export async function webSearch(query: string, opts: { days?: number; max?: number } = {}): Promise<SearchResult[]> {
  const order = await getSetting("searchOrder").catch(() => ["tavily", "exa", "serper"]);
  for (const name of order) {
    const p = PROVIDERS[name];
    if (!p) continue;
    try {
      const results = await p(query, opts);
      if (results.length) return results;
    } catch (e) {
      await log("search", `${name} failed: ${e instanceof Error ? e.message : e}`, { level: "warn" });
    }
  }
  return [];
}

export function hasSearchProvider() {
  return Object.values(PROVIDERS).some(Boolean);
}

/** AI SDK tool so the writer model can search the web itself. */
export const searchTool = tool({
  description:
    "Search the web for recent information. Use for facts, release details, versions, and what people are saying about a topic.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    days: z.number().int().min(1).max(30).optional().describe("Only results from the last N days"),
  }),
  execute: async ({ query, days }) => {
    const results = await webSearch(query, { days, max: 5 });
    return results.map((r) => ({ title: r.title, url: r.url, content: r.content.slice(0, 1200) }));
  },
});

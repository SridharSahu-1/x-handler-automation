import { optionalEnv } from "../env";
import type { SearchProvider } from "./types";

export const tavily: SearchProvider | null = optionalEnv("TAVILY_API_KEY")
  ? async (query, { days = 7, max = 6 }) => {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        },
        body: JSON.stringify({ query, topic: "news", days, max_results: max, search_depth: "basic" }),
      });
      if (!res.ok) throw new Error(`tavily ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        results: { title: string; url: string; content: string; published_date?: string }[];
      };
      return json.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        publishedAt: r.published_date,
      }));
    }
  : null;

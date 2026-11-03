import { optionalEnv } from "../env";
import type { SearchProvider } from "./types";

export const serper: SearchProvider | null = optionalEnv("SERPER_API_KEY")
  ? async (query, { days = 7, max = 6 }) => {
      const tbs = days <= 1 ? "qdr:d" : days <= 7 ? "qdr:w" : "qdr:m";
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.SERPER_API_KEY! },
        body: JSON.stringify({ q: query, num: max, tbs }),
      });
      if (!res.ok) throw new Error(`serper ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { organic?: { title: string; link: string; snippet: string; date?: string }[] };
      return (json.organic ?? []).map((r) => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
        publishedAt: r.date,
      }));
    }
  : null;

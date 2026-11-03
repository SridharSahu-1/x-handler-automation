import { optionalEnv } from "../env";
import type { SearchProvider } from "./types";

export const exa: SearchProvider | null = optionalEnv("EXA_API_KEY")
  ? async (query, { days = 7, max = 6 }) => {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.EXA_API_KEY! },
        body: JSON.stringify({
          query,
          numResults: max,
          startPublishedDate: new Date(Date.now() - days * 864e5).toISOString(),
          contents: { text: { maxCharacters: 1500 } },
        }),
      });
      if (!res.ok) throw new Error(`exa ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        results: { title: string; url: string; text?: string; publishedDate?: string }[];
      };
      return json.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.text ?? "",
        publishedAt: r.publishedDate,
      }));
    }
  : null;

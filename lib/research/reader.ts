import { optionalEnv } from "../env";

/** Fetches a URL as clean markdown via Jina Reader (free; key only raises limits). */
export async function readPage(url: string, maxChars = 8000): Promise<string> {
  const headers: Record<string, string> = { "x-return-format": "markdown" };
  const key = optionalEnv("JINA_API_KEY");
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`reader ${res.status} for ${url}`);
  const text = await res.text();
  return text.slice(0, maxChars);
}

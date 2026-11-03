export type RawTrend = { source: string; title: string; url: string; summary?: string; points: number; ageHours: number };

const UA = { "user-agent": "x-handler/0.1 (personal dev account assistant)" };
const hoursSince = (d: Date | number | string) => (Date.now() - new Date(d).getTime()) / 36e5;

export async function hackerNews(): Promise<RawTrend[]> {
  const res = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40", { headers: UA });
  const json = (await res.json()) as {
    hits: { title: string; url?: string; objectID: string; points: number; created_at: string }[];
  };
  return json.hits.map((h) => ({
    source: "hn",
    title: h.title,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    points: h.points,
    ageHours: hoursSince(h.created_at),
  }));
}

export async function githubTrending(): Promise<RawTrend[]> {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const headers: Record<string, string> = { ...UA, accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(
    `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=25`,
    { headers },
  );
  const json = (await res.json()) as {
    items?: { full_name: string; html_url: string; description: string | null; stargazers_count: number; created_at: string; language: string | null }[];
  };
  return (json.items ?? []).map((r) => ({
    source: "github",
    title: `${r.full_name}${r.language ? ` (${r.language})` : ""}`,
    url: r.html_url,
    summary: r.description ?? undefined,
    points: r.stargazers_count,
    ageHours: hoursSince(r.created_at),
  }));
}

export async function reddit(): Promise<RawTrend[]> {
  const subs = ["programming", "webdev", "LocalLLaMA", "javascript", "ExperiencedDevs"];
  const out: RawTrend[] = [];
  for (const s of subs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${s}/top.json?t=day&limit=8`, { headers: UA });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data: { children: { data: { title: string; permalink: string; url: string; ups: number; created_utc: number; selftext?: string } }[] };
      };
      for (const c of json.data.children) {
        out.push({
          source: `reddit/${s}`,
          title: c.data.title,
          url: c.data.url.startsWith("https://www.reddit.com") ? c.data.url : `https://www.reddit.com${c.data.permalink}`,
          summary: c.data.selftext?.slice(0, 300),
          points: c.data.ups,
          ageHours: hoursSince(c.data.created_utc * 1000),
        });
      }
    } catch {
      // Reddit often blocks cloud IPs; it's a bonus source.
    }
  }
  return out;
}

export async function devto(): Promise<RawTrend[]> {
  const res = await fetch("https://dev.to/api/articles?top=1&per_page=20", { headers: UA });
  const json = (await res.json()) as {
    title: string; url: string; description: string; public_reactions_count: number; published_at: string;
  }[];
  return json.map((a) => ({
    source: "devto",
    title: a.title,
    url: a.url,
    summary: a.description,
    points: a.public_reactions_count,
    ageHours: hoursSince(a.published_at),
  }));
}

export async function lobsters(): Promise<RawTrend[]> {
  const res = await fetch("https://lobste.rs/hottest.json", { headers: UA });
  const json = (await res.json()) as { title: string; url: string; short_id_url: string; score: number; created_at: string; tags: string[] }[];
  return json.slice(0, 25).map((s) => ({
    source: "lobsters",
    title: `${s.title} [${s.tags.join(", ")}]`,
    url: s.url || s.short_id_url,
    points: s.score * 5, // lobsters scores run much lower than HN
    ageHours: hoursSince(s.created_at),
  }));
}

export const ALL_SOURCES = { hackerNews, githubTrending, reddit, devto, lobsters };

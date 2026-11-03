/**
 * X's public embed data (the same JSON that powers embedded posts on websites): no key, no login,
 * read-only. It exposes likes and replies for any public post, which is enough for early signals.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** The token embeds compute client-side from the post id. */
export function syndicationToken(id: string) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export async function publicCounts(tweetId: string): Promise<{ likes: number; replies: number } | null> {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${syndicationToken(tweetId)}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => null)) as { __typename?: string; favorite_count?: number; conversation_count?: number } | null;
  if (!d || d.__typename !== "Tweet") return null;
  return { likes: d.favorite_count ?? 0, replies: d.conversation_count ?? 0 };
}

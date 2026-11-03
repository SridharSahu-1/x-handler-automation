import { env, optionalEnv } from "../env";

/**
 * Buffer's GraphQL API (free plan: 1 key, ~1,000 requests per channel per 30 days).
 * Buffer holds the X connection, so posting costs us nothing. Media must be a public, stable URL.
 */
const API = "https://api.buffer.com";

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

export async function bufferGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("BUFFER_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) throw new Error("Buffer rate limit reached (free plan: ~1,000 requests/channel/30 days)");
  const json = (await res.json().catch(() => ({}))) as GqlResponse<T>;
  if (!res.ok || json.errors?.length || !json.data) {
    throw new Error(`Buffer API ${res.status}: ${json.errors?.map((e) => e.message).join("; ") || res.statusText}`);
  }
  return json.data;
}

export type BufferPost = {
  id: string;
  status: "draft" | "error" | "needs_approval" | "scheduled" | "sending" | "sent";
  externalLink: string | null;
  error: { message: string } | null;
  metrics?: { type: string; value: number }[] | null;
  metricsUpdatedAt?: string | null;
};

const POST_FIELDS = "id status externalLink error { message }";

let _channel: string | null = null;
/** Your connected X channel: BUFFER_CHANNEL_ID, or the first connected twitter channel on the account. */
export async function bufferChannelId(): Promise<string> {
  if (_channel) return _channel;
  const fixed = optionalEnv("BUFFER_CHANNEL_ID");
  if (fixed) return (_channel = fixed);
  const { account } = await bufferGql<{ account: { organizations: { id: string }[] } }>("{ account { organizations { id } } }");
  for (const org of account.organizations) {
    const { channels } = await bufferGql<{ channels: { id: string; service: string; isDisconnected: boolean }[] }>(
      "query($org: OrganizationId!) { channels(input: { organizationId: $org }) { id service isDisconnected } }",
      { org: org.id },
    );
    const ch = channels.find((c) => c.service === "twitter" && !c.isDisconnected);
    if (ch) return (_channel = ch.id);
  }
  throw new Error("No connected X channel in Buffer. Connect your X account at buffer.com first.");
}

/** Builds the createPost input. The self-reply goes out as the second item of a thread. */
export function bufferPostInput(channelId: string, p: { text: string; imageUrl?: string | null; selfReply?: string | null }) {
  const assets = p.imageUrl ? [{ image: { url: p.imageUrl } }] : [];
  return {
    channelId,
    text: p.text,
    schedulingType: "automatic",
    mode: "shareNow",
    assets,
    ...(p.selfReply
      ? { metadata: { twitter: { thread: [{ text: p.text, assets }, { text: p.selfReply, assets: [] }] } } }
      : {}),
  };
}

export async function bufferCreatePost(p: { text: string; imageUrl?: string | null; selfReply?: string | null }): Promise<BufferPost> {
  const input = bufferPostInput(await bufferChannelId(), p);
  const { createPost } = await bufferGql<{ createPost: { __typename: string; post?: BufferPost; message?: string } }>(
    `mutation($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { ${POST_FIELDS} } } ... on MutationError { message } } }`,
    { input },
  );
  if (!createPost.post) throw new Error(`Buffer rejected the post (${createPost.__typename}): ${createPost.message ?? "unknown error"}`);
  return createPost.post;
}

export async function bufferGetPost(id: string, withMetrics = false): Promise<BufferPost> {
  const { post } = await bufferGql<{ post: BufferPost }>(
    `query($id: PostId!) { post(input: { id: $id }) { ${POST_FIELDS}${withMetrics ? " metrics { type value } metricsUpdatedAt" : ""} } }`,
    { id },
  );
  return post;
}

export async function bufferDeletePost(id: string) {
  const { deletePost } = await bufferGql<{ deletePost: { __typename: string; message?: string } }>(
    "mutation($id: PostId!) { deletePost(input: { id: $id }) { __typename ... on MutationError { message } } }",
    { id },
  );
  if (deletePost.__typename !== "DeletePostSuccess") throw new Error(deletePost.message ?? deletePost.__typename);
}

/** Pulls the tweet id out of the published post's link (x.com/<user>/status/<id>). */
export function tweetIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/)?.[1] ?? null;
}

/** Buffer's normalized metrics → our metric row. Bookmarks and profile clicks aren't exposed. */
export function bufferMetrics(list: { type: string; value: number }[]) {
  const get = (t: string) => Math.round(list.find((m) => m.type === t)?.value ?? 0);
  return {
    impressions: get("impressions") || get("views") || get("reach"),
    likes: get("reactions") || get("likes"),
    replies: get("comments"),
    reposts: get("reposts"),
    quotes: get("quotes"),
    bookmarks: get("saves"),
    profileClicks: 0,
  };
}

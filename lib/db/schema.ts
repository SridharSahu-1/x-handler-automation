import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export type SourceRef = { title: string; url: string; excerpt?: string; body?: string };
export type Variant = {
  text: string;
  selfReply?: string;
  asset?: AssetSpec | null;
  assetUrl?: string | null;
  scores?: GateScores;
  problems?: string[];
};
export type AssetSpec =
  | { kind: "code"; language: string; code: string; title?: string }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "compare"; title: string; left: string; right: string; rows: [string, string, string][] }
  | { kind: "headline"; kicker: string; title: string; points: string[]; source?: string };
export type GateScores = {
  human: number;
  specificity: number;
  value: number;
  reportRisk: number;
  originality?: number;
  /** 0-10: how much the post is about the author's own life/habits rather than the topic. */
  personal?: number;
  notes?: string;
};

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const trends = pgTable(
  "trends",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    summary: text("summary"),
    score: real("score").default(0).notNull(),
    pillar: text("pillar"),
    usedAt: timestamp("used_at"),
    collectedAt: timestamp("collected_at").defaultNow().notNull(),
  },
  (t) => [index("trends_collected_idx").on(t.collectedAt)],
);

export const drafts = pgTable("drafts", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("generating"),
  // Whether this draft may draw on the author's own work experience (see settings.personalShare).
  personal: boolean("personal").notNull().default(false),
  // generating | pending | approved | skipped | posted | failed | expired
  kind: text("kind").notNull().default("daily"), // daily | intro | manual
  pillar: text("pillar"),
  format: text("format"),
  topic: text("topic"),
  trendId: integer("trend_id"),
  variants: jsonb("variants").$type<Variant[]>().notNull().default([]),
  chosen: integer("chosen").default(0).notNull(),
  editedText: text("edited_text"),
  sources: jsonb("sources").$type<SourceRef[]>().notNull().default([]),
  assetUrl: text("asset_url"),
  scheduledFor: timestamp("scheduled_for"),
  runId: text("run_id"),
  hookToken: text("hook_token"),
  telegramMessageId: integer("telegram_message_id"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  draftId: integer("draft_id"),
  provider: text("provider").notNull().default("xapi"), // xapi | buffer | manual
  tweetId: text("tweet_id"), // null until known (buffer still sending, or manual and you haven't sent the link)
  replyTweetId: text("reply_tweet_id"),
  externalId: text("external_id"), // Buffer post id
  text: text("text").notNull(),
  pillar: text("pillar"),
  format: text("format"),
  hasMedia: boolean("has_media").default(false).notNull(),
  embedding: jsonb("embedding").$type<number[]>(),
  deleted: boolean("deleted").default(false).notNull(),
  postedAt: timestamp("posted_at").defaultNow().notNull(),
});

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  checkpoint: text("checkpoint").notNull(), // 1h | 6h | 24h | 72h | rating
  impressions: integer("impressions").default(0).notNull(),
  likes: integer("likes").default(0).notNull(),
  replies: integer("replies").default(0).notNull(),
  reposts: integer("reposts").default(0).notNull(),
  quotes: integer("quotes").default(0).notNull(),
  bookmarks: integer("bookmarks").default(0).notNull(),
  profileClicks: integer("profile_clicks").default(0).notNull(),
  score: real("score").default(0).notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

// Voice: interview answers, imported writing, and (draft -> your edit) pairs.
export const voiceSamples = pgTable("voice_samples", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // interview | sample | edit
  prompt: text("prompt"), // interview question, or original draft for edits
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  draftId: integer("draft_id"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const profileChanges = pgTable("profile_changes", {
  id: serial("id").primaryKey(),
  field: text("field").notNull(), // bio | name | avatar | banner | location | url
  value: text("value").notNull(),
  status: text("status").notNull().default("proposed"), // proposed | applied | rejected
  createdAt: timestamp("created_at").defaultNow().notNull(),
  appliedAt: timestamp("applied_at"),
});

export const replyTargets = pgTable("reply_targets", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  userId: text("user_id"),
  pillar: text("pillar"),
  active: boolean("active").default(true).notNull(),
});

export const replySuggestions = pgTable("reply_suggestions", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull(),
  tweetId: text("tweet_id").notNull(),
  tweetText: text("tweet_text").notNull(),
  suggestion: text("suggestion").notNull(),
  status: text("status").notNull().default("new"), // new | used | dismissed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const runLogs = pgTable("run_logs", {
  id: serial("id").primaryKey(),
  runId: text("run_id"),
  step: text("step").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  costUsd: real("cost_usd").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Conversation state for the Telegram bot (onboarding interview, pending edits).
export const botState = pgTable("bot_state", {
  chatId: text("chat_id").primaryKey(),
  mode: text("mode").notNull().default("idle"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
});

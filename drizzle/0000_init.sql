CREATE TABLE "bot_state" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'idle' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"kind" text DEFAULT 'daily' NOT NULL,
	"pillar" text,
	"format" text,
	"topic" text,
	"trend_id" integer,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen" integer DEFAULT 0 NOT NULL,
	"edited_text" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_url" text,
	"scheduled_for" timestamp,
	"run_id" text,
	"hook_token" text,
	"telegram_message_id" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"checkpoint" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"reposts" integer DEFAULT 0 NOT NULL,
	"quotes" integer DEFAULT 0 NOT NULL,
	"bookmarks" integer DEFAULT 0 NOT NULL,
	"profile_clicks" integer DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer,
	"tweet_id" text NOT NULL,
	"reply_tweet_id" text,
	"text" text NOT NULL,
	"pillar" text,
	"format" text,
	"has_media" boolean DEFAULT false NOT NULL,
	"embedding" jsonb,
	"deleted" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reply_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"tweet_id" text NOT NULL,
	"tweet_text" text NOT NULL,
	"suggestion" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reply_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"user_id" text,
	"pillar" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "reply_targets_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text,
	"step" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trends" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"summary" text,
	"score" real DEFAULT 0 NOT NULL,
	"pillar" text,
	"used_at" timestamp,
	"collected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"prompt" text,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trends_collected_idx" ON "trends" USING btree ("collected_at");
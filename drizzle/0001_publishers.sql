ALTER TABLE "posts" ALTER COLUMN "tweet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "provider" text DEFAULT 'xapi' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "external_id" text;
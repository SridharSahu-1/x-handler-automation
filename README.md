# x-handler

An autopilot for a developer's X account, with you in the loop. It researches what's trending in dev,
writes posts in **your** voice, makes code/list/compare images, and sends each draft to **Telegram** and a
**web dashboard** for approval. It posts at your slot, tracks how each post did, and learns which
topics and formats work for you. **It runs at $0**: posting goes through Buffer's free plan or through you.

> Nothing here can guarantee virality. The app raises the odds by building around what X's open-sourced ranker
> (xai-org/x-algorithm) actually rewards, and by learning from your own numbers.

## How it works

```
Vercel Cron (daily, 16:30 IST)
 └─ Workflow dailyPost (durable, survives restarts)
     1. collect trends   HN · GitHub · dev.to · Lobsters (+ Reddit if reachable) → LLM scores fit to your pillars
     2. pick topic       Thompson-sampling bandit over pillar × format, never the same format twice in a row
     3. research         web search (Tavily → Exa → Serper) + Jina Reader full text → source pack
     4. write            Gemini drafts 3 variants with your style card, interview answers and edit history
     5. quality gates    anti-slop rules → length → code compiles → fact-check vs sources → critic (Groq)
                         → report-risk → rewrite up to 2× → novelty vs last 60 days
     6. assets           code card / list / compare PNG, drawn in code (no AI art)
     7. approval         Telegram card + dashboard: pick variant · edit · approve · post now · regen · skip
     8. post at slot     no reply by the slot → auto-posts ONLY if it passed every gate and scored ≥ the bar
                         (via Buffer, the X API, or a one-tap handoff to you; see "Posting to X")
     9. learn            metrics (or your 1-tap rating) → Telegram report → bandit update
Daily: reply ideas for YOU to post (never automated). Weekly: digest.
```

### What the ranker rewards (production weights from `home-mixer/params/param.rs`)
| Signal | Weight | | Signal | Weight |
|---|---|---|---|---|
| share via copy link | 20 | | like | 0.66 |
| reply / quote / DM share | 5 | | **report** | **−234** |
| follow author | 4 | | mute | −58.8 |
| mutual reply boost | ×15 | | not interested | −52.3 |

So the content aims for saves, shares and replies, and the gates reject anything that reads as rage-bait.

## Safety by design
- **The app never automates likes, follows, DMs or replies.** Those are what get accounts suspended. Reply *ideas* open X's composer pre-filled, and you press send.
- **Only you control it.** The Telegram bot ignores every chat except `TELEGRAM_CHAT_ID`. The dashboard login is the Telegram widget restricted to your user ID, or a password.
- **Kill switch:** `/pause` or the dashboard toggle. Every post step checks it again before posting.
- **`DRY_RUN=1`** runs everything except the actual post (in every posting mode). Start in this mode.
- **Profile edits are limited to once a month per field.** The DP comes from your real photos, never an AI-generated face.
- **Double-post guard:** if a post attempt crashes mid-way, the app refuses to blindly retry it.

## Posting to X (pick one; the first two are free)

X closed its free API tier to new developers in Feb 2026, so posting through the official API now costs money.
The app supports three ways to post, and picks one from the keys you set:

| | **Buffer** (recommended, $0) | **Manual** ($0, zero setup) | **X API** (paid) |
|---|---|---|---|
| How | Buffer's free plan posts for you through its API | Telegram sends the finished post + image; you tap **Open X**, attach the image, press Post, paste the link back | Your own X developer keys |
| Setup | buffer.com → connect X → Settings → API → create key → `BUFFER_API_KEY` | nothing | X dev app + ~$5 credits (≈ $0.015/post) |
| Auto-post on timeout | ✅ | ❌ (it waits for you) | ✅ |
| Image + link self-reply | ✅ (thread) | ✅ (you paste both) | ✅ |
| Metrics | live likes & replies at +1h/+6h/+24h (X's public embed data, no key) + impressions & reposts from Buffer at +24h/+72h | live likes & replies once you paste the link; otherwise a 1-tap 💀😐👍🔥 rating | +1h / +6h / +24h, incl. impressions, bookmarks & profile clicks |
| Profile (bio/DP/banner) | app proposes, you paste/upload (1 min) | same | applied automatically |
| Delete from the app | only before it's sent | no | ✅ |
| Reply ideas | paste any post link in Telegram | same | also finds fresh posts itself |

Buffer free limits (Oct 2026): 3 channels, 10 queued posts per channel, 1 API key, ~1,000 API requests per channel per 30 days.
This app uses about 10–12 requests per post, so 1–3 posts/day fits comfortably.
Buffer can't fetch private or localhost images, so the Blob store must be **public** (and images only attach in production).

Why not log in to X with a headless browser? X's automation rules forbid non-API scripting of the website, and it's the
fastest way to get a new account locked. The app never does it.

## Setup (≈30 min)

1. **Accounts and keys** (all free):
   - **Posting**: a free Buffer account with your X account connected, then an API key (see above). Or skip it and use manual mode.
   - **Telegram**: talk to @BotFather → `/newbot` → token. Message your bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to read your chat id.
   - **Gemini**: aistudio.google.com → API key. **Groq**: console.groq.com. **OpenRouter** (fallback): openrouter.ai.
   - **Tavily** (search, 1,000/month free). Optional: Exa, Serper.
2. **Vercel**: import this repo, then add **Neon Postgres** and a **public Blob store** from the Marketplace (they set `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`).
3. For dashboard Telegram login, set `TELEGRAM_BOT_USERNAME` to your bot's username (without `@`) and `TELEGRAM_CHAT_ID` to your own **private** chat id. In @BotFather use `/setdomain`, choose that same bot, and link the deployed dashboard domain. Login must use that domain and the same Telegram account. Preview deployment domains need their own domain configuration. If the widget is blocked or the domain is not configured, send `/login` to your bot for a private sign-in link valid for 5 minutes; set `APP_URL` to the deployed dashboard URL.
   Copy every variable from `.env.example` into Vercel → Settings → Environment Variables. Keep `DRY_RUN=1` at first.
4. Run migrations: `vercel env pull .env.local && pnpm db:migrate`.
5. Check every key: `pnpm smoke`. It shows which posting mode is active and checks Buffer's connection to your X channel. (With X API keys, `pnpm smoke --write` also posts and deletes a test tweet.) `pnpm llm:check` runs every structured LLM call against each provider on its own, which catches a schema one provider rejects.
6. Deploy, then register the webhook once:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/setup`
7. In Telegram, send `/start` to your bot and answer the 12-question voice interview (voice notes work).
   Then run `/profile`, `/dp` (send photos), `/banner`, and `/intro` for your pinned post.
8. Watch the drafts for a few days in dry-run. When you like them, set `DRY_RUN=0` and redeploy.
   With Buffer, the first real post is the end-to-end test: `/new`, approve with **Post now**, and check your profile.

### Growing from 0 followers
- Fill in your profile completely before the first post, and verify your email and phone.
- Follow 50–100 developers in your niche **manually**.
- Reply to bigger dev accounts every day. Paste a post's link in Telegram and you get 2–3 reply options in your voice, with a button that opens X's reply box pre-filled. At 0 followers this matters more than your own posts.
- Reply to everyone who comments in the first hour.
- Stay at 1 post a day for the first weeks.

## Local development (no keys needed)

```bash
pnpm install
cp .env.example .env.local   # or use the keyless setup below
# Keyless: embedded Postgres + mocked LLMs + dry run
#   DATABASE_URL=pglite:./.pglite  LLM_MOCK=1  DRY_RUN=1  CRON_SECRET=local  SESSION_SECRET=<40 chars>  DASHBOARD_PASSWORD=local
pnpm db:migrate
pnpm dev                      # http://localhost:3000 (password login)
curl -H "Authorization: Bearer local" localhost:3000/api/cron/daily   # trigger the daily workflow
npx workflow web              # inspect workflow runs step by step
pnpm tsx scripts/wake.ts <runId>   # skip a pending sleep (test the timeout path)
```

PGlite allows one process at a time: stop `pnpm dev` before running `pnpm db:migrate` or `pnpm smoke` against it.
`LLM_MOCK` is ignored on Vercel, and `.vercelignore` keeps `.env.local` out of deployments.

Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. `pnpm render:samples` writes example cards to `./samples`.

## Telegram commands
`/new [topic]` · `/status` · `/pause` · `/resume` · `/stats` · `/trends` · `/replies` · `/profile` · `/banner` · `/dp` · `/intro` ·
`/interview` · `/voice <text>` · `/topics a; b; c` · `/slot HH:mm` · `/delete <postId>` · `/cancel`
Paste any X post link → reply ideas. In manual mode, paste your own post's link after posting so it gets tracked.

## Layout
```
app/(dashboard)/   overview, drafts, posts, analytics, calendar, trends, replies, voice, profile, settings, logs
app/api/           telegram webhook, cron (daily/weekly), auth, one-time setup
workflows/         dailyPost (durable approval + posting + metrics), replySuggestions, weeklyDigest
lib/content/       rules (anti-slop), gates (fact-check, critic), draft, research, bandit, novelty, voice
lib/llm/           Gemini → Groq → OpenRouter fallback chain (+ mock)
lib/research/      Tavily → Exa → Serper search chain, Jina Reader
lib/trends/        free trend sources + scoring
lib/publisher/     how posts reach X: Buffer (free) · manual handoff (free) · X API (paid)
lib/x/             X API client (OAuth 1.0a user context), only used when X keys are set
lib/telegram/      bot + approval cards
lib/assets/        code/list/compare cards via next/og
```

## Known limits
- **Free-tier limits and model names change often.** Model ids are env vars (`GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`), so a retired model is a one-line change. The fallback chain covers temporary outages.
- **Reddit blocks anonymous server requests**, so that trend source is often empty. The other four cover it.
- **Free modes can't change your profile or read timelines.** Only X's paid API does that. The app still writes the bio/banner/DP; you paste them in.
- **Free modes see likes and replies live, but impressions only via Buffer (daily).** Bookmarks and profile clicks need the paid API.
- **Buffer is a third party.** If they change the free plan, switch to manual mode (remove `BUFFER_API_KEY`) and nothing else changes.
- **The X profile endpoints are v1.1.** With X API keys, if X removes them from pay-per-use, `pnpm smoke --write` will tell you.
- **Vercel Hobby cron fires anywhere within its hour.** The workflow sleeps until your exact slot, so this doesn't matter as long as the slot is after the cron hour.

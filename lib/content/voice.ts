import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getSettings } from "../settings";

export const INTERVIEW_QUESTIONS = [
  "What do you actually work on day to day? Stack, languages, kind of company/projects.",
  "How many years have you been coding, and how did you get into it?",
  "Name 2-3 things you've built that you're proud of (side projects count). What was hard about them?",
  "What's a tech opinion you hold that a lot of devs would disagree with?",
  "What's a tool/library/framework you love, and one you can't stand? Why?",
  "Tell me about a bug or outage that cost you hours. What was the actual cause?",
  "What's something you learned the hard way that you wish someone told you earlier?",
  "What dev topics could you talk about for an hour without getting bored?",
  "Text a friend about something annoying at work today. Write it exactly how you'd text it.",
  "Do you use emojis, slang, lowercase, Hinglish, swearing? Give an example of how you'd react to a cool new tool.",
  "Who on dev Twitter/X do you like reading, and why?",
  "Anything you never want posted (employer stuff, topics, tone)?",
];

/** Everything the writer needs to sound like you, assembled from the DB. */
export async function voiceContext(limitSamples = 14) {
  const s = await getSettings();
  const interview = await db()
    .select()
    .from(schema.voiceSamples)
    .where(eq(schema.voiceSamples.kind, "interview"))
    .orderBy(schema.voiceSamples.id);
  const samples = await db()
    .select()
    .from(schema.voiceSamples)
    .where(eq(schema.voiceSamples.kind, "sample"))
    .orderBy(desc(schema.voiceSamples.id))
    .limit(limitSamples);
  const edits = await db()
    .select()
    .from(schema.voiceSamples)
    .where(eq(schema.voiceSamples.kind, "edit"))
    .orderBy(desc(schema.voiceSamples.id))
    .limit(8);
  const fb = await db().select().from(schema.feedback).orderBy(desc(schema.feedback.id)).limit(10);

  const parts: string[] = [];
  if (s.styleCard) parts.push(`STYLE CARD (approved by the author):\n${s.styleCard}`);
  if (interview.length)
    parts.push(
      `ABOUT THE AUTHOR, IN THEIR OWN WORDS (use facts from here; never invent experience they don't have):\n${interview
        .map((r) => `Q: ${r.prompt}\nA: ${r.text}`)
        .join("\n\n")}`,
    );
  if (samples.length) parts.push(`THINGS THE AUTHOR WROTE (match this voice):\n${samples.map((r) => `- ${r.text}`).join("\n")}`);
  if (edits.length)
    parts.push(
      `HOW THE AUTHOR REWRITES YOUR DRAFTS (learn from the difference):\n${edits
        .map((r) => `DRAFT: ${r.prompt}\nAUTHOR'S VERSION: ${r.text}`)
        .join("\n\n")}`,
    );
  if (fb.length) parts.push(`RECENT FEEDBACK ON REJECTED DRAFTS:\n${fb.map((f) => `- ${f.reason}`).join("\n")}`);
  return parts.join("\n\n");
}

// Interview answers that are about the author's work (stack, projects, outages, lessons, favourite topics).
const WORK_QUESTIONS = [0, 2, 5, 6, 7].map((i) => INTERVIEW_QUESTIONS[i]);
const NEVER_POST_QUESTION = INTERVIEW_QUESTIONS[11];

/**
 * What the post writer gets. Posts have their own creative voice, so the author's style card and
 * samples are NOT used; only hard limits, feedback on rejected drafts, and (for the occasional
 * personal post) facts about their work.
 */
export async function writerContext(personal: boolean) {
  const interview = await db().select().from(schema.voiceSamples).where(eq(schema.voiceSamples.kind, "interview")).orderBy(schema.voiceSamples.id);
  const fb = await db().select().from(schema.feedback).orderBy(desc(schema.feedback.id)).limit(10);
  const parts: string[] = [];
  const never = interview.find((r) => r.prompt === NEVER_POST_QUESTION)?.text;
  if (never) parts.push(`NEVER POST ABOUT (the author's hard limits):\n${never}`);
  if (personal) {
    const work = interview.filter((r) => r.prompt && WORK_QUESTIONS.includes(r.prompt));
    if (work.length) parts.push(`THE AUTHOR'S WORK (facts only; use at most one, and only if it strengthens the point):\n${work.map((r) => `- ${r.text}`).join("\n")}`);
  }
  if (fb.length) parts.push(`WHY THE AUTHOR REJECTED RECENT DRAFTS (avoid repeating these):\n${fb.map((f) => `- ${f.reason}`).join("\n")}`);
  return parts.join("\n\n");
}


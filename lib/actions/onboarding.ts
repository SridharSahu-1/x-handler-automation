import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { INTERVIEW_QUESTIONS } from "../content/voice";
import { llmText } from "../llm";
import { setSetting } from "../settings";

export async function getBotState(chatId: string) {
  const [s] = await db().select().from(schema.botState).where(eq(schema.botState.chatId, chatId));
  return s ?? { chatId, mode: "idle", data: {} as Record<string, unknown> };
}

export async function setBotState(chatId: string, mode: string, data: Record<string, unknown> = {}) {
  await db()
    .insert(schema.botState)
    .values({ chatId, mode, data })
    .onConflictDoUpdate({ target: schema.botState.chatId, set: { mode, data } });
}

export async function saveInterviewAnswer(index: number, answer: string) {
  await db().insert(schema.voiceSamples).values({ kind: "interview", prompt: INTERVIEW_QUESTIONS[index], text: answer });
}

export async function interviewAnswers() {
  return db().select().from(schema.voiceSamples).where(eq(schema.voiceSamples.kind, "interview")).orderBy(schema.voiceSamples.id);
}

/** Turns your raw answers into a short style card the writer follows. You approve/edit it. */
export async function draftStyleCard(): Promise<string> {
  const answers = await interviewAnswers();
  return llmText({
    system: "You are a writing coach who captures how a specific developer actually writes. Be concrete, not flattering.",
    prompt: `From these answers (pay most attention to HOW they're written, not just what), write a style card of 8-12 short bullet lines covering: capitalization, sentence length, slang/Hinglish/swearing, emoji use, humour type, what they sound confident about, topics to avoid, words they'd never use. Plain text bullets with "- ".\n\n${answers
      .map((a) => `Q: ${a.prompt}\nA: ${a.text}`)
      .join("\n\n")}`,
    temperature: 0.3,
  });
}

export async function finishOnboarding(styleCard: string) {
  await setSetting("styleCard", styleCard);
  await setSetting("onboarded", true);
}

export async function resetInterview() {
  await db().delete(schema.voiceSamples).where(eq(schema.voiceSamples.kind, "interview"));
}

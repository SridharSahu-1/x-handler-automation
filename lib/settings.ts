import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export { FORMATS, type Format } from "./formats";

export type Settings = {
  paused: boolean;
  pillars: string[];
  slotTime: string; // HH:mm in timezone
  timezone: string;
  jitterMinutes: number;
  approvalTimeoutMinutes: number;
  autoPostThreshold: number; // min critic "human" score to auto-post on timeout
  postsPerDay: number;
  styleCard: string;
  bannedPhrases: string[];
  llmOrder: ("gemini" | "groq" | "openrouter")[];
  searchOrder: ("tavily" | "exa" | "serper")[];
  dailyXReadBudget: number;
  replySuggestionsPerDay: number;
  personalShare: number;
  linkPlacement: "post" | "reply"; // where the source link goes: end of the post, or the first reply // 0-1: share of posts allowed to draw on the author's own work experience
  onboarded: boolean;
  bandit: Record<string, { a: number; b: number }>; // `${pillar}|${format}` -> Beta(a,b)
};

export const DEFAULT_SETTINGS: Settings = {
  paused: false,
  pillars: [
    "AI/LLM tooling for developers",
    "Web & TypeScript craft",
    "Dev career and real-world lessons",
    "Dev news takes",
  ],
  slotTime: "19:30",
  timezone: "Asia/Kolkata",
  jitterMinutes: 12,
  approvalTimeoutMinutes: 180,
  autoPostThreshold: 8,
  postsPerDay: 1,
  styleCard: "",
  bannedPhrases: [],
  llmOrder: ["gemini", "groq", "openrouter"],
  searchOrder: ["tavily", "exa", "serper"],
  dailyXReadBudget: 30,
  replySuggestionsPerDay: 4,
  personalShare: 0.15,
  linkPlacement: "post",
  onboarded: false,
  bandit: {},
};

export async function getSettings(): Promise<Settings> {
  const rows = await db().select().from(schema.settings);
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  return out as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db()
    .insert(schema.settings)
    .values({ key, value: value as unknown as object })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: value as unknown as object, updatedAt: new Date() },
    });
}

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, key));
  return (row?.value as Settings[K]) ?? DEFAULT_SETTINGS[key];
}

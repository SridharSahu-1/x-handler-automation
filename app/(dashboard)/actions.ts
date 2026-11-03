"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { SESSION_COOKIE, verifySession, createSession, safeEqual } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { setSetting, getSettings, type Settings } from "@/lib/settings";
import { decide, editDraft, deletePost } from "@/lib/actions/drafts";
import { applyProfileChange, proposeProfile, proposeBanner } from "@/lib/actions/profile";
import { collectTrends } from "@/lib/trends";
import { llmText } from "@/lib/llm";
import { WRITER_SYSTEM, FORMAT_GUIDES } from "@/lib/content/prompts";
import { writerContext } from "@/lib/content/voice";
import { FORMATS, type Format } from "@/lib/settings";
import { dailyPost } from "@/workflows/daily-post";
import { replySuggestions } from "@/workflows/replies";

async function guard() {
  const ok = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!ok) throw new Error("unauthorized");
}

export async function passwordLogin(formData: FormData) {
  const pw = String(formData.get("password") ?? "");
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || !safeEqual(pw, expected)) redirect("/login?error=password");
  (await cookies()).set(SESSION_COOKIE, await createSession("password"), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400,
  });
  redirect(String(formData.get("next") || "/"));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function decideAction(draftId: number, decision: Parameters<typeof decide>[1]) {
  await guard();
  const msg = await decide(draftId, decision);
  revalidatePath("/", "layout");
  return msg;
}

export async function pickVariant(draftId: number, i: number) {
  await guard();
  await db().update(schema.drafts).set({ chosen: i, editedText: null }).where(eq(schema.drafts.id, draftId));
  revalidatePath("/drafts");
}

export async function saveEdit(draftId: number, text: string) {
  await guard();
  const msg = await editDraft(draftId, text);
  revalidatePath("/drafts");
  return msg;
}

export async function newDraft(topic?: string) {
  await guard();
  const run = await start(dailyPost, [{ manual: true, forceTopic: topic || undefined }]);
  revalidatePath("/drafts");
  return run.runId;
}

export async function runReplies() {
  await guard();
  await start(replySuggestions, []);
}

export async function setPaused(paused: boolean) {
  await guard();
  await setSetting("paused", paused);
  revalidatePath("/", "layout");
}

export async function deletePostAction(postId: number) {
  await guard();
  const msg = await deletePost(postId);
  revalidatePath("/posts");
  return msg;
}

export async function saveSettings(formData: FormData) {
  await guard();
  const s = await getSettings();
  const lines = (k: string) => String(formData.get(k) ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const num = (k: string, d: number) => (formData.has(k) ? Number(formData.get(k)) : d);
  const next: Partial<Settings> = {
    pillars: lines("pillars").length ? lines("pillars") : s.pillars,
    slotTime: /^\d\d:\d\d$/.test(String(formData.get("slotTime"))) ? String(formData.get("slotTime")) : s.slotTime,
    timezone: String(formData.get("timezone") || s.timezone),
    jitterMinutes: num("jitterMinutes", s.jitterMinutes),
    approvalTimeoutMinutes: num("approvalTimeoutMinutes", s.approvalTimeoutMinutes),
    autoPostThreshold: num("autoPostThreshold", s.autoPostThreshold),
    postsPerDay: Math.min(3, Math.max(1, num("postsPerDay", s.postsPerDay))),
    dailyXReadBudget: num("dailyXReadBudget", s.dailyXReadBudget),
    replySuggestionsPerDay: num("replySuggestionsPerDay", s.replySuggestionsPerDay),
    linkPlacement: formData.get("linkPlacement") === "reply" ? "reply" : "post",
    personalShare: Math.min(100, Math.max(0, num("personalShare", s.personalShare * 100))) / 100,
    bannedPhrases: lines("bannedPhrases"),
    llmOrder: String(formData.get("llmOrder") || s.llmOrder.join(",")).split(",").map((x) => x.trim()) as Settings["llmOrder"],
    searchOrder: String(formData.get("searchOrder") || s.searchOrder.join(",")).split(",").map((x) => x.trim()) as Settings["searchOrder"],
  };
  for (const [k, v] of Object.entries(next)) await setSetting(k as keyof Settings, v as never);
  revalidatePath("/", "layout");
}

export async function saveStyleCard(formData: FormData) {
  await guard();
  await setSetting("styleCard", String(formData.get("styleCard") ?? ""));
  if (formData.get("markOnboarded")) await setSetting("onboarded", true);
  revalidatePath("/voice");
}

export async function addVoiceSample(formData: FormData) {
  await guard();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  // Paste many samples separated by blank lines.
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  await db().insert(schema.voiceSamples).values(parts.map((p) => ({ kind: "sample", text: p })));
  revalidatePath("/voice");
}

export async function deleteVoiceSample(id: number) {
  await guard();
  await db().delete(schema.voiceSamples).where(eq(schema.voiceSamples.id, id));
  revalidatePath("/voice");
}

export async function playground(format: string, topic: string) {
  await guard();
  const f = (FORMATS as readonly string[]).includes(format) ? (format as Format) : "take";
  return llmText({
    system: WRITER_SYSTEM,
    prompt: `${await writerContext(false)}\n\nFORMAT: ${f}: ${FORMAT_GUIDES[f]}\nTOPIC: ${topic}\n\nWrite one post. Output only the post text.`,
    temperature: 0.9,
  });
}

export async function refreshTrends() {
  await guard();
  await collectTrends((await getSettings()).pillars);
  revalidatePath("/trends");
}

export async function profileAction(kind: "propose" | "banner" | "apply", id?: number) {
  await guard();
  if (kind === "propose") await proposeProfile();
  else if (kind === "banner") await proposeBanner();
  else if (id) {
    const msg = await applyProfileChange(id, true);
    revalidatePath("/profile");
    return msg;
  }
  revalidatePath("/profile");
}

export async function addReplyTarget(formData: FormData) {
  await guard();
  const handles = String(formData.get("handles") ?? "").split(/[\s,]+/).map((h) => h.replace(/^@/, "").trim()).filter(Boolean);
  if (handles.length) await db().insert(schema.replyTargets).values(handles.map((handle) => ({ handle }))).onConflictDoNothing();
  revalidatePath("/replies");
}

export async function toggleReplyTarget(id: number, active: boolean) {
  await guard();
  await db().update(schema.replyTargets).set({ active }).where(eq(schema.replyTargets.id, id));
  revalidatePath("/replies");
}

export async function markReply(id: number, status: "used" | "dismissed") {
  await guard();
  await db().update(schema.replySuggestions).set({ status }).where(eq(schema.replySuggestions.id, id));
  revalidatePath("/replies");
}

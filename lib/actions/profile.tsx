import { ImageResponse } from "next/og";
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db";
import { llmObject } from "../llm";
import { voiceContext } from "../content/voice";
import { getSettings } from "../settings";
import { slopViolations } from "../content/rules";
import { canEditProfile } from "../publisher";
import { storePng } from "../assets/store";

const MIN_DAYS_BETWEEN_CHANGES = 30;

/** Bio/name/location proposals grounded in your interview answers and pillars. */
export async function proposeProfile() {
  const s = await getSettings();
  const voice = await voiceContext(6);
  const out = await llmObject({
    schema: z.object({
      names: z.array(z.string()).length(3).describe("display names: real name or real name + short dev descriptor, max 50 chars"),
      bios: z.array(z.string()).length(3).describe("max 160 chars each, specific, human, no buzzwords, no emoji spam"),
      location: z.string().describe("short, or empty"),
    }),
    system:
      "You write X profiles for developers that look like a real person wrote them: specific stack/work, a bit of personality, no 'passionate', 'enthusiast', 'ninja', 'guru', 'building the future', no hashtags, max one emoji.",
    prompt: `${voice}\n\nContent pillars: ${s.pillars.join("; ")}\n\nPropose profile fields.`,
  });
  const bios = out.bios.filter((b) => b.length <= 160 && !slopViolations(b).length);
  const rows = [
    ...out.names.map((v) => ({ field: "name", value: v.slice(0, 50) })),
    ...bios.map((v) => ({ field: "bio", value: v })),
    ...(out.location ? [{ field: "location", value: out.location.slice(0, 30) }] : []),
  ];
  return db().insert(schema.profileChanges).values(rows).returning();
}

async function recentlyChanged(field: string) {
  const [r] = await db()
    .select()
    .from(schema.profileChanges)
    .where(and(eq(schema.profileChanges.field, field), eq(schema.profileChanges.status, "applied"), gte(schema.profileChanges.appliedAt, new Date(Date.now() - MIN_DAYS_BETWEEN_CHANGES * 864e5))))
    .limit(1);
  return !!r;
}

/** Where you edit your profile on X (used when the app can't change it for you). */
export const PROFILE_EDIT_URL = "https://x.com/settings/profile";
const isImage = (field: string) => field === "avatar" || field === "banner";

/**
 * Applies a proposed change. With the X API it goes straight to X; otherwise it's marked as chosen
 * and you paste it in (only the paid API can edit profiles). Once per field per 30 days unless forced.
 */
export async function applyProfileChange(id: number, force = false): Promise<string> {
  const [c] = await db().select().from(schema.profileChanges).where(eq(schema.profileChanges.id, id));
  if (!c) return "Not found.";
  if (!force && (await recentlyChanged(c.field)))
    return `Your ${c.field} was changed in the last ${MIN_DAYS_BETWEEN_CHANGES} days. Frequent changes look bot-like; use the dashboard to force it.`;
  const auto = canEditProfile();
  if (auto) {
    const { updateProfile, updateAvatar, updateBanner } = await import("../x/client");
    if (c.field === "name") await updateProfile({ name: c.value });
    else if (c.field === "bio") await updateProfile({ description: c.value });
    else if (c.field === "location") await updateProfile({ location: c.value });
    else if (c.field === "url") await updateProfile({ url: c.value });
    else if (c.field === "avatar" || c.field === "banner") {
      const png = new Uint8Array(await (await fetch(c.value)).arrayBuffer());
      await (c.field === "avatar" ? updateAvatar(png) : updateBanner(png));
    }
  }
  await db()
    .update(schema.profileChanges)
    .set({ status: "rejected" })
    .where(and(eq(schema.profileChanges.field, c.field), eq(schema.profileChanges.status, "proposed")));
  await db().update(schema.profileChanges).set({ status: "applied", appliedAt: new Date() }).where(eq(schema.profileChanges.id, id));
  if (auto) return `Updated your ${c.field} on X.`;
  return isImage(c.field)
    ? `Saved. Set it on X yourself: ${PROFILE_EDIT_URL} → tap the ${c.field === "avatar" ? "profile photo" : "header"} → upload the image I sent.`
    : `Saved. Paste it into X yourself: ${PROFILE_EDIT_URL}`;
}

/** Square 400×400 avatar from one of your real photos (center crop, slight contrast lift). */
export async function proposeAvatar(photoUrl: string) {
  const res = new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} width={400} height={400} style={{ objectFit: "cover", width: 400, height: 400 }} alt="" />
    ),
    { width: 400, height: 400 },
  );
  const url = await storePng(new Uint8Array(await res.arrayBuffer()), "avatar");
  const [row] = await db().insert(schema.profileChanges).values({ field: "avatar", value: url }).returning();
  return row;
}

/** 1500×500 banner drawn in code: your pillars as a quiet terminal motif. */
export async function proposeBanner() {
  const s = await getSettings();
  const lines = s.pillars.slice(0, 4).map((p) => `# ${p.toLowerCase()}`);
  const mono = await (await fetch("https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-400-normal.ttf")).arrayBuffer();
  const res = new ImageResponse(
    (
      <div style={{ width: 1500, height: 500, display: "flex", background: "#0d1117", fontFamily: "JetBrains Mono", padding: "0 0 0 620px", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 30, color: "#8b949e" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "flex", color: "#8b949e" }}>{l}</div>
          ))}
          <div style={{ display: "flex", alignItems: "center", color: "#7ee787" }}>
            $<div style={{ display: "flex", width: 16, height: 32, background: "#7ee787", marginLeft: 18 }} />
          </div>
        </div>
      </div>
    ),
    { width: 1500, height: 500, fonts: [{ name: "JetBrains Mono", data: mono, weight: 400, style: "normal" }] },
  );
  const url = await storePng(new Uint8Array(await res.arrayBuffer()), "banner");
  const [row] = await db().insert(schema.profileChanges).values({ field: "banner", value: url }).returning();
  return row;
}

export async function profileHistory() {
  return db().select().from(schema.profileChanges).orderBy(desc(schema.profileChanges.id)).limit(50);
}

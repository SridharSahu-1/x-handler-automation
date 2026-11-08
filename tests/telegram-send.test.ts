import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { drafts } from "@/lib/db/schema";
import { draftCaption, refreshDraftCard, sendDraftCard, tg } from "@/lib/telegram/send";

const draft = (overrides = {}) => ({
  id: 1, status: "pending", personal: false, kind: "daily", pillar: "TypeScript", format: "take",
  topic: null, trendId: null, variants: [{ text: "a useful post", assetUrl: "https://example.com/post.png" }],
  chosen: 0, editedText: null, sources: [], assetUrl: null, scheduledFor: null,
  runId: null, hookToken: null, telegramMessageId: null, error: null,
  createdAt: new Date(), updatedAt: new Date(), ...overrides,
}) as typeof drafts.$inferSelect;

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1:test");
  vi.stubEnv("TELEGRAM_CHAT_ID", "42");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Telegram draft delivery", () => {
  it("sends an image and intact HTML details when the caption exceeds the photo limit", async () => {
    const photo = vi.spyOn(tg(), "sendPhoto").mockResolvedValue({ message_id: 7 } as never);
    const text = vi.spyOn(tg(), "sendMessage").mockResolvedValue({ message_id: 8 } as never);
    const d = draft({ sources: [{ title: "source", url: `https://example.com/${"a".repeat(1200)}` }] });
    const caption = draftCaption(d);
    expect(caption.length).toBeGreaterThan(1024);
    expect(await sendDraftCard(d)).toBe(7);
    expect(photo.mock.calls[0][2]?.caption?.length).toBeLessThanOrEqual(1024);
    expect(text.mock.calls[0][1]).toBe(caption);
    expect(caption).toContain('</a>');
    expect(text.mock.calls[0][2]?.reply_markup).toBeDefined();
  });

  it("keeps the draft and approval buttons available if image delivery fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(tg(), "sendPhoto").mockRejectedValue(new Error("image unavailable"));
    const text = vi.spyOn(tg(), "sendMessage").mockResolvedValue({ message_id: 8 } as never);
    expect(await sendDraftCard(draft())).toBe(8);
    expect(text.mock.calls[0][1]).toContain("a useful post");
    expect(text.mock.calls[0][1]).toContain("Image preview unavailable");
    expect(JSON.stringify(text.mock.calls[0][2]?.reply_markup)).toContain("pn:1");
  });

  it("adds the selected image to a previously text-only card", async () => {
    const editMessageMedia = vi.fn().mockResolvedValue({});
    const ctx = { callbackQuery: { message: { text: "old variant" } }, editMessageMedia } as unknown as Context;
    await refreshDraftCard(ctx, draft());
    expect(editMessageMedia).toHaveBeenCalledWith(expect.objectContaining({ type: "photo", caption: expect.stringContaining("a useful post") }), expect.anything());
  });
});

import { ImageResponse } from "next/og";
import { codeToTokens } from "shiki";
import type { AssetSpec } from "../db/schema";

const FONT_BASE = "https://cdn.jsdelivr.net/fontsource/fonts";
let fontCache: { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;

async function fonts() {
  if (fontCache) return fontCache;
  const load = async (family: string, weight: 400 | 600 | 700) =>
    (await fetch(`${FONT_BASE}/${family}@latest/latin-${weight}-normal.ttf`)).arrayBuffer();
  const [mono, mono7, sans, sans7] = await Promise.all([
    load("jetbrains-mono", 400),
    load("jetbrains-mono", 700),
    load("inter", 600),
    load("inter", 700),
  ]);
  fontCache = [
    { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" },
    { name: "JetBrains Mono", data: mono7, weight: 700, style: "normal" },
    { name: "Inter", data: sans, weight: 600, style: "normal" },
    { name: "Inter", data: sans7, weight: 700, style: "normal" },
  ];
  return fontCache;
}

const W = 1200;
const H = 675;
const BG = "#0d1117";
const PANEL = "#161b22";
const BORDER = "#30363d";
const MUTED = "#8b949e";
const TEXT = "#e6edf3";
const ACCENT = "#7ee787";

const SHIKI_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "jsx", "python", "py", "go", "rust", "rs", "bash", "sh", "shell", "sql", "json", "yaml", "css", "html", "java", "kotlin", "swift", "c", "cpp", "ruby", "php", "dockerfile", "diff"]);

async function CodeCard({ language, code, title }: { language: string; code: string; title?: string }) {
  const lang = SHIKI_LANGS.has(language.toLowerCase()) ? language.toLowerCase() : "text";
  const { tokens } = await codeToTokens(code.replace(/\t/g, "  ").trimEnd(), {
    lang: lang as "ts",
    theme: "github-dark-default",
  });
  const fontSize = tokens.length > 12 ? 22 : tokens.length > 8 ? 25 : 28;
  return (
    <div style={{ width: W, height: H, display: "flex", background: BG, padding: 48, fontFamily: "JetBrains Mono" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 18, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "18px 24px", borderBottom: `1px solid ${BORDER}`, gap: 10 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#ff5f57" }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#febc2e" }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#28c840" }} />
          <div style={{ marginLeft: 16, color: MUTED, fontSize: 20 }}>{title ?? `snippet.${lang === "text" ? "txt" : lang}`}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "26px 32px", fontSize, lineHeight: 1.5 }}>
          {tokens.map((line, i) => (
            <div key={i} style={{ display: "flex", whiteSpace: "pre", minHeight: fontSize * 1.5 }}>
              <span style={{ color: "#484f58", width: fontSize * 2, flexShrink: 0 }}>{String(i + 1)}</span>
              {line.map((t, j) => (
                <span key={j} style={{ color: t.color ?? TEXT }}>{t.content}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  const fontSize = items.length > 6 ? 30 : 36;
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "center", background: BG, padding: "56px 72px", fontFamily: "Inter", color: TEXT }}>
      <div style={{ fontSize: 46, fontWeight: 700, marginBottom: 36, display: "flex" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", fontSize }}>
            <span style={{ color: ACCENT, fontFamily: "JetBrains Mono", fontWeight: 700, width: 56, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontWeight: 600 }}>{it}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareCard({ title, left, right, rows }: { title: string; left: string; right: string; rows: [string, string, string][] }) {
  const cell = { display: "flex", flex: 1, padding: "18px 20px", fontSize: rows.length > 5 ? 26 : 30 } as const;
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "center", background: BG, padding: "48px 64px", fontFamily: "Inter", color: TEXT }}>
      <div style={{ fontSize: 46, fontWeight: 700, marginBottom: 32, display: "flex" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", background: PANEL, fontWeight: 700 }}>
          <div style={{ ...cell, color: MUTED }} />
          <div style={{ ...cell, color: "#79c0ff" }}>{left}</div>
          <div style={{ ...cell, color: ACCENT }}>{right}</div>
        </div>
        {rows.map(([k, a, b], i) => (
          <div key={i} style={{ display: "flex", borderTop: `1px solid ${BORDER}`, fontWeight: 600 }}>
            <div style={{ ...cell, color: MUTED }}>{k}</div>
            <div style={cell}>{a}</div>
            <div style={cell}>{b}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeadlineCard({ kicker, title, points, source }: { kicker: string; title: string; points: string[]; source?: string }) {
  const titleSize = title.length > 48 ? 54 : title.length > 30 ? 62 : 72;
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, padding: "60px 72px", fontFamily: "Inter", color: TEXT }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", color: ACCENT, fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 26, letterSpacing: 2, textTransform: "uppercase", marginBottom: 22 }}>{kicker}</div>
        <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.12, letterSpacing: -1 }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, borderLeft: `4px solid ${ACCENT}`, paddingLeft: 26 }}>
        {points.map((p, i) => (
          <div key={i} style={{ display: "flex", fontSize: 30, fontWeight: 600, color: TEXT }}>{p}</div>
        ))}
      </div>
      <div style={{ display: "flex", color: MUTED, fontSize: 22, fontFamily: "JetBrains Mono" }}>{source ? `source: ${source}` : ""}</div>
    </div>
  );
}

/** Renders an asset spec to PNG bytes. Code-drawn cards look hand-made; AI art reads as slop to devs. */
export async function renderAsset(spec: AssetSpec): Promise<Uint8Array> {
  const el =
    spec.kind === "code" ? await CodeCard(spec)
    : spec.kind === "list" ? <ListCard {...spec} />
    : spec.kind === "headline" ? <HeadlineCard {...spec} />
    : <CompareCard {...spec} />;
  const res = new ImageResponse(el, { width: W, height: H, fonts: await fonts() });
  return new Uint8Array(await res.arrayBuffer());
}

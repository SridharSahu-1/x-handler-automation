import { writeFileSync, mkdirSync } from "node:fs";
import { renderAsset } from "../lib/assets/render";

// Renders one of each card type to ./samples for a visual check (no network except fonts).
async function main() {
  const out = process.argv[2] ?? "samples";
  mkdirSync(out, { recursive: true });
  const specs = {
    code: {
      kind: "code" as const,
      language: "ts",
      title: "retry.ts",
      code: `// forEach doesn't await. This "works" and silently races:
items.forEach(async (item) => {
  await save(item);
});

// What you actually want:
for (const item of items) {
  await save(item);
}

// Or in parallel, on purpose:
await Promise.all(items.map(save));`,
    },
    list: {
      kind: "list" as const,
      title: "git flags I use every day",
      items: ["git switch -c <branch>", "git add -p (stage hunks, not files)", "git commit --fixup <sha>", "git rebase -i --autosquash", "git log --oneline --graph", "git restore --staged <file>"],
    },
    compare: {
      kind: "compare" as const,
      title: "Bun vs Node for a small API",
      left: "Node 24",
      right: "Bun",
      rows: [
        ["cold start", "~120ms", "~40ms"],
        ["TS", "--experimental-strip-types", "native"],
        ["test runner", "node:test", "bun test"],
        ["ecosystem", "everything", "most things"],
      ] as [string, string, string][],
    },
    headline: {
      kind: "headline" as const,
      kicker: "LiveCodeBench Hard",
      title: "5 open 27B models beat Fable 5 at coding",
      points: ["Memdoor routes each task to a team of Qwen3.8-27B agents", "Runs on a single 48GB GPU", "Open source, trending on GitHub"],
      source: "github.com",
    },
  };
  for (const [name, spec] of Object.entries(specs)) {
    const png = await renderAsset(spec);
    writeFileSync(`${out}/${name}.png`, png);
    console.log(`${out}/${name}.png`, png.length, "bytes");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

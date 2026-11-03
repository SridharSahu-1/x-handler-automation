// Deterministic stand-in for the LLMs when LLM_MOCK=1, so the whole pipeline
// (workflow, gates, Telegram, dashboard) can be exercised locally without API keys.
// Never active on a Vercel deployment, even if the env var leaks there.
export const isMock = () => process.env.LLM_MOCK === "1" && !process.env.VERCEL;

export function mockObject(system: string | undefined, prompt: string): unknown {
  const sys = system ?? "";
  if (prompt.includes("fit 0-10")) {
    const pillars = [...prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
    const items = [...prompt.matchAll(/^(\d+)\. \[/gm)].map((m, k) => ({ i: Number(m[1]), pillar: pillars[k % Math.max(1, Math.min(4, pillars.length))] ?? "none", fit: 8 - (k % 4) }));
    return { items };
  }
  if (sys.includes("strict fact checker")) return { unsupported: [] };
  if (sys.includes("senior engineer")) return { human: 8, specificity: 8, value: 7, reportRisk: 1, originality: 8, personal: 0, notes: "fine" };
  if (prompt.includes("Return the rewritten variant")) return { variant: variant(0) };
  if (prompt.includes("Write 3 genuinely different variants")) return { variants: [variant(0), variant(1), variant(2)] };
  if (prompt.includes("Propose profile fields"))
    return {
      names: ["Sam Dev", "Sam · TypeScript", "sam builds things"],
      bios: ["full-stack dev. mostly TypeScript, Postgres and whatever broke in prod today", "I write code and occasionally things about code. web + AI tooling", "building web apps, breaking them, writing down what I learned"],
      location: "India",
    };
  if (prompt.includes("Draft one reply per post")) return { replies: [] };
  if (prompt.includes("Draft 3 different replies")) return { replies: ["hit this exact thing last month, the fix was pinning the lockfile in CI", "counterpoint: works fine until you have 40 packages"] };
  return {};
}

const VARIANTS = [
  { text: "forEach doesn't wait for async callbacks. it fires them all and moves on.\n\nif order matters use for...of. if it doesn't, Promise.all and say so on purpose", asset: { kind: "code", language: "ts", code: "for (const item of items) {\n  await save(item);\n}\n\nawait Promise.all(items.map(save));" } },
  { text: "most \"slow API\" bugs I've seen were an N+1 query hiding behind an ORM. turn on query logging for one request and count. that's the whole tip", asset: null },
  { text: "6 git commands that cover 95% of my day", asset: { kind: "list", title: "git, the useful 5%", items: ["git switch -c <branch>", "git add -p", "git commit --fixup <sha>", "git rebase -i --autosquash", "git log --oneline --graph", "git restore --staged <file>"] } },
];
// Shaped like the writer's raw output (nullable fields), not the stored Variant.
function variant(i: number) {
  const v = VARIANTS[i % VARIANTS.length];
  return { selfReply: null, ...v, asset: v.asset && v.asset.kind === "code" ? { title: null, ...v.asset } : v.asset };
}

export function mockText(prompt: string): string {
  if (prompt.includes("style card")) return "- lowercase mostly\n- short sentences, dry humour\n- no emojis\n- talks about TypeScript and Postgres with confidence";
  return "forEach + async is a trap. use for...of";
}

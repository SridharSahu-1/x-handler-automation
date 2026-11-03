// Patterns that make developers instantly clock a post as AI-written.
// Keep these as data: the dashboard can extend them via settings.bannedPhrases.
export const SLOP_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /—/, why: "em dash" },
  { re: /\bdelv(e|es|ing)\b/i, why: '"delve"' },
  { re: /\bgame[- ]?changer\b/i, why: '"game-changer"' },
  { re: /\bunlock(s|ing)?\b/i, why: '"unlock"' },
  { re: /\bunleash/i, why: '"unleash"' },
  { re: /\bleverag(e|ing)\b/i, why: '"leverage"' },
  { re: /\belevate\b/i, why: '"elevate"' },
  { re: /\bseamless(ly)?\b/i, why: '"seamless"' },
  { re: /\brobust\b/i, why: '"robust"' },
  { re: /\btapestry\b/i, why: '"tapestry"' },
  { re: /\blandscape\b/i, why: '"landscape"' },
  { re: /\brealm\b/i, why: '"realm"' },
  { re: /\bsupercharge/i, why: '"supercharge"' },
  { re: /\bin today'?s (fast[- ]paced|digital|ever[- ]changing)/i, why: "corporate opener" },
  { re: /\bhere'?s the thing\b/i, why: '"here\'s the thing"' },
  { re: /\blet'?s dive in\b|\bdive (deep|into)\b|\bdeep dive\b/i, why: '"dive in"' },
  { re: /\bit'?s (not|isn'?t) (just )?about .{1,40}, it'?s about\b/i, why: '"it\'s not about X, it\'s about Y"' },
  { re: /\bnot just .{1,30}, (but|it'?s)\b/i, why: '"not just X, but Y"' },
  { re: /\bthe best part\?/i, why: '"the best part?"' },
  { re: /\bthe result\?/i, why: '"the result?"' },
  { re: /\bbuckle up\b/i, why: '"buckle up"' },
  { re: /\bin conclusion\b|\bin summary\b/i, why: "essay closer" },
  { re: /\bfeel free to\b/i, why: '"feel free to"' },
  { re: /\bthoughts\?\s*$/i, why: 'ends with "Thoughts?"' },
  { re: /\bwhat do you think\?\s*$/i, why: 'ends with "What do you think?"' },
  { re: /\bas an ai\b/i, why: "AI self-reference" },
  { re: /\b(crucial|pivotal|paramount|plethora|myriad)\b/i, why: "inflated vocabulary" },
  { re: /\bharness(ing)? the power\b/i, why: '"harness the power"' },
  { re: /🚀|🧵|💡|🔥.*🔥|✨/u, why: "AI-flavoured emoji" },
  { re: /^\s*(1\/|🧵)/, why: "thread opener" },
  { re: /^(ever wondered|did you know|imagine)\b/i, why: "clickbait opener" },
];

export function slopViolations(text: string, extra: string[] = []): string[] {
  const out: string[] = [];
  for (const p of SLOP_PATTERNS) if (p.re.test(text)) out.push(p.why);
  for (const phrase of extra) if (phrase && text.toLowerCase().includes(phrase.toLowerCase())) out.push(`"${phrase}"`);
  const hashtags = text.match(/#\w+/g) ?? [];
  if (hashtags.length > 1) out.push(`${hashtags.length} hashtags`);
  const emojis = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  if (emojis.length > 2) out.push(`${emojis.length} emojis`);
  const colonLists = text.split("\n").filter((l) => /^\s*[-•*]\s*\*\*/.test(l)).length;
  if (colonLists) out.push("markdown bold bullets");
  if (/\*\*[^*]+\*\*/.test(text)) out.push("markdown bold (X doesn't render it)");
  return out;
}

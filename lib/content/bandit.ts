import { FORMATS, type Format } from "../settings";

export type Arms = Record<string, { a: number; b: number }>;

// Marsaglia-Tsang gamma sampler -> Beta sample.
function gamma(k: number): number {
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = Math.random(), u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function sampleBeta(a: number, b: number) {
  const x = gamma(a), y = gamma(b);
  return x / (x + y);
}

export const armKey = (pillar: string, format: string) => `${pillar}|${format}`;

/**
 * Weakly-informative prior. Flat Beta(1,1) over 24 untried arms makes the max of the
 * untried samples beat even a proven winner most of the time; Beta(2,2) keeps exploration
 * but lets real evidence win.
 */
export const PRIOR = { a: 2, b: 2 } as const;
export const armTrials = (arm: { a: number; b: number } | undefined) => (arm ? arm.a + arm.b - PRIOR.a - PRIOR.b : 0);

/** Thompson sampling over pillar×format, never repeating yesterday's format. */
export function chooseArm(
  arms: Arms,
  pillars: string[],
  opts: { avoidFormat?: string | null; availablePillars?: Set<string> } = {},
): { pillar: string; format: Format } {
  let best = { pillar: pillars[0], format: FORMATS[0] as Format, v: -1 };
  for (const pillar of pillars) {
    if (opts.availablePillars && !opts.availablePillars.has(pillar)) continue;
    for (const format of FORMATS) {
      if (format === opts.avoidFormat) continue;
      const { a, b } = arms[armKey(pillar, format)] ?? PRIOR;
      const v = sampleBeta(a, b);
      if (v > best.v) best = { pillar, format, v };
    }
  }
  return { pillar: best.pillar, format: best.format };
}

/**
 * Engagement score that mirrors the open-sourced ranker's priorities
 * (replies/quotes/bookmark-like saves >> likes), normalised by impressions.
 */
export function engagementScore(m: {
  impressions: number; likes: number; replies: number; reposts: number; quotes: number; bookmarks: number; profileClicks: number;
}) {
  const weighted = m.likes * 0.66 + m.reposts * 1 + m.replies * 5 + m.quotes * 5 + m.bookmarks * 4 + m.profileClicks * 1.5;
  // Free modes can't always see impressions: score against a nominal 1,000 views so numbers stay comparable.
  return weighted / (m.impressions > 0 ? m.impressions : NOMINAL_IMPRESSIONS);
}
export const NOMINAL_IMPRESSIONS = 1000;

/** Turns a post's score into a Beta update relative to the running median (success = beat median). */
export function updateArm(arms: Arms, key: string, score: number, median: number): Arms {
  const cur = arms[key] ?? PRIOR;
  const won = score >= median;
  return { ...arms, [key]: { a: cur.a + (won ? 1 : 0), b: cur.b + (won ? 0 : 1) } };
}

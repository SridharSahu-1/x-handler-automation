export const FORMATS = [
  "tip-code", // non-obvious tip with a code card
  "take", // contrarian but defensible opinion
  "story", // short war story with numbers
  "list", // curated list / cheat-sheet people bookmark
  "news", // reaction to fresh dev news
  "question", // open question to the audience
] as const;
export type Format = (typeof FORMATS)[number];

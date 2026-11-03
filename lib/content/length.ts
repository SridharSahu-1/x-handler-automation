import twitter from "twitter-text";

export const MAX_TWEET = 280;

/** X's weighted length: URLs count 23, most emoji/CJK count 2. */
export function tweetLength(text: string): number {
  return twitter.parseTweet(text).weightedLength;
}

export function fitsTweet(text: string): boolean {
  return twitter.parseTweet(text).valid;
}

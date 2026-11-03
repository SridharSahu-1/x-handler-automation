export type SearchResult = { title: string; url: string; content: string; publishedAt?: string };
export type SearchProvider = (query: string, opts: { days?: number; max?: number }) => Promise<SearchResult[]>;

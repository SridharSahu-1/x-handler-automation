import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
let _db: DB | null = null;

/**
 * Neon (serverless HTTP) in production. `DATABASE_URL=pglite:./.pglite` runs an embedded
 * Postgres locally, so the whole app works with zero cloud setup for development/testing.
 */
export function db(): DB {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    if (url.startsWith("pglite:")) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PGlite } = require("@electric-sql/pglite");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { drizzle: drizzlePglite } = require("drizzle-orm/pglite");
      const g = globalThis as unknown as { __pglite?: unknown };
      g.__pglite ??= new PGlite(url.slice("pglite:".length) || undefined);
      _db = drizzlePglite(g.__pglite, { schema }) as DB;
    } else {
      _db = drizzle(neon(url), { schema });
    }
  }
  return _db;
}

export { schema };

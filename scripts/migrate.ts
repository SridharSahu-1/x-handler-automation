import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

// Applies ./drizzle migrations to Neon or to a local PGlite database.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(url.slice("pglite:".length) || undefined);
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    await client.close();
  } else {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
  }
  console.log("migrations applied");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

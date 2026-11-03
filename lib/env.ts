export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env var ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v ? v : undefined;
}

export const isDryRun = () => process.env.DRY_RUN === "1";

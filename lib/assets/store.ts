import { put } from "@vercel/blob";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function storeFile(bytes: Uint8Array, name: string, contentType: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN && process.env.NODE_ENV !== "production") {
    // Local dev without Blob: serve from /public/generated.
    const file = `${Date.now()}-${name}`;
    const dir = path.join(process.cwd(), "public", "generated");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), bytes);
    return `${process.env.APP_URL ?? "http://localhost:3000"}/generated/${file}`;
  }
  const blob = await put(`assets/${name}`, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: true });
  return blob.url;
}

export async function storePng(bytes: Uint8Array, name: string): Promise<string> {
  return storeFile(bytes, `${name}.png`, "image/png");
}

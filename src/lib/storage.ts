// Evidence storage adapter: Supabase Storage (private bucket) when configured, else local disk.
// Files are only served through an authorized route; never public URLs.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env, integrations } from "./env";

// Vercel's filesystem is read-only except /tmp (ephemeral) — configure Supabase Storage in production.
const LOCAL_DIR = process.env.VERCEL ? "/tmp/siteiq-uploads" : path.join(process.cwd(), ".data", "uploads");
const admin = () => createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = /^(image\/(jpeg|png|webp|heic)|application\/pdf|text\/plain)$/;

export async function putFile(prefix: string, filename: string, bytes: Buffer, mime: string) {
  const safe = filename.replace(/[^\w.\-]/g, "_").slice(-80);
  const key = `${prefix}/${randomUUID()}-${safe}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (integrations.supabaseStorage()) {
    const { error } = await admin().storage.from(env.supabaseBucket).upload(key, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return { backend: "supabase", key, sha256 };
  }
  const full = path.join(LOCAL_DIR, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return { backend: "local", key, sha256 };
}

export async function getFile(backend: string, key: string): Promise<Buffer> {
  if (backend === "supabase") {
    const { data, error } = await admin().storage.from(env.supabaseBucket).download(key);
    if (error || !data) throw new Error("Not found");
    return Buffer.from(await data.arrayBuffer());
  }
  const full = path.resolve(LOCAL_DIR, key);
  if (!full.startsWith(LOCAL_DIR)) throw new Error("Invalid path");
  return readFile(full);
}

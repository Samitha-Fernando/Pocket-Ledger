import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Asset photos live in ./uploads (git-ignored), one folder per user. They are
// never served directly: a signed-in route checks ownership first.

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "uploads");

// The "turbopackIgnore" hints stop the build from bundling the whole project
// just because these paths are worked out at run time.
const filePath = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ UPLOADS_DIR, ...parts);
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
type Ext = keyof typeof TYPES;

/** Works out the real image type from the file's first bytes (not its name). */
function sniff(bytes: Uint8Array): Ext | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "webp";
  return null;
}

const SAFE_NAME = /^[a-z0-9]+\/[a-f0-9]{32}\.(jpg|png|webp)$/;

/** Validates and stores a photo. Returns its stored name, or an error message. */
export async function savePhoto(userId: string, file: File): Promise<{ name: string } | { error: string }> {
  if (file.size > MAX_PHOTO_BYTES) return { error: "Photo is too large (max 5 MB)." };
  return savePhotoBytes(userId, new Uint8Array(await file.arrayBuffer()));
}

/** Stores image bytes (checked to really be JPG / PNG / WebP) for a user. */
export async function savePhotoBytes(userId: string, bytes: Uint8Array): Promise<{ name: string } | { error: string }> {
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "Photo is too large (max 5 MB)." };
  const ext = sniff(bytes);
  if (!ext) return { error: "Photo must be a JPG, PNG or WebP image." };

  const name = `${userId}/${randomBytes(16).toString("hex")}.${ext}`;
  if (!SAFE_NAME.test(name)) return { error: "Couldn't save the photo." };
  await mkdir(filePath(userId), { recursive: true });
  await writeFile(filePath(name), bytes);
  return { name };
}

export async function readPhoto(name: string) {
  if (!SAFE_NAME.test(name)) return null;
  try {
    const data = await readFile(filePath(name));
    return { data, contentType: TYPES[name.split(".").pop() as Ext] };
  } catch {
    return null;
  }
}

export async function deletePhoto(name: string | null | undefined) {
  if (!name || !SAFE_NAME.test(name)) return;
  await rm(filePath(name), { force: true });
}

/** The uploaded file from a form field, or null if none was chosen. */
export function fileFrom(fd: FormData, field: string) {
  const value = fd.get(field);
  return value instanceof File && value.size > 0 ? value : null;
}

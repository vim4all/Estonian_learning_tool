import { createHash } from "node:crypto";
import type { Lang } from "./schema.ts";

function slugify(text: string): string {
  const transliterated = text
    .toLowerCase()
    .replace(/õ/g, "o")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/š/g, "s")
    .replace(/ž/g, "z");
  const slug = transliterated.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "clip";
}

export function audioFilename(lang: Lang, text: string, voiceKey: string): string {
  const hash = createHash("sha1").update(`${lang}:${voiceKey}:${text}`).digest("hex").slice(0, 8);
  return `${slugify(text)}-${hash}.mp3`;
}

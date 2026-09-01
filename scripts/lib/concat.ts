import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not resolve a binary path for this platform");
}

const FFMPEG = ffmpegPath as string;

export function ensureSilenceClip(outputPath: string, durationMs: number): void {
  if (existsSync(outputPath)) return;
  const seconds = (durationMs / 1000).toFixed(3);
  execFileSync(FFMPEG, [
    "-y",
    "-f", "lavfi",
    "-i", `anullsrc=r=44100:cl=mono`,
    "-t", seconds,
    "-q:a", "9",
    outputPath,
  ]);
}

export function concatFiles(inputPaths: string[], outputPath: string): void {
  const dir = mkdtempSync(join(tmpdir(), "estlrn-concat-"));
  const listPath = join(dir, "filelist.txt");
  const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(listPath, listContent, "utf-8");

  try {
    execFileSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  } catch {
    // Stream-copy concat can fail/glitch across clips with slightly different encoder params;
    // fall back to a full re-encode which is slower but robust.
    execFileSync(FFMPEG, [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:a", "libmp3lame", "-q:a", "2",
      outputPath,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

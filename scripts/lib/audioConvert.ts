import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not resolve a binary path for this platform");
}

const FFMPEG = ffmpegPath as string;

// Each TTS engine emits audio in whatever format/sample rate it chooses (WAV from TartuNLP and
// text2wav, MP3 from edge-tts). ffmpeg probes the actual content rather than trusting a file
// extension, so a single conversion path handles all of them. Forcing a consistent sample
// rate/channel layout here means every clip in a concatenated track — including the pre-generated
// silence clips — shares the same format, which is what lets `concat.ts` stream-copy clips
// together without pitch/speed glitches.
export function normalizeToMp3(audioBuffer: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "estlrn-tts-"));
  const inPath = join(dir, "in.audio");
  const mp3Path = join(dir, "out.mp3");
  writeFileSync(inPath, audioBuffer);
  try {
    execFileSync(FFMPEG, [
      "-y", "-i", inPath,
      "-ar", "44100", "-ac", "1",
      "-codec:a", "libmp3lame", "-q:a", "2",
      mp3Path,
    ]);
    return readFileSync(mp3Path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ffmpeg-static bundles ffmpeg but not ffprobe, so duration comes from parsing ffmpeg's own
// stderr banner (it prints "Duration: HH:MM:SS.ss" before erroring out on the missing -y output).
export function getDurationSeconds(filePath: string): number {
  try {
    execFileSync(FFMPEG, ["-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const [, h, m, s] = match;
      return Number(h) * 3600 + Number(m) * 60 + Number(s);
    }
  }
  throw new Error(`Could not determine duration for ${filePath}`);
}

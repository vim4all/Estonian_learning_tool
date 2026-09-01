import text2wav from "text2wav";
import { EdgeTTS } from "edge-tts-universal";
import type { VoiceConfig } from "./schema.ts";
import { normalizeToMp3 } from "./audioConvert.ts";

const TARTUNLP_ENDPOINT = "https://api.tartunlp.ai/text-to-speech/v2";
const TARTUNLP_TIMEOUT_MS = 30_000;

async function synthesizeEspeak(text: string, voice: Extract<VoiceConfig, { engine: "espeak" }>): Promise<Buffer> {
  const wav = await text2wav(text, { voice: voice.voice });
  return Buffer.from(wav);
}

async function synthesizeEdge(text: string, voice: Extract<VoiceConfig, { engine: "edge" }>): Promise<Buffer> {
  const tts = new EdgeTTS(text, voice.voice);
  const result = await tts.synthesize();
  return Buffer.from(await result.audio.arrayBuffer());
}

async function synthesizeTartuNlp(text: string, voice: Extract<VoiceConfig, { engine: "tartunlp" }>): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TARTUNLP_TIMEOUT_MS);
  try {
    const res = await fetch(TARTUNLP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speaker: voice.speaker, speed: voice.speed ?? 1 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`TartuNLP TTS request failed (${res.status}): ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// TartuNLP and edge-tts are both free services without a commercial SLA (edge-tts additionally
// rides an unofficial endpoint) — give each one retry before giving up, since transient failures
// under shared load are the expected failure mode, not a sign something's actually broken.
async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return withRetry(fn, retries - 1);
  }
}

export async function synthesize(text: string, voice: VoiceConfig): Promise<Buffer> {
  const audio =
    voice.engine === "espeak"
      ? await synthesizeEspeak(text, voice)
      : voice.engine === "edge"
        ? await withRetry(() => synthesizeEdge(text, voice))
        : await withRetry(() => synthesizeTartuNlp(text, voice));
  return normalizeToMp3(audio);
}

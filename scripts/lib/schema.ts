import { z } from "zod";

export const WordSchema = z.object({
  et: z.string().min(1),
  en: z.string().min(1),
  lemma: z.string().min(1),
  pos: z.string().min(1),
  ipa: z.string().min(1).optional(),
});

export const SentenceSchema = z.object({
  id: z.string().min(1),
  en: z.string().min(1),
  et: z.string().min(1),
  notes: z.string().optional(),
  words: z.array(WordSchema).min(1),
});

export const LessonSchema = z.object({
  id: z.string().min(1),
  title: z.object({
    en: z.string().min(1),
    et: z.string().min(1),
  }),
  level: z.string().min(1),
  order: z.number().int().nonnegative(),
  sentences: z.array(SentenceSchema).min(1),
});

// Book content: continuous narrative (chapters -> paragraphs -> sentences), for parallel-text
// reading rather than vocab drilling. Word glosses are optional and partial here — unlike lessons,
// nobody's going to gloss every word of a novel.
export const BookSentenceSchema = z.object({
  id: z.string().min(1),
  en: z.string().min(1),
  et: z.string().min(1),
  words: z.array(WordSchema).default([]),
});

export const ParagraphSchema = z.object({
  id: z.string().min(1),
  sentences: z.array(BookSentenceSchema).min(1),
});

export const ChapterSchema = z.object({
  id: z.string().min(1),
  title: z.object({
    en: z.string().min(1),
    et: z.string().min(1),
  }),
  order: z.number().int().nonnegative(),
  paragraphs: z.array(ParagraphSchema).min(1),
});

export const BookSchema = z.object({
  id: z.string().min(1),
  title: z.object({
    en: z.string().min(1),
    et: z.string().min(1),
  }),
  author: z.string().min(1),
  order: z.number().int().nonnegative(),
  chapters: z.array(ChapterSchema).min(1),
});

// "espeak" -> text2wav (self-contained WASM port of eSpeak-NG, fully offline, zero cost, but
//             robotic — kept as a fallback for offline use, not the default for any language).
// "edge" -> edge-tts-universal, Microsoft's free neural TTS (the engine behind Edge's Read Aloud
//           and Azure Cognitive Services), reached over its unofficial-but-widely-used public
//           WebSocket endpoint. No key, no signup — but not an officially documented API, so
//           treat it like TartuNLP: no uptime guarantee, retried once on failure.
// "tartunlp" -> TartuNLP's free public Estonian neural TTS API (https://api.tartunlp.ai/text-to-speech).
export const EspeakVoiceConfigSchema = z.object({
  engine: z.literal("espeak"),
  voice: z.string().min(1),
});

export const EdgeVoiceConfigSchema = z.object({
  engine: z.literal("edge"),
  voice: z.string().min(1),
});

export const TartuNlpVoiceConfigSchema = z.object({
  engine: z.literal("tartunlp"),
  speaker: z.string().min(1),
  speed: z.number().min(0.5).max(2).optional(),
});

export const VoiceConfigSchema = z.discriminatedUnion("engine", [
  EspeakVoiceConfigSchema,
  EdgeVoiceConfigSchema,
  TartuNlpVoiceConfigSchema,
]);

export const VoicesFileSchema = z.object({
  en: VoiceConfigSchema,
  et: VoiceConfigSchema,
});

export type Word = z.infer<typeof WordSchema>;
export type Sentence = z.infer<typeof SentenceSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type BookSentence = z.infer<typeof BookSentenceSchema>;
export type Paragraph = z.infer<typeof ParagraphSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Book = z.infer<typeof BookSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type VoicesFile = z.infer<typeof VoicesFileSchema>;

export type Lang = "en" | "et";

export function voiceId(voice: VoiceConfig): string {
  switch (voice.engine) {
    case "espeak":
      return `espeak:${voice.voice}`;
    case "edge":
      return `edge:${voice.voice}`;
    case "tartunlp":
      return `tartunlp:${voice.speaker}:${voice.speed ?? 1}`;
  }
}

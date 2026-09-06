import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBooks, loadLessons, loadVoices } from "./lib/contentLoader.ts";
import { audioFilename } from "./lib/audioKey.ts";
import { synthesize } from "./lib/ttsClient.ts";
import { concatFiles, ensureSilenceClip } from "./lib/concat.ts";
import { getDurationSeconds } from "./lib/audioConvert.ts";
import {
  voiceId,
  NATIVE_LANGS,
  type Book,
  type Lang,
  type Lesson,
  type NativeLang,
  type Sentence,
  type VoiceConfig,
} from "./lib/schema.ts";

// Audio field names are capitalized-suffix per language ("en" -> "audioEn"), so a NativeLang can be
// turned into the right key on enriched words/sentences without a lookup table.
function audioField(lang: NativeLang): "audioEn" | "audioUk" {
  return `audio${lang[0]!.toUpperCase()}${lang.slice(1)}` as "audioEn" | "audioUk";
}

type EnrichedWord = Sentence["words"][number] & { audioEt: string; audioEn: string; audioUk: string };
type EnrichedSentence = Omit<Sentence, "words"> & {
  audioEn: string;
  audioEt: string;
  audioUk: string;
  // Per-native-language cumulative offset into that language's own combined lesson track — English
  // and Ukrainian renderings of the same sentence differ in length, so the two tracks drift apart.
  audioStart: Record<NativeLang, number>;
  words: EnrichedWord[];
};

const ROOT = join(import.meta.dirname, "..");
const SITE_DIR = join(ROOT, "site");
const AUDIO_DIR = join(SITE_DIR, "audio");
const DATA_DIR = join(SITE_DIR, "data");
const CACHE_PATH = join(ROOT, ".cache", "tts-manifest.json");

const PAUSE_SHORT_MS = 500;
const PAUSE_LONG_MS = 1200;
const PAUSE_PARAGRAPH_MS = 2000;
const PAUSE_LESSON_MS = 3000;
const ALL_LESSONS_ID = "_all";
const BATCH_SIZE = 5;

const args = process.argv.slice(2);
const lessonFilter = args.includes("--lesson") ? args[args.indexOf("--lesson") + 1] : undefined;
const bookFilter = args.includes("--book") ? args[args.indexOf("--book") + 1] : undefined;
const force = args.includes("--force");

type ManifestEntry = { text: string; lang: Lang; voiceId: string; generatedAt: string };
type Manifest = Record<string, ManifestEntry>;

function loadManifest(): Manifest {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
}

function saveManifest(manifest: Manifest): void {
  mkdirSync(join(ROOT, ".cache"), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

async function ensureClip(
  kind: "words" | "sentences",
  lang: Lang,
  text: string,
  voice: VoiceConfig,
  manifest: Manifest
): Promise<string> {
  const vid = voiceId(voice);
  const filename = audioFilename(lang, text, vid);
  const relPath = `audio/${kind}/${lang}/${filename}`;
  const absPath = join(AUDIO_DIR, kind, lang, filename);

  if (!force && existsSync(absPath)) return relPath;

  ensureDir(join(AUDIO_DIR, kind, lang));
  console.log(`  synthesizing [${lang}] "${text}" -> ${kind}/${lang}/${filename}`);
  const buffer = await synthesize(text, voice);
  writeFileSync(absPath, buffer);
  manifest[filename] = { text, lang, voiceId: vid, generatedAt: new Date().toISOString() };
  return relPath;
}

async function main(): Promise<void> {
  const voices = loadVoices();
  let lessons = loadLessons();
  if (lessonFilter) {
    lessons = lessons.filter((l) => l.id === lessonFilter);
    if (lessons.length === 0) {
      console.error(`No lesson found with id "${lessonFilter}"`);
      process.exit(1);
    }
  }

  const manifest = loadManifest();

  ensureDir(join(AUDIO_DIR, "_shared"));
  const pauseShortPath = join(AUDIO_DIR, "_shared", "pause-short.mp3");
  const pauseLongPath = join(AUDIO_DIR, "_shared", "pause-long.mp3");
  const pauseParagraphPath = join(AUDIO_DIR, "_shared", "pause-paragraph.mp3");
  const pauseLessonPath = join(AUDIO_DIR, "_shared", "pause-lesson.mp3");
  ensureSilenceClip(pauseShortPath, PAUSE_SHORT_MS);
  ensureSilenceClip(pauseLongPath, PAUSE_LONG_MS);
  ensureSilenceClip(pauseParagraphPath, PAUSE_PARAGRAPH_MS);
  ensureSilenceClip(pauseLessonPath, PAUSE_LESSON_MS);
  const pauseShortDur = getDurationSeconds(pauseShortPath);
  const pauseLongDur = getDurationSeconds(pauseLongPath);
  const pauseLessonDur = getDurationSeconds(pauseLessonPath);

  ensureDir(join(DATA_DIR, "lessons"));
  ensureDir(join(AUDIO_DIR, "lessons"));

  const manifestIndex: { id: string; title: Lesson["title"]; level: string; order: number; sentenceCount: number }[] = [];
  const allLessonsEnriched: { lesson: Lesson; enrichedSentences: EnrichedSentence[] }[] = [];

  for (const lesson of lessons) {
    console.log(`Lesson: ${lesson.id} (${lesson.sentences.length} sentences)`);

    const enrichedSentences: EnrichedSentence[] = [];
    // One clip sequence + running offset per native language, since an EN and a UK rendering of the
    // same sentence differ in length and so drift apart minute by minute across a whole lesson.
    const lessonClipPaths: Record<NativeLang, string[]> = { en: [], uk: [] };
    const cumulativeSeconds: Record<NativeLang, number> = { en: 0, uk: 0 };

    for (const sentence of lesson.sentences) {
      const audioEt = await ensureClip("sentences", "et", sentence.et, voices.et, manifest);
      const audioStart = {} as Record<NativeLang, number>;
      const nativeAudio = {} as Record<NativeLang, string>;

      // Estonian plays first in every track — the learner hears/reads it before the native-language
      // translation, matching the "read/listen to Estonian, then check the translation" flow.
      for (const lang of NATIVE_LANGS) {
        const audio = await ensureClip("sentences", lang, sentence[lang], voices[lang], manifest);
        nativeAudio[lang] = audio;
        audioStart[lang] = cumulativeSeconds[lang];
        cumulativeSeconds[lang] += getDurationSeconds(join(SITE_DIR, audioEt)) + pauseShortDur;
        cumulativeSeconds[lang] += getDurationSeconds(join(SITE_DIR, audio)) + pauseLongDur;
        lessonClipPaths[lang].push(join(SITE_DIR, audioEt), pauseShortPath, join(SITE_DIR, audio), pauseLongPath);
      }

      const enrichedWords = [];
      for (const word of sentence.words) {
        const wordAudioEt = await ensureClip("words", "et", word.et, voices.et, manifest);
        const wordAudio = {} as Record<NativeLang, string>;
        for (const lang of NATIVE_LANGS) {
          wordAudio[lang] = await ensureClip("words", lang, word[lang], voices[lang], manifest);
        }
        enrichedWords.push({ ...word, audioEt: wordAudioEt, audioEn: wordAudio.en, audioUk: wordAudio.uk });
      }

      enrichedSentences.push({
        ...sentence,
        audioEn: nativeAudio.en,
        audioUk: nativeAudio.uk,
        audioEt,
        audioStart,
        words: enrichedWords,
      });
    }

    const lessonAudio = {} as Record<NativeLang, string>;
    for (const lang of NATIVE_LANGS) {
      const rel = `audio/lessons/${lesson.id}-${lang}.mp3`;
      console.log(`  concatenating lesson track [${lang}] -> ${rel}`);
      concatFiles(lessonClipPaths[lang], join(SITE_DIR, rel));
      lessonAudio[lang] = rel;
    }

    const lessonData = {
      id: lesson.id,
      title: lesson.title,
      level: lesson.level,
      order: lesson.order,
      lessonAudio,
      sentences: enrichedSentences,
    };
    writeFileSync(join(DATA_DIR, "lessons", `${lesson.id}.json`), JSON.stringify(lessonData, null, 2), "utf-8");

    manifestIndex.push({
      id: lesson.id,
      title: lesson.title,
      level: lesson.level,
      order: lesson.order,
      sentenceCount: lesson.sentences.length,
    });
    allLessonsEnriched.push({ lesson, enrichedSentences });
  }

  // Builds one concatenated "meta lesson" spanning several real lessons back to back (a longer
  // pause at each lesson boundary than between sentences within one), writes its data/audio, and
  // returns its manifest entry. Used both for the single "everything" track and for batches of
  // BATCH_SIZE lessons.
  function buildCombinedLesson(
    id: string,
    title: Lesson["title"],
    order: number,
    group: { lesson: Lesson; enrichedSentences: EnrichedSentence[] }[]
  ) {
    console.log(`Combined: ${id} (${group.length} lessons)`);

    const clipPaths: Record<NativeLang, string[]> = { en: [], uk: [] };
    const cumulativeSeconds: Record<NativeLang, number> = { en: 0, uk: 0 };
    const sentences: (EnrichedSentence & { lessonId: string; lessonTitle: Lesson["title"] })[] = [];

    for (const { lesson, enrichedSentences } of group) {
      enrichedSentences.forEach((sentence, i) => {
        const isLastOfLesson = i === enrichedSentences.length - 1;
        const trailingPausePath = isLastOfLesson ? pauseLessonPath : pauseLongPath;
        const trailingPauseDur = isLastOfLesson ? pauseLessonDur : pauseLongDur;

        const audioStart = {} as Record<NativeLang, number>;
        for (const lang of NATIVE_LANGS) {
          audioStart[lang] = cumulativeSeconds[lang];
          cumulativeSeconds[lang] += getDurationSeconds(join(SITE_DIR, sentence.audioEt)) + pauseShortDur;
          cumulativeSeconds[lang] += getDurationSeconds(join(SITE_DIR, sentence[audioField(lang)])) + trailingPauseDur;
          clipPaths[lang].push(
            join(SITE_DIR, sentence.audioEt),
            pauseShortPath,
            join(SITE_DIR, sentence[audioField(lang)]),
            trailingPausePath
          );
        }

        sentences.push({ ...sentence, audioStart, lessonId: lesson.id, lessonTitle: lesson.title });
      });
    }

    const lessonAudio = {} as Record<NativeLang, string>;
    for (const lang of NATIVE_LANGS) {
      const rel = `audio/lessons/${id}-${lang}.mp3`;
      console.log(`  concatenating combined track [${lang}] -> ${rel}`);
      concatFiles(clipPaths[lang], join(SITE_DIR, rel));
      lessonAudio[lang] = rel;
    }

    const level = [...new Set(group.map(({ lesson }) => lesson.level))].join("–");
    const data = { id, title, level, order, lessonAudio, sentences };
    writeFileSync(join(DATA_DIR, "lessons", `${id}.json`), JSON.stringify(data, null, 2), "utf-8");

    return { id, title, level, order, sentenceCount: sentences.length };
  }

  // Combined playthroughs only make sense over the complete set, so skip them on a --lesson-scoped
  // run (which only has one lesson's data in memory, not the full picture) — same reasoning as
  // skipping the manifest rewrite below.
  if (!lessonFilter && allLessonsEnriched.length > 0) {
    manifestIndex.push(
      buildCombinedLesson(
        ALL_LESSONS_ID,
        { en: "All Lessons", et: "Kõik tunnid", uk: "Усі уроки" },
        -1,
        allLessonsEnriched
      )
    );

    for (let i = 0; i < allLessonsEnriched.length; i += BATCH_SIZE) {
      const group = allLessonsEnriched.slice(i, i + BATCH_SIZE);
      if (group.length < 2) continue; // a lone leftover lesson isn't worth a redundant "batch of 1"

      const batchNumber = i / BATCH_SIZE + 1;
      const firstTitle = group[0]!.lesson.title;
      const lastTitle = group[group.length - 1]!.lesson.title;
      const title = {
        en: `Unit ${batchNumber}: ${firstTitle.en} – ${lastTitle.en}`,
        et: `Osa ${batchNumber}: ${firstTitle.et} – ${lastTitle.et}`,
        uk: `Частина ${batchNumber}: ${firstTitle.uk} – ${lastTitle.uk}`,
      };
      manifestIndex.push(buildCombinedLesson(`batch-${batchNumber}`, title, -1 + batchNumber * 0.01, group));
    }
  }

  // Only rewrite the top-level manifest for the full set of lessons (not a --lesson-scoped subset),
  // so a scoped run for fast iteration doesn't clobber the picker with a partial lesson list.
  if (!lessonFilter) {
    writeFileSync(join(DATA_DIR, "manifest.json"), JSON.stringify(manifestIndex.sort((a, b) => a.order - b.order), null, 2), "utf-8");
  }

  let books = loadBooks();
  if (bookFilter) {
    books = books.filter((b) => b.id === bookFilter);
    if (books.length === 0) {
      console.error(`No book found with id "${bookFilter}"`);
      process.exit(1);
    }
  }

  ensureDir(join(DATA_DIR, "books"));
  ensureDir(join(AUDIO_DIR, "books"));

  const booksIndex: {
    id: string;
    title: Book["title"];
    author: string;
    order: number;
    chapters: { id: string; title: Book["chapters"][number]["title"]; order: number; paragraphCount: number }[];
  }[] = [];

  for (const book of books) {
    console.log(`Book: ${book.id} (${book.chapters.length} chapters)`);
    ensureDir(join(AUDIO_DIR, "books", book.id));

    const enrichedChapters = [];
    for (const chapter of book.chapters) {
      console.log(`  Chapter: ${chapter.id} (${chapter.paragraphs.length} paragraphs)`);

      const chapterClipPaths: Record<NativeLang, string[]> = { en: [], uk: [] };
      const enrichedParagraphs = [];

      for (const paragraph of chapter.paragraphs) {
        const enrichedSentences = [];
        for (const sentence of paragraph.sentences) {
          const audioEt = await ensureClip("sentences", "et", sentence.et, voices.et, manifest);
          const nativeAudio = {} as Record<NativeLang, string>;
          for (const lang of NATIVE_LANGS) {
            const audio = await ensureClip("sentences", lang, sentence[lang], voices[lang], manifest);
            nativeAudio[lang] = audio;
            chapterClipPaths[lang].push(join(SITE_DIR, audioEt), pauseShortPath, join(SITE_DIR, audio), pauseLongPath);
          }

          const enrichedWords = [];
          for (const word of sentence.words) {
            const wordAudioEt = await ensureClip("words", "et", word.et, voices.et, manifest);
            const wordAudio = {} as Record<NativeLang, string>;
            for (const lang of NATIVE_LANGS) {
              wordAudio[lang] = await ensureClip("words", lang, word[lang], voices[lang], manifest);
            }
            enrichedWords.push({ ...word, audioEt: wordAudioEt, audioEn: wordAudio.en, audioUk: wordAudio.uk });
          }

          enrichedSentences.push({ ...sentence, audioEn: nativeAudio.en, audioUk: nativeAudio.uk, audioEt, words: enrichedWords });
        }
        // Swap the trailing sentence pause for a longer paragraph break, in every language's track.
        for (const lang of NATIVE_LANGS) {
          chapterClipPaths[lang][chapterClipPaths[lang].length - 1] = pauseParagraphPath;
        }
        enrichedParagraphs.push({ ...paragraph, sentences: enrichedSentences });
      }

      const chapterAudio = {} as Record<NativeLang, string>;
      for (const lang of NATIVE_LANGS) {
        const rel = `audio/books/${book.id}/${chapter.id}-${lang}.mp3`;
        console.log(`    concatenating chapter track [${lang}] -> ${rel}`);
        concatFiles(chapterClipPaths[lang], join(SITE_DIR, rel));
        chapterAudio[lang] = rel;
      }

      enrichedChapters.push({ ...chapter, chapterAudio, paragraphs: enrichedParagraphs });
    }

    const bookData = {
      id: book.id,
      title: book.title,
      author: book.author,
      order: book.order,
      chapters: enrichedChapters,
    };
    writeFileSync(join(DATA_DIR, "books", `${book.id}.json`), JSON.stringify(bookData, null, 2), "utf-8");

    booksIndex.push({
      id: book.id,
      title: book.title,
      author: book.author,
      order: book.order,
      chapters: book.chapters
        .map((c) => ({ id: c.id, title: c.title, order: c.order, paragraphCount: c.paragraphs.length }))
        .sort((a, b) => a.order - b.order),
    });
  }

  if (!bookFilter) {
    writeFileSync(
      join(DATA_DIR, "books-manifest.json"),
      JSON.stringify(booksIndex.sort((a, b) => a.order - b.order), null, 2),
      "utf-8"
    );
  }

  saveManifest(manifest);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

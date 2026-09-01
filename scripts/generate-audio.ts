import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBooks, loadLessons, loadVoices } from "./lib/contentLoader.ts";
import { audioFilename } from "./lib/audioKey.ts";
import { synthesize } from "./lib/ttsClient.ts";
import { concatFiles, ensureSilenceClip } from "./lib/concat.ts";
import { getDurationSeconds } from "./lib/audioConvert.ts";
import { voiceId, type Book, type Lang, type Lesson, type Sentence, type VoiceConfig } from "./lib/schema.ts";

type EnrichedWord = Sentence["words"][number] & { audioEt: string; audioEn: string };
type EnrichedSentence = Omit<Sentence, "words"> & {
  audioEn: string;
  audioEt: string;
  audioStart: number;
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
    const lessonClipPaths: string[] = [];
    let cumulativeSeconds = 0;

    for (const sentence of lesson.sentences) {
      const audioEn = await ensureClip("sentences", "en", sentence.en, voices.en, manifest);
      const audioEt = await ensureClip("sentences", "et", sentence.et, voices.et, manifest);

      const audioStart = cumulativeSeconds;
      cumulativeSeconds += getDurationSeconds(join(SITE_DIR, audioEn)) + pauseShortDur;
      cumulativeSeconds += getDurationSeconds(join(SITE_DIR, audioEt)) + pauseLongDur;

      lessonClipPaths.push(join(SITE_DIR, audioEn), pauseShortPath, join(SITE_DIR, audioEt), pauseLongPath);

      const enrichedWords = [];
      for (const word of sentence.words) {
        const wordAudioEt = await ensureClip("words", "et", word.et, voices.et, manifest);
        const wordAudioEn = await ensureClip("words", "en", word.en, voices.en, manifest);
        enrichedWords.push({ ...word, audioEt: wordAudioEt, audioEn: wordAudioEn });
      }

      enrichedSentences.push({ ...sentence, audioEn, audioEt, audioStart, words: enrichedWords });
    }

    const lessonAudioRel = `audio/lessons/${lesson.id}.mp3`;
    const lessonAudioAbs = join(SITE_DIR, lessonAudioRel);
    console.log(`  concatenating lesson track -> ${lessonAudioRel}`);
    concatFiles(lessonClipPaths, lessonAudioAbs);

    const lessonData = {
      id: lesson.id,
      title: lesson.title,
      level: lesson.level,
      order: lesson.order,
      lessonAudio: lessonAudioRel,
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

    const clipPaths: string[] = [];
    const sentences: (EnrichedSentence & { lessonId: string; lessonTitle: Lesson["title"] })[] = [];
    let cumulativeSeconds = 0;

    for (const { lesson, enrichedSentences } of group) {
      enrichedSentences.forEach((sentence, i) => {
        const isLastOfLesson = i === enrichedSentences.length - 1;
        const trailingPausePath = isLastOfLesson ? pauseLessonPath : pauseLongPath;
        const trailingPauseDur = isLastOfLesson ? pauseLessonDur : pauseLongDur;

        const audioStart = cumulativeSeconds;
        cumulativeSeconds += getDurationSeconds(join(SITE_DIR, sentence.audioEn)) + pauseShortDur;
        cumulativeSeconds += getDurationSeconds(join(SITE_DIR, sentence.audioEt)) + trailingPauseDur;

        clipPaths.push(join(SITE_DIR, sentence.audioEn), pauseShortPath, join(SITE_DIR, sentence.audioEt), trailingPausePath);
        sentences.push({ ...sentence, audioStart, lessonId: lesson.id, lessonTitle: lesson.title });
      });
    }

    const audioRel = `audio/lessons/${id}.mp3`;
    console.log(`  concatenating combined track -> ${audioRel}`);
    concatFiles(clipPaths, join(SITE_DIR, audioRel));

    const level = [...new Set(group.map(({ lesson }) => lesson.level))].join("–");
    const data = { id, title, level, order, lessonAudio: audioRel, sentences };
    writeFileSync(join(DATA_DIR, "lessons", `${id}.json`), JSON.stringify(data, null, 2), "utf-8");

    return { id, title, level, order, sentenceCount: sentences.length };
  }

  // Combined playthroughs only make sense over the complete set, so skip them on a --lesson-scoped
  // run (which only has one lesson's data in memory, not the full picture) — same reasoning as
  // skipping the manifest rewrite below.
  if (!lessonFilter && allLessonsEnriched.length > 0) {
    manifestIndex.push(
      buildCombinedLesson(ALL_LESSONS_ID, { en: "All Lessons", et: "Kõik tunnid" }, -1, allLessonsEnriched)
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

      const chapterClipPaths: string[] = [];
      const enrichedParagraphs = [];

      for (const paragraph of chapter.paragraphs) {
        const enrichedSentences = [];
        for (const sentence of paragraph.sentences) {
          const audioEn = await ensureClip("sentences", "en", sentence.en, voices.en, manifest);
          const audioEt = await ensureClip("sentences", "et", sentence.et, voices.et, manifest);
          chapterClipPaths.push(join(SITE_DIR, audioEn), pauseShortPath, join(SITE_DIR, audioEt), pauseLongPath);

          const enrichedWords = [];
          for (const word of sentence.words) {
            const wordAudioEt = await ensureClip("words", "et", word.et, voices.et, manifest);
            const wordAudioEn = await ensureClip("words", "en", word.en, voices.en, manifest);
            enrichedWords.push({ ...word, audioEt: wordAudioEt, audioEn: wordAudioEn });
          }

          enrichedSentences.push({ ...sentence, audioEn, audioEt, words: enrichedWords });
        }
        // Swap the trailing sentence pause for a longer paragraph break.
        chapterClipPaths[chapterClipPaths.length - 1] = pauseParagraphPath;
        enrichedParagraphs.push({ ...paragraph, sentences: enrichedSentences });
      }

      const chapterAudioRel = `audio/books/${book.id}/${chapter.id}.mp3`;
      const chapterAudioAbs = join(SITE_DIR, chapterAudioRel);
      console.log(`    concatenating chapter track -> ${chapterAudioRel}`);
      concatFiles(chapterClipPaths, chapterAudioAbs);

      enrichedChapters.push({ ...chapter, chapterAudio: chapterAudioRel, paragraphs: enrichedParagraphs });
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

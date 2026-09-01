import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BookSchema, LessonSchema, VoicesFileSchema, type Book, type Lesson, type VoicesFile } from "./schema.ts";

const CONTENT_DIR = join(import.meta.dirname, "..", "..", "content");
const LESSONS_DIR = join(CONTENT_DIR, "lessons");
const BOOKS_DIR = join(CONTENT_DIR, "books");

export class ContentValidationError extends Error {}

export function loadLessons(): Lesson[] {
  const files = readdirSync(LESSONS_DIR).filter((f) => f.endsWith(".json")).sort();
  const lessons: Lesson[] = [];
  const seenLessonIds = new Set<string>();
  const seenSentenceIds = new Set<string>();

  for (const file of files) {
    const raw = readFileSync(join(LESSONS_DIR, file), "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ContentValidationError(`${file}: invalid JSON — ${(err as Error).message}`);
    }

    const result = LessonSchema.safeParse(parsed);
    if (!result.success) {
      throw new ContentValidationError(
        `${file}: schema validation failed — ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }

    const lesson = result.data;

    if (seenLessonIds.has(lesson.id)) {
      throw new ContentValidationError(`${file}: duplicate lesson id "${lesson.id}"`);
    }
    seenLessonIds.add(lesson.id);

    for (const sentence of lesson.sentences) {
      if (seenSentenceIds.has(sentence.id)) {
        throw new ContentValidationError(
          `${file}: duplicate sentence id "${sentence.id}" (sentence ids must be unique across all lessons)`
        );
      }
      seenSentenceIds.add(sentence.id);
    }

    lessons.push(lesson);
  }

  return lessons.sort((a, b) => a.order - b.order);
}

export function loadBooks(): Book[] {
  if (!existsSync(BOOKS_DIR)) return [];
  const files = readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json")).sort();
  const books: Book[] = [];
  const seenBookIds = new Set<string>();
  const seenChapterIds = new Set<string>();
  const seenParagraphIds = new Set<string>();
  const seenSentenceIds = new Set<string>();

  for (const file of files) {
    const raw = readFileSync(join(BOOKS_DIR, file), "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ContentValidationError(`${file}: invalid JSON — ${(err as Error).message}`);
    }

    const result = BookSchema.safeParse(parsed);
    if (!result.success) {
      throw new ContentValidationError(
        `${file}: schema validation failed — ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }

    const book = result.data;

    if (seenBookIds.has(book.id)) {
      throw new ContentValidationError(`${file}: duplicate book id "${book.id}"`);
    }
    seenBookIds.add(book.id);

    for (const chapter of book.chapters) {
      if (seenChapterIds.has(chapter.id)) {
        throw new ContentValidationError(`${file}: duplicate chapter id "${chapter.id}"`);
      }
      seenChapterIds.add(chapter.id);

      for (const paragraph of chapter.paragraphs) {
        if (seenParagraphIds.has(paragraph.id)) {
          throw new ContentValidationError(`${file}: duplicate paragraph id "${paragraph.id}"`);
        }
        seenParagraphIds.add(paragraph.id);

        for (const sentence of paragraph.sentences) {
          if (seenSentenceIds.has(sentence.id)) {
            throw new ContentValidationError(`${file}: duplicate sentence id "${sentence.id}"`);
          }
          seenSentenceIds.add(sentence.id);
        }
      }
    }

    books.push(book);
  }

  return books.sort((a, b) => a.order - b.order);
}

export function loadVoices(): VoicesFile {
  const raw = readFileSync(join(CONTENT_DIR, "voices.json"), "utf-8");
  const parsed = JSON.parse(raw);
  const result = VoicesFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ContentValidationError(
      `voices.json: schema validation failed — ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return result.data;
}

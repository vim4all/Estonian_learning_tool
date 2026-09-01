import { ContentValidationError, loadBooks, loadLessons, loadVoices } from "./lib/contentLoader.ts";
import { voiceId } from "./lib/schema.ts";

try {
  const voices = loadVoices();
  const lessons = loadLessons();
  const books = loadBooks();

  let sentenceCount = 0;
  let wordCount = 0;
  for (const lesson of lessons) {
    sentenceCount += lesson.sentences.length;
    for (const sentence of lesson.sentences) wordCount += sentence.words.length;
  }

  console.log(`OK — ${lessons.length} lesson(s), ${sentenceCount} sentence(s), ${wordCount} word gloss(es)`);
  console.log(`Voices: en=${voiceId(voices.en)}, et=${voiceId(voices.et)}`);
  for (const lesson of lessons) {
    console.log(`  [${lesson.order}] ${lesson.id} (${lesson.level}) — ${lesson.sentences.length} sentences`);
  }

  let bookSentenceCount = 0;
  let bookParagraphCount = 0;
  for (const book of books) {
    for (const chapter of book.chapters) {
      for (const paragraph of chapter.paragraphs) {
        bookParagraphCount++;
        bookSentenceCount += paragraph.sentences.length;
      }
    }
  }
  console.log(`OK — ${books.length} book(s), ${bookParagraphCount} paragraph(s), ${bookSentenceCount} sentence(s)`);
  for (const book of books) {
    console.log(`  [${book.order}] ${book.id} — ${book.chapters.length} chapter(s)`);
    for (const chapter of book.chapters) {
      console.log(`    [${chapter.order}] ${chapter.id} — ${chapter.paragraphs.length} paragraph(s)`);
    }
  }
} catch (err) {
  if (err instanceof ContentValidationError) {
    console.error(`Content validation failed:\n  ${err.message}`);
    process.exit(1);
  }
  throw err;
}

# EstLrn

An Estonian learning tool for English or Ukrainian speakers, served as a plain static site with three modes. Every sentence and word gloss exists in English *and* Ukrainian; an **EN/UK** toggle in the header (persisted in the browser, applies across all three modes) switches which one pairs with Estonian everywhere on the site.

- **Lessons** (`index.html`) — short vocab-drilling sentence carousel, one pair at a time, word chips with IPA, plus a 🔀 **Random** button to jump to an arbitrary sentence in the current lesson. A 35-lesson A0→B1 course ships by default, in 7 units of 5:
  1. **A0 Foundations** — Alphabet, Greetings, Personal Pronouns, Numbers, Question Words
  2. **A1 Everyday Life** — Family, Colors, Days of the Week, Food & Drink, Places in Town
  3. **A1/A2 Practical Life** — Weather, Telling Time, Clothing, Shopping, Daily Routine
  4. **A2 Expanding World** — House & Home, Body & Health, Hobbies & Free Time, Work & Professions, Nationalities & Countries
  5. **A2 Consolidation** — Past Tense Basics, Making Plans, Describing People, Travel & Transportation, Restaurant & Ordering
  6. **B1 Grammar in Use I** — Comparatives & Superlatives, Cases in Context: Location, Giving Reasons, Opinions & Preferences, Conditional Mood
  7. **B1 Grammar in Use II** — Necessity & Obligation, Permission & Ability, Reported Speech, Connecting Ideas, Time & Sequencing

  The B1 units are grammar-in-use rather than vocab lists (comparatives, the full internal/external location-case sets, conditional mood, three different "can"s, reported speech...) and are a genuine step up in how much can go grammatically wrong in LLM-generated Estonian — worth a native-speaker skim more than the earlier units.

  The picker also auto-generates combined playthroughs: **All Lessons** (all 35, back to back) and **Unit 1–7** entries that batch every `BATCH_SIZE` (5) consecutive lessons together (a lesson `order` doesn't have to match its filename's `NN-` prefix — a leftover that doesn't fill a full batch of `BATCH_SIZE` wouldn't get its own redundant one-lesson "unit", though with exactly 35 lessons that doesn't currently happen). All combined tracks reuse the same carousel, word chips, and "Play full lesson" card-sync as a single lesson — they're really just lessons made of other lessons, with a topic tag showing which original lesson each sentence came from and a longer pause at each lesson boundary. A **Loop** checkbox next to "Play full lesson" makes whichever one is loaded repeat indefinitely once it reaches the end, for passive-listening practice. A **Stop** button next to it stops and resets whatever's currently playing (full track or an individual clip).
- **Book** (`book.html`) — parallel-text reading: chapters of paragraphs, native language above/Estonian below each sentence, click-to-play per sentence or per word, a continuous "Play chapter" bilingual audio track, and an "immersion mode" toggle that hides the translation.
- **Quiz** (`quiz.html`) — a 4-choice vocabulary test built from every word already glossed across the lessons (~240 unique Estonian words), asking either direction (Estonian → your language or the reverse) at random each question, with a 🔊 button to hear the prompt and a running score.

All audio is generated once, ahead of time, 100% free — no accounts, no API keys, no billing.

## Status

Everything below is built, generated, and verified working end-to-end (headless-browser-driven, not just "the script ran") — not a roadmap:

- [x] Static site, three modes (Lessons carousel + Book parallel-text reader + vocabulary Quiz), zero backend
- [x] Fully free TTS pipeline — TartuNLP (Estonian neural voices) + edge-tts-universal (English and Ukrainian neural voices), no accounts/keys/billing anywhere; `espeak`/`text2wav` wired up as an offline fallback engine
- [x] Full 35-lesson A0→B1 course, 349 sentences, in 7 units of 5 (see the syllabus above) — every sentence and word gloss exists in both English and Ukrainian
- [x] EN/UK native-language toggle, applies across all three modes and persists across reloads
- [x] Word-chip vocabulary glosses with IPA on every lesson sentence
- [x] 🔀 Random button (Lessons) and 4-choice vocabulary Quiz built from the full glossed-word set
- [x] Auto-generated combined playthroughs: **All Lessons** and **Unit 1–7**, built from the same per-lesson audio with longer pauses at lesson/unit boundaries
- [x] "Play full lesson" with live carousel sync — the card follows whichever sentence is currently sounding, not just plays audio alongside a static card
- [x] **Loop** toggle for continuous/passive-listening playback, works on any lesson or combined track
- [x] **Stop** button that stops and resets whatever's currently playing (full track or an individual clip), on both the lesson and book pages
- [x] Book reader: one demo chapter ("The Drawing", Little-Prince-inspired original content — see note below), inline clickable word glosses, per-sentence and per-chapter playback, **immersion mode** (hide English)

**Discussed but deliberately not built (yet):**
- Obsidian spaced-repetition integration — explored the user's existing vault, found real overlap with their Estonian vocab/phrases SR decks and their "Bilingual Reader" Birkenbihl-method template (which is missing exactly the audio EstLrn generates for free); paused per "stop with Obsidian for now"
- In-app spaced repetition / progress tracking (no vault involved)
- Playback speed control, remembering last lesson/position across reloads

## A note on the book content

`content/books/little-prince.json` is **not** a copy of any published translation of *The Little Prince*. The French original is public domain, but the specific English and Estonian translations you'd find in a bookstore are separately copyrighted by their translators — reproducing those would be a real problem. What's there instead is an original EN/ET passage I (Claude) wrote myself, inspired by the well-known (and not copyrightable) plot of the opening chapter — the child's drawing of a boa constrictor that grown-ups mistake for a hat. It's a demo of the book-reader format, not the actual book.

If you want the real text: paste in content from a copy you own (typed or OCR'd) in the same JSON shape, and everything downstream — audio generation, the reader UI — works unchanged. Note that generating full audio narration of someone else's copyrighted translation and distributing it would raise the same issue as reproducing the text; for strictly personal, unpublished use this is a much grayer area, but it's your call to make, not mine to make for you.

## How the audio is generated — fully free, no billing, no signup

- **Estonian**: [TartuNLP's public neural TTS API](https://neurokone.ee/) (`api.tartunlp.ai`), built by the University of Tartu's NLP research group specifically for Estonian. Free, open (MIT-licensed API, no API key), 11 Estonian speaker voices. It's a research-group service, not a commercial product — there's no SLA, so `scripts/lib/ttsClient.ts` retries once on failure, but expect occasional hiccups under shared load.
- **English and Ukrainian**: both via [`edge-tts-universal`](https://www.npmjs.com/package/edge-tts-universal), which reaches Microsoft's neural TTS service (the same engine behind Edge's Read Aloud and Azure Cognitive Services) over its free public endpoint — `en-US-AriaNeural` for English, `uk-UA-PolinaNeural` for Ukrainian. No key, no signup — genuinely natural-sounding, not the robotic default you'd get from an offline formant synthesizer. Caveat: this endpoint isn't an officially documented public API, just a very widely-used one (the underlying technique has thousands of dependents) — same "no SLA, retried once" treatment as TartuNLP. If it ever stops working, `content/voices.json`'s `en`/`uk` engine can be switched to `espeak` (using the bundled `text2wav`, fully offline but robotic) as a fallback with no other code changes.

Both clips get converted to a consistent MP3 format (44.1kHz mono) via `ffmpeg-static` (a bundled ffmpeg binary, no system install needed either) before being saved and concatenated into lesson tracks.

## Setup

Just `npm install` — that's it, no accounts, no credentials, no billing.

## Workflow

- **Author content**: add/edit lesson JSON in `content/lessons/` (shape: `content/lessons/00-greetings.json`; the `NN-` filename prefix doesn't drive ordering, the `order` field inside the file does) or book JSON in `content/books/` (shape: `content/books/little-prince.json`, chapters → paragraphs → sentences, word glosses optional). Every title, sentence, and glossed word needs `en`, `et`, *and* `uk` fields. Ask Claude (in a normal chat) to draft new content directly in the matching JSON shape, then proofread before saving.
- **Validate**: `npm run validate` — schema + duplicate-id checks for both lessons and books, no network calls.
- **Generate audio**: `npm run generate-audio` (add `--lesson <id>` or `--book <id>` to scope to one while iterating, `--force` to regenerate everything). Idempotent — already-generated clips are skipped on re-runs, so adding one new chapter only pays for that chapter's new sentences.
- **Preview**: `npm run serve`, then open the printed local URL. (Opening the HTML files directly via `file://` can break `fetch()` of the JSON data in some browsers.)

## Structure

- `content/` — source of truth: lesson JSON, book JSON, `voices.json`. Hand-authored, git-tracked.
  - `voices.json` picks the engine per language: `{"engine": "tartunlp", "speaker": "mari", "speed": 1}` for Estonian (see available speakers below), `{"engine": "edge", "voice": "en-US-AriaNeural"}` for English, `{"engine": "edge", "voice": "uk-UA-PolinaNeural"}` for Ukrainian. To list other Edge voice names (swap the locale prefix, e.g. `uk-` for Ukrainian ones): `node --input-type=module -e "import { listVoices } from 'edge-tts-universal'; console.log((await listVoices()).filter(v => v.Locale.startsWith('en-')).map(v => v.ShortName))"`.
- `scripts/` — the generation pipeline (TypeScript, run via `tsx`). `generate-audio.ts` handles lessons, books, and the combined tracks (`buildCombinedLesson`), sharing the same per-clip synthesis/caching (`ensureClip`) but with different pause pacing for each: short/long pauses within a lesson, an extra paragraph pause in book chapters, an extra (longer) lesson-boundary pause in any combined track. Combined tracks are only rebuilt on a full (non `--lesson`-scoped) run; ids `_all` and `batch-N` are reserved — don't name a real lesson that.
- `site/` — the static site. `index.html`/`js/app.js` is the lesson carousel; `book.html`/`js/book.js` is the parallel-text reader; `quiz.html`/`js/quiz.js` is the vocabulary quiz; `js/lang.js` holds the shared EN/UK toggle (localStorage-backed) all three pages load before their own script. `site/audio/` and `site/data/` are generated output (gitignored) and can be deleted/regenerated at any time.

## Estonian speakers available via TartuNLP

`albert`, `indrek`, `kalev`, `kylli`, `lee`, `liivika`, `luukas`, `mari`, `meelis`, `peeter`, `tambet`, `vesta` — plus `sulev`/`hella` for Võro. Swap `content/voices.json`'s `et.speaker` to try a different voice (this changes the audio hash, so it'll regenerate everything for that language on the next `generate-audio` run). Check `https://api.tartunlp.ai/text-to-speech/v2` (GET) for the current live list.

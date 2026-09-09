# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

EstLrn is an Estonian language-learning tool for English- or Ukrainian-speaking learners: a build-time content pipeline generates TTS audio once (100% free, no accounts/keys/billing), then a plain static site (no backend, no bundler) serves it as a lesson carousel (`site/index.html`), a parallel-text book reader (`site/book.html`), a vocabulary quiz (`site/quiz.html`), and sentence-level practice (`site/practice.html`). Every sentence and word gloss carries `en`, `et`, and `uk` fields; an EN/UK toggle (`site/js/lang.js`) picks which native language pairs with Estonian, site-wide. Progress (per-word spaced-repetition history, daily streak) lives in `localStorage` via `site/js/progress.js` — no accounts, no backend. See `README.md` for the full feature list and user-facing rationale — this file covers what you need to work on the code.

## Commands

```bash
npm install              # only setup step; no accounts/credentials needed
npm run validate         # schema + duplicate-id checks for all content, no network calls
npm run generate-audio   # full pipeline: TTS -> mp3s -> concatenated tracks -> site/data/*.json
npm run serve            # npx serve site, for local preview
npx tsc --noEmit         # type-check scripts/ (not wired into package.json, but the standard check before considering a change to scripts/ done)
```

Useful flags on `generate-audio`:
- `--lesson <id>` / `--book <id>` — scope to one lesson/book while iterating (skips rebuilding the combined "All Lessons"/`batch-N` tracks and the top-level manifests, since those need the complete set)
- `--force` — regenerate even already-cached clips

There is no test suite and no linter configured. `npm run validate` (schema validation) and `npx tsc --noEmit` (type-check) are the two automated checks that exist; treat a content or pipeline change as verified only after both pass. For UI changes, there's no dev-server hot reload — run `npm run generate-audio` (if content changed) then `npm run serve` and actually check the page.

**Deployment**: `.github/workflows/deploy.yml` deploys `site/` to GitHub Pages on every push to `main`. The CI runner has no `.cache/` or `site/audio/`/`site/data/` from a previous run (both gitignored), so every push triggers a *full* `npm run generate-audio` from scratch — hundreds of live TTS calls to TartuNLP and edge-tts, both explicitly no-SLA free services. A push to `main` can therefore fail or take a while for reasons unrelated to the code change itself; that's expected, not a sign something broke.

## Architecture

Three-stage pipeline, one direction: **`content/` (hand-authored, git-tracked) → `scripts/` (generation, TypeScript via `tsx`) → `site/audio/` + `site/data/` (generated, gitignored, safe to delete and regenerate)**. `site/*.html`/`site/js/` are hand-written static frontend, not generated.

### Content schema (`scripts/lib/schema.ts`)

Two content shapes, both zod-validated. Every title, sentence, and word object requires `en`, `et`, and `uk` fields (`et` is the fixed target language; `en`/`uk` are the two selectable native languages — see `NativeLang`/`NATIVE_LANGS` in schema.ts):
- **Lessons** (`content/lessons/*.json`) — flat `sentences[]`, each with mandatory `words[]` glosses (vocab-drilling use case). `order` (not the filename's `NN-` prefix) controls sequencing everywhere; filenames and `order` are allowed to disagree.
- **Books** (`content/books/*.json`) — `chapters[] -> paragraphs[] -> sentences[]`, word glosses optional/partial (reading use case, not every word needs a gloss).

`content/voices.json` selects a TTS engine per language (`en`, `et`, `uk`) via a discriminated union on `engine`: `"tartunlp"` (Estonian, speaker + speed), `"edge"` (Microsoft neural voices, used for English and Ukrainian), or `"espeak"` (offline `text2wav` fallback, any language). `voiceId()` in schema.ts turns a voice config into the cache-key string used for audio filenames — changing a voice changes the hash, so it naturally invalidates and regenerates only the affected language's clips on the next run.

### Generation pipeline (`scripts/generate-audio.ts` + `scripts/lib/`)

- `ttsClient.ts` — dispatches to the right engine (`tartunlp` HTTP API / `edge-tts-universal` / `text2wav`) and normalizes the result to MP3 via `audioConvert.ts`. TartuNLP and edge-tts are both free-but-unofficial-SLA services, so calls are retried once.
- `audioKey.ts` — deterministic `slug-hash.mp3` filename from `(lang, text, voiceId)`, which is what makes `ensureClip()` in `generate-audio.ts` idempotent: if the file already exists, skip the network call entirely.
- `audioConvert.ts` — `normalizeToMp3()` re-encodes whatever the engine returned (WAV or MP3) to a consistent 44.1kHz mono MP3 so `concat.ts`'s ffmpeg `concat` demuxer can stream-copy clips together without pitch/speed glitches; `getDurationSeconds()` gets a clip's length by parsing ffmpeg's own stderr banner, because `ffmpeg-static` bundles `ffmpeg` but not `ffprobe`.
- `concat.ts` — silence-clip generation (`ensureSilenceClip`, via ffmpeg's `anullsrc`) and the actual concatenation (`concatFiles`).
- Per-sentence `audioStart` offsets (built from those same durations) are what let the site sync the visible card to whichever sentence is currently playing during "Play full lesson" — see `sentenceIndexAtTime()` in `site/js/app.js`. Because an English and a Ukrainian rendering of the same sentence differ in length, `audioStart` (and `lessonAudio`/`chapterAudio`) are objects keyed by `NativeLang` (`{ en, uk }`), not single values — each native language gets its own concatenated track and its own offsets, all generated in the same pass.
- `buildCombinedLesson()` (inside `generate-audio.ts`) builds a "meta lesson" spanning several real lessons back-to-back — used both for the single `_all` (All Lessons) track and for `batch-N` (Unit N) tracks of `BATCH_SIZE` (5) consecutive lessons. These reuse already-computed per-lesson `EnrichedSentence[]` rather than resynthesizing anything; the ids `_all` and `batch-N` are reserved, don't name a real lesson that. Combined tracks (and the manifest files) are only rebuilt on a full run, not a `--lesson`/`--book`-scoped one.
- Sentence `id`s must be globally unique across all lesson files (and separately across all book files) — enforced by `contentLoader.ts`'s `loadLessons()`/`loadBooks()`, since ids double as part of the caching/lookup story.

### Site (`site/`)

Vanilla HTML/CSS/JS, no framework, no build step — `index.html`/`js/app.js` (lesson carousel), `book.html`/`js/book.js` (parallel-text reader), `quiz.html`/`js/quiz.js` (vocabulary quiz), and `practice.html`/`js/practice.js` (sentence practice) all just `fetch()` the generated JSON under `site/data/` and read audio from `site/audio/`. Serve via `npm run serve` rather than opening the HTML files directly — `fetch()` of local JSON breaks over `file://` in some browsers.

`site/js/lang.js` is a plain global (`window.EstLrnLang`, no module system) loaded before each page's own script; it reads/writes the `estlrn-native-lang` localStorage key and wires up `.lang-btn[data-lang]` toggle buttons. Switching languages does a full `location.reload()` rather than a reactive re-render — simplest correct option given four independent page scripts and no shared state layer; it does mean the current lesson/chapter selection resets to the first item on switch. `EstLrnLang.audioField(lang)` maps `"en"|"uk"` to the enriched data's `"audioEn"|"audioUk"` field name.

`quiz.js` always prompts with the Estonian word (recognizing/recalling the translation is the first-step skill; native→Estonian is a later-stage one, so there's no direction toggle) and has four modes (`.view-btn[data-mode]`, reusing the same pill-toggle CSS as the lesson picker's view toggle): multiple-choice (`"choice"`), free-typing recall (`"type"`), listening dictation (`"dictation"` — audio only, no text shown, type the Estonian spelling), and listen-&-distinguish (`"distinguish"` — two close-spelled Estonian words, hear one, pick which). The button-based modes (`choice`/`distinguish`) share `#quiz-options` + `selectOption()`; the text-input modes (`type`/`dictation`) share `#quiz-type-form` + `submitTypedAnswer()` — `current.wordEt` is always set to the vocabulary word being tested regardless of mode, since that's the spaced-repetition key.

Typed-answer matching (`acceptableAnswers()`) has to be lenient because glosses carry alternates and clarifiers (`"goes / is going"`, `"(to become) a painter"`) — it splits on `/`, and for a parenthetical clarifier accepts both the phrase with it stripped out entirely and the phrase with the parentheses removed but the words kept, so both "a painter" and "to become a painter" match. Not spelling-tolerant beyond that (no fuzzy match) — a typo is marked wrong. Dictation reuses the same function even though its answer (a plain Estonian word) never has alternates — it just degrades to a single-item list.

"Listen & distinguish" is a deliberate substitute for hand-authored Estonian minimal-pair content: rather than asserting real phonological minimal pairs (risky to get subtly wrong — see the Estonian-correctness note below), `findConfusablePair()` auto-detects close-spelled word pairs from the already-vetted vocabulary via Levenshtein distance (1–2, similar length) and quizzes recognizing which one was actually spoken. Not linguistically rigorous, but zero new content-correctness risk.

`site/js/progress.js` (`window.EstLrnProgress`, loaded on Quiz/Practice only) is a Leitner-box spaced-repetition tracker: `recordAnswer(et, correct)` moves a word up a box (longer interval) on success or back to box 0 on failure, all in `localStorage` — no ease-factor bookkeeping like full SM-2, deliberately simple for a single-learner tool. `getDueWords()` also treats a never-seen word as due, so new vocabulary keeps entering rotation. It also tracks a daily practice streak (`getStreak()`), advanced by `recordAnswer()` itself rather than by page visits. Every scored answer across Quiz and Practice's cloze mode calls `recordAnswer()`; Practice's word-order mode deliberately does not (it tests syntax, not per-word recall, so it isn't a good SRS signal for any single word).

`site/js/speed.js` (`window.EstLrnSpeed`, loaded on Lessons/Book only) holds the playback-speed preference. **Gotcha**: assigning `.src` on an `<audio>` element runs the browser's media-load algorithm, which resets `playbackRate` back to 1 as one of its steps — so setting the rate once at page load is not enough. Every call site that assigns `.src` on a tracked element (`lessonAudioEl`/`chapterAudioEl` in `loadLesson()`/`renderChapter()`, and `clipAudioEl` inside both files' `playClip()`) must call `EstLrnSpeed.applyTo(el)` again immediately after, or the rate silently reverts to 1x on the next clip.

`practice.js` builds two sentence-level exercises from the same `data/lessons/_all.json` used by the quiz: cloze (`blankOutWord()` reuses book.js's lead/core/trail token-splitting approach to blank one glossed word in place while preserving surrounding punctuation) and word order (`tokenizeEt()` extracts words via a Unicode-letter regex; the word-bank/answer-strip UI tracks original *token indices*, not word strings, so a sentence with a repeated word is still checked correctly — a correct reconstruction is exactly `answerIndices[i] === i` for every position).

Playback plumbing worth knowing before touching either JS file: audio-clip promises must resolve on both `ended` and `pause` (not just `ended`), otherwise stopping a clip mid-playback (the Stop button, or a new action interrupting an old one) leaves an `await`-chain hung forever with a button stuck disabled. Both `app.js` and `book.js` use a `stopped` flag checked between the two `await`s of an ET→native sequence for this reason (Estonian always plays/displays first — the learner reads/hears it before checking the translation) — follow the same pattern if you add another multi-clip playback sequence. When an async sequence itself needs to *become* the active one (book.js's immersion "Play chapter" loop), the convention is `stopped = true` first (cuts off whatever else is running) then `stopped = false` right before starting your own loop — see `playChapterBtn`'s click handler.

Book's "Hide translation (immersion mode)" toggle (`hideEnToggle`) does double duty: it hides the native-language text (existing `.hide-en` CSS class) *and* makes playback Estonian-only — `playSentencePair()` skips the native clip when checked, and `playChapterBtn` switches from the pre-built combined `chapterAudio[lang]` track to `playChapterImmersion()`, a client-side loop over each sentence's individual `audioEt` clip (no pre-built "Estonian only" track exists; the pipeline only builds per-native-language combined tracks).

`index.html`'s lesson picker has a Sentences/Vocabulary view toggle (`.view-btn[data-view]`, `setViewMode()` in `app.js`) — Vocabulary shows every unique word in the *current* lesson (deduped by `et`, paginated `VOCAB_PAGE_SIZE` per page) as a grid, for seeing a lesson's whole vocabulary (e.g. all family-member words) at once rather than one sentence at a time. View mode persists across lesson switches (`loadLesson()` ends with `setViewMode(viewMode)`, not always `render()`).

## Content authoring conventions

- A word's `et` field should be the exact inflected form as it appears in the sentence (not the dictionary form) — `lemma` holds the dictionary form when they differ. Book-mode's inline word-click glossing (`WORD_RE`/`renderGlossedText` in `book.js`) matches sentence text against `word.et` directly, so this isn't just a style preference for lessons.
- IPA is best-effort, not verified against a dictionary — flagged as such to the user, not a source of truth.
- Estonian content correctness has been flagged by the user before (an odd-looking-but-correct loanword, `džunglist`, prompted a "check language??" reaction) — prefer grammatically low-risk, well-established constructions (`See on X`, `Mul on X`, `Mulle meeldib X`, `Ma [verb]`) over anything requiring an unusual case ending you're not confident about, and say so if you're not sure rather than presenting a guess as fact.
- Ukrainian (`uk` fields) is a natural-meaning translation of the sentence, not a word-for-word mirror of Estonian grammar — translate for sense, and mirror the `en` gloss's style for word-level glosses (short phrases, `/`-separated alternates, parenthetical clarifiers). Lower correctness risk than Estonian (a mainstream, well-resourced language) but still best-effort, not proofread by a native speaker.
- The book content (`content/books/little-prince.json`) is deliberately an original passage inspired by the (public-domain, non-copyrightable) plot of *The Little Prince*'s opening — not a reproduction of any specific published translation, which would be a real copyright problem. Keep that distinction if extending it.

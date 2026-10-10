(function () {
  "use strict";

  const loadingEl = document.getElementById("review-loading");
  const reviewEl = document.getElementById("review");
  const progressEl = document.getElementById("review-progress");
  const scoreEl = document.getElementById("review-score");
  const streakBadgeEl = document.getElementById("streak-badge");
  const directionEl = document.getElementById("review-direction");
  const promptEl = document.getElementById("review-prompt");
  const hintEl = document.getElementById("review-hint");
  const playBtn = document.getElementById("review-play-btn");
  const optionsEl = document.getElementById("review-options");
  const typeFormEl = document.getElementById("review-type-form");
  const typeInputEl = document.getElementById("review-type-input");
  const feedbackEl = document.getElementById("review-feedback");
  const nextBtn = document.getElementById("review-next-btn");
  const doneEl = document.getElementById("review-done");
  const doneTitleEl = document.getElementById("review-done-title");
  const doneSummaryEl = document.getElementById("review-done-summary");
  const againBtn = document.getElementById("review-again-btn");
  const clipAudioEl = document.getElementById("clip-audio-el");

  const OPTION_COUNT = 4;
  // A session is a short, finishable daily unit rather than "every due word at once" — and new words
  // are capped separately, since isDue() counts every unseen word as due and would otherwise flood
  // the first session with the whole curriculum.
  const SESSION_LIMIT = 20;
  const NEW_PER_SESSION = 5;
  const WORD_SPLIT_RE = /^([^\p{L}]*)([\p{L}]+(?:[-'][\p{L}]+)*)([^\p{L}]*)$/u;

  const nativeLang = EstLrnLang.getNativeLang();
  const nativeLangLabel = EstLrnLang.nativeLangLabel(nativeLang);
  EstLrnLang.initLangToggle();

  let vocab = []; // { word, sentence } — one per unique Estonian form, in curriculum order
  let queue = []; // { entry, retry }
  let sessionSize = 0;
  let position = 0;
  let correct = 0;
  let answered = 0;
  let current = null; // { item, kind, answerText, audio, options? }
  let isAnswered = false;

  async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    return res.json();
  }

  async function init() {
    let allLesson;
    try {
      allLesson = await fetchJson("data/lessons/_all.json");
    } catch (err) {
      loadingEl.innerHTML =
        "<p>No lessons found yet. Run <code>npm run generate-audio</code> to build the site data, then reload.</p>";
      console.error(err);
      return;
    }

    vocab = buildVocab(allLesson);
    if (vocab.length < OPTION_COUNT) {
      loadingEl.innerHTML = "<p>Not enough vocabulary yet to build a review.</p>";
      return;
    }
    loadingEl.hidden = true;
    renderStreak();
    startSession();
  }

  // Keeps each word's first sentence alongside it, so a word can also be reviewed in context (cloze).
  function buildVocab(lesson) {
    const seen = new Map();
    for (const sentence of lesson.sentences) {
      for (const word of sentence.words || []) {
        const key = word.et.toLowerCase();
        if (!seen.has(key)) seen.set(key, { word, sentence });
      }
    }
    return [...seen.values()];
  }

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function renderStreak() {
    const streak = EstLrnProgress.getStreak();
    streakBadgeEl.textContent = streak.current > 0 ? `🔥 ${streak.current}-day streak` : "";
  }

  // Scheduled reviews first (weakest box first, so struggling words aren't the ones cut by the
  // session limit), topped up with a few new words in curriculum order — then the whole session is
  // shuffled, so words from different lessons and exercise types are interleaved rather than blocked.
  function buildQueue() {
    const scheduled = [];
    const fresh = [];
    for (const entry of vocab) {
      const box = EstLrnProgress.getBox(entry.word.et);
      if (box === null) fresh.push(entry);
      else if (EstLrnProgress.isDue(entry.word.et)) scheduled.push({ entry, box });
    }
    scheduled.sort((a, b) => a.box - b.box);
    const picked = scheduled.slice(0, SESSION_LIMIT).map((s) => s.entry);
    const newCount = Math.min(NEW_PER_SESSION, SESSION_LIMIT - picked.length, fresh.length);
    picked.push(...fresh.slice(0, Math.max(0, newCount)));
    return shuffle(picked).map((entry) => ({ entry, retry: false }));
  }

  function startSession() {
    queue = buildQueue();
    sessionSize = queue.length;
    position = 0;
    correct = 0;
    answered = 0;
    doneEl.hidden = true;
    if (queue.length === 0) {
      showDone();
      return;
    }
    reviewEl.hidden = false;
    nextQuestion();
  }

  function showDone() {
    reviewEl.hidden = true;
    doneEl.hidden = false;
    const moreAvailable = buildQueue().length > 0;
    if (answered === 0) {
      doneTitleEl.textContent = "All caught up 🎉";
      doneSummaryEl.textContent = "Nothing is due for review right now. Come back tomorrow, or keep going in Lessons.";
    } else {
      doneTitleEl.textContent = "Session complete 🎉";
      doneSummaryEl.textContent = `${correct} of ${answered} correct on the first try.${
        moreAvailable ? " There's more to review if you want to keep going." : ""
      }`;
    }
    againBtn.hidden = !moreAvailable;
    renderStreak();
  }

  // Difficulty ramps with the word's Leitner box: recognize it first, then recognize it in context,
  // then recall the meaning unaided, then recognize it by ear alone.
  function exerciseKindFor(box) {
    if (box === null || box === 0) return "choice";
    if (box === 1) return "cloze";
    if (box === 2) return "type";
    return "dictation";
  }

  function blankOutWord(text, targetEt) {
    const target = targetEt.toLowerCase();
    let done = false;
    const rendered = text
      .split(/(\s+)/)
      .map((token) => {
        if (done) return token;
        const match = token.match(WORD_SPLIT_RE);
        if (!match) return token;
        const [, lead, core, trail] = match;
        if (core.toLowerCase() !== target) return token;
        done = true;
        return `${lead}____${trail}`;
      })
      .join("");
    return done ? rendered : null;
  }

  function pickDistractors(answer, field) {
    const out = [];
    for (const { word } of shuffle(vocab)) {
      const candidate = word[field];
      if (candidate.toLowerCase() === answer.toLowerCase()) continue;
      if (out.some((d) => d.toLowerCase() === candidate.toLowerCase())) continue;
      out.push(candidate);
      if (out.length === OPTION_COUNT - 1) break;
    }
    return out;
  }

  function buildOptions(answer, field) {
    return shuffle([
      { text: answer, isCorrect: true },
      ...pickDistractors(answer, field).map((text) => ({ text, isCorrect: false })),
    ]);
  }

  function nextQuestion() {
    if (queue.length === 0) {
      showDone();
      return;
    }
    const item = queue.shift();
    const { word, sentence } = item.entry;
    isAnswered = false;
    nextBtn.hidden = true;
    feedbackEl.hidden = true;
    hintEl.hidden = true;
    typeInputEl.value = "";

    let kind = exerciseKindFor(EstLrnProgress.getBox(word.et));
    const blanked = kind === "cloze" ? blankOutWord(sentence.et, word.et) : null;
    if (kind === "cloze" && !blanked) kind = "choice"; // gloss doesn't appear verbatim in its sentence

    current = { item, kind, audio: word.audioEt };
    if (kind === "choice") {
      current.answerText = word[nativeLang];
      current.options = buildOptions(word[nativeLang], nativeLang);
      directionEl.textContent = `Estonian → ${nativeLangLabel}`;
      promptEl.textContent = word.et;
    } else if (kind === "cloze") {
      current.answerText = word.et;
      current.options = buildOptions(word.et, "et");
      directionEl.textContent = "Fill in the blank";
      promptEl.textContent = blanked;
      hintEl.textContent = sentence[nativeLang];
      hintEl.hidden = false;
    } else if (kind === "type") {
      current.answerText = word[nativeLang];
      directionEl.textContent = `Type the ${nativeLangLabel} translation`;
      promptEl.textContent = word.et;
    } else {
      current.answerText = word.et;
      directionEl.textContent = "Listen, then type the Estonian word";
      promptEl.textContent = "";
    }

    if (!item.retry) position++;
    progressEl.textContent = item.retry ? "Second try" : `${position} / ${sessionSize}`;
    scoreEl.textContent = answered > 0 ? `${correct} / ${answered} correct` : "";

    promptEl.hidden = !promptEl.textContent;
    // Hearing the word would give a cloze answer away, so its Listen button only appears afterwards.
    playBtn.hidden = !current.audio || kind === "cloze";
    const isButtonKind = kind === "choice" || kind === "cloze";
    optionsEl.hidden = !isButtonKind;
    typeFormEl.hidden = isButtonKind;
    if (isButtonKind) {
      optionsEl.innerHTML = "";
      for (const option of current.options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "quiz-option";
        btn.textContent = option.text;
        btn.addEventListener("click", () => selectOption(option, btn));
        optionsEl.appendChild(btn);
      }
    } else {
      typeInputEl.disabled = false;
      typeInputEl.placeholder = kind === "dictation" ? "Type the Estonian word…" : "Type the translation…";
      typeInputEl.focus();
    }
    if (kind !== "cloze") playPrompt();
  }

  function selectOption(option, btn) {
    if (isAnswered) return;
    for (const child of optionsEl.children) child.disabled = true;
    btn.classList.add(option.isCorrect ? "correct" : "incorrect");
    if (!option.isCorrect) {
      const correctBtn = [...optionsEl.children].find((c) => c.textContent === current.answerText);
      if (correctBtn) correctBtn.classList.add("correct");
    }
    if (current.kind === "cloze") {
      promptEl.textContent = current.item.entry.sentence.et;
      current.audio = current.item.entry.sentence.audioEt;
      playBtn.hidden = !current.audio;
      playPrompt();
    }
    finishQuestion(option.isCorrect);
  }

  // Same lenient matching as quiz.js: glosses carry "/"-separated alternates and parenthetical
  // clarifiers, and any one alternate (with or without the clarifier) counts as correct.
  function normalize(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[.!?]+$/, "")
      .replace(/\s+/g, " ");
  }

  function acceptableAnswers(text) {
    const alts = new Set();
    for (const alt of text.split("/")) {
      alts.add(normalize(alt.replace(/\([^)]*\)/g, "")));
      alts.add(normalize(alt.replace(/[()]/g, "")));
    }
    alts.delete("");
    return [...alts];
  }

  function submitTypedAnswer() {
    if (isAnswered) return;
    const typed = normalize(typeInputEl.value);
    if (!typed) return;
    const isCorrect = acceptableAnswers(current.answerText).includes(typed);
    typeInputEl.disabled = true;
    feedbackEl.hidden = false;
    feedbackEl.textContent = isCorrect
      ? "Correct!"
      : `Not quite — correct answer: ${current.answerText}${current.kind === "dictation" ? "" : ` (${current.item.entry.word.et})`}`;
    feedbackEl.className = `quiz-feedback ${isCorrect ? "correct" : "incorrect"}`;
    finishQuestion(isCorrect);
  }

  // Only the first attempt in a session is a spaced-repetition signal. A missed word comes back once
  // at the end of the session (seeing it again shortly after a miss is what makes the correction
  // stick), but that second attempt doesn't count — otherwise a miss followed by an immediate
  // correct retry would bump the word straight back up a box.
  function finishQuestion(isCorrect) {
    isAnswered = true;
    if (!current.item.retry) {
      answered++;
      if (isCorrect) correct++;
      EstLrnProgress.recordAnswer(current.item.entry.word.et, isCorrect);
      if (!isCorrect) queue.push({ entry: current.item.entry, retry: true });
    }
    scoreEl.textContent = `${correct} / ${answered} correct`;
    renderStreak();
    nextBtn.hidden = false;
    nextBtn.focus();
  }

  function playPrompt() {
    if (!current || !current.audio) return;
    clipAudioEl.src = current.audio;
    // Rejects when autoplay is blocked or the learner moves on before the clip loads — both harmless.
    clipAudioEl.play().catch(() => {});
  }

  playBtn.addEventListener("click", playPrompt);
  nextBtn.addEventListener("click", nextQuestion);
  againBtn.addEventListener("click", startSession);
  typeFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    submitTypedAnswer();
  });

  init();
})();

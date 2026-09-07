(function () {
  "use strict";

  const loadingEl = document.getElementById("quiz-loading");
  const quizEl = document.getElementById("quiz");
  const scoreEl = document.getElementById("quiz-score");
  const dueOnlyToggle = document.getElementById("due-only-toggle");
  const dueNoteEl = document.getElementById("due-note");
  const streakBadgeEl = document.getElementById("streak-badge");
  const directionEl = document.getElementById("quiz-direction");
  const promptEl = document.getElementById("quiz-prompt");
  const playBtn = document.getElementById("quiz-play-btn");
  const optionsEl = document.getElementById("quiz-options");
  const typeFormEl = document.getElementById("quiz-type-form");
  const typeInputEl = document.getElementById("quiz-type-input");
  const feedbackEl = document.getElementById("quiz-feedback");
  const nextBtn = document.getElementById("quiz-next-btn");
  const modeButtons = document.querySelectorAll(".view-btn[data-mode]");
  const clipAudioEl = document.getElementById("clip-audio-el");

  const OPTION_COUNT = 4;
  const nativeLang = EstLrnLang.getNativeLang();
  const nativeAudioField = EstLrnLang.audioField(nativeLang);
  const nativeLangLabel = EstLrnLang.nativeLangLabel(nativeLang);

  EstLrnLang.initLangToggle();
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === "choice"));

  let vocab = [];
  let correct = 0;
  let total = 0;
  let quizMode = "choice"; // "choice" | "type" | "dictation" | "distinguish"
  // current: { wordEt, promptText|null, promptAudio, answerText|null, options? }
  // - wordEt is always the vocab word this question tests, used as the spaced-repetition key.
  // - "choice"/"distinguish" render as buttons (current.options); "type"/"dictation" as a text input.
  let current = null;
  let answered = false;

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
      loadingEl.innerHTML = "<p>Not enough vocabulary yet to build a quiz.</p>";
      return;
    }

    loadingEl.hidden = true;
    quizEl.hidden = false;
    renderStreak();
    nextQuestion();
  }

  // One card per unique Estonian word form, first occurrence wins.
  function buildVocab(lesson) {
    const seen = new Map();
    for (const sentence of lesson.sentences) {
      for (const word of sentence.words || []) {
        const key = word.et.toLowerCase();
        if (!seen.has(key)) seen.set(key, word);
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

  // Falls back to the full vocab (with a note) rather than a pool too small to build a question —
  // "due only" is a filter on top of a working quiz, not a mode that can leave it broken.
  function getPool(minSize) {
    if (!dueOnlyToggle.checked) {
      dueNoteEl.hidden = true;
      return shuffle(vocab);
    }
    const due = EstLrnProgress.getDueWords(vocab);
    if (due.length >= minSize) {
      dueNoteEl.hidden = true;
      return shuffle(due);
    }
    dueNoteEl.hidden = false;
    dueNoteEl.textContent = "Nothing due for review right now — showing all words.";
    return shuffle(vocab);
  }

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  // "Minimal pair"-style listening practice without hand-authoring new (and easy to get subtly
  // wrong) Estonian phonology content: auto-detect close-spelled word pairs from the vocabulary
  // that's already generated and vetted, and quiz recognizing which one was actually spoken.
  function findConfusablePair(pool) {
    const shuffled = shuffle(pool);
    for (const wordA of shuffled) {
      const neighbor = shuffled.find((wordB) => {
        if (wordB.et.toLowerCase() === wordA.et.toLowerCase()) return false;
        const dist = levenshtein(wordA.et.toLowerCase(), wordB.et.toLowerCase());
        return dist >= 1 && dist <= 2 && Math.abs(wordA.et.length - wordB.et.length) <= 1;
      });
      if (neighbor) return [wordA, neighbor];
    }
    return null; // pool too small/varied to find any close pair — caller falls back
  }

  function setMode(mode) {
    quizMode = mode;
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    nextQuestion();
  }

  function nextQuestion() {
    answered = false;
    nextBtn.hidden = true;
    feedbackEl.hidden = true;
    typeInputEl.value = "";

    if (quizMode === "distinguish") {
      const pair = findConfusablePair(getPool(4)) || shuffle(vocab).slice(0, 2);
      const [wordA, wordB] = pair;
      const played = Math.random() < 0.5 ? wordA : wordB;
      current = {
        wordEt: played.et,
        promptText: null,
        promptAudio: played.audioEt,
        answerText: played.et,
        options: shuffle([
          { text: wordA.et, isCorrect: wordA === played },
          { text: wordB.et, isCorrect: wordB === played },
        ]),
      };
      render();
      playPrompt();
      return;
    }

    // Estonian is always the prompt — recognizing/recalling the translation is the first step in
    // learning a word; going the other direction (native word -> Estonian) is a later-stage skill.
    const pool = getPool(quizMode === "choice" ? OPTION_COUNT : 1);
    const answerWord = pool[0];

    if (quizMode === "choice") {
      const distractors = [];
      for (const w of pool.slice(1)) {
        const candidate = w[nativeLang];
        if (candidate.toLowerCase() === answerWord[nativeLang].toLowerCase()) continue;
        if (distractors.some((d) => d.toLowerCase() === candidate.toLowerCase())) continue;
        distractors.push(candidate);
        if (distractors.length === OPTION_COUNT - 1) break;
      }
      current = {
        wordEt: answerWord.et,
        promptText: answerWord.et,
        promptAudio: answerWord.audioEt,
        answerText: answerWord[nativeLang],
        options: shuffle([
          { text: answerWord[nativeLang], isCorrect: true },
          ...distractors.map((text) => ({ text, isCorrect: false })),
        ]),
      };
    } else if (quizMode === "type") {
      current = {
        wordEt: answerWord.et,
        promptText: answerWord.et,
        promptAudio: answerWord.audioEt,
        answerText: answerWord[nativeLang],
      };
    } else {
      // dictation: no text prompt at all — listen and spell the Estonian word.
      current = {
        wordEt: answerWord.et,
        promptText: null,
        promptAudio: answerWord.audioEt,
        answerText: answerWord.et,
      };
    }
    render();
    if (quizMode === "dictation") playPrompt();
  }

  function render() {
    directionEl.textContent =
      quizMode === "dictation"
        ? "Listen, then type the Estonian word"
        : quizMode === "distinguish"
          ? "Which word did you hear?"
          : `Estonian → ${nativeLangLabel}`;

    promptEl.hidden = !current.promptText;
    promptEl.textContent = current.promptText || "";
    playBtn.hidden = !current.promptAudio;

    const isButtonMode = quizMode === "choice" || quizMode === "distinguish";
    optionsEl.hidden = !isButtonMode;
    typeFormEl.hidden = isButtonMode;

    if (isButtonMode) {
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
      typeInputEl.placeholder = quizMode === "dictation" ? "Type the Estonian word…" : "Type the translation…";
      typeInputEl.focus();
    }
  }

  function selectOption(option, btn) {
    if (answered) return;
    finishQuestion(option.isCorrect);

    for (const child of optionsEl.children) child.disabled = true;
    btn.classList.add(option.isCorrect ? "correct" : "incorrect");
    if (!option.isCorrect) {
      const correctBtn = [...optionsEl.children].find((c) => c.textContent === current.answerText);
      if (correctBtn) correctBtn.classList.add("correct");
    }
  }

  // The stored translation is a gloss, sometimes with alternates ("goes / is going") or a
  // parenthetical clarifier ("(to become) a painter") — accept a typed answer that matches any one
  // of those alternates (with or without the clarifier spelled out), ignoring case/punctuation.
  // Dictation's answerText (a plain Estonian word) has no such alternates, so this degrades to a
  // plain normalized-equality check there.
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
    if (answered) return;
    const typed = normalize(typeInputEl.value);
    if (!typed) return;

    const isCorrect = acceptableAnswers(current.answerText).includes(typed);
    finishQuestion(isCorrect);

    typeInputEl.disabled = true;
    feedbackEl.hidden = false;
    feedbackEl.textContent = isCorrect ? "Correct!" : `Not quite — correct answer: ${current.answerText}`;
    feedbackEl.className = `quiz-feedback ${isCorrect ? "correct" : "incorrect"}`;
  }

  function finishQuestion(isCorrect) {
    answered = true;
    total++;
    if (isCorrect) correct++;
    EstLrnProgress.recordAnswer(current.wordEt, isCorrect);
    scoreEl.textContent = `Score: ${correct} / ${total}`;
    renderStreak();
    nextBtn.hidden = false;
  }

  function playPrompt() {
    if (!current.promptAudio) return;
    clipAudioEl.src = current.promptAudio;
    clipAudioEl.play();
  }

  playBtn.addEventListener("click", playPrompt);
  nextBtn.addEventListener("click", nextQuestion);
  typeFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    submitTypedAnswer();
  });
  modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
  dueOnlyToggle.addEventListener("change", nextQuestion);

  init();
})();

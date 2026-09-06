(function () {
  "use strict";

  const loadingEl = document.getElementById("quiz-loading");
  const quizEl = document.getElementById("quiz");
  const scoreEl = document.getElementById("quiz-score");
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
  let quizMode = "choice"; // "choice" | "type"
  let current = null; // { promptText, promptAudio, answerText, options? }
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

    // Estonian is always the prompt — recognizing/recalling the translation is the first step in
    // learning a word; going the other direction (native word -> Estonian) is a later-stage skill.
    const pool = shuffle(vocab);
    const answerWord = pool[0];
    const promptText = answerWord.et;
    const answerText = answerWord[nativeLang];

    let options;
    if (quizMode === "choice") {
      const distractors = [];
      for (const w of pool.slice(1)) {
        const candidate = w[nativeLang];
        if (candidate.toLowerCase() === answerText.toLowerCase()) continue;
        if (distractors.some((d) => d.toLowerCase() === candidate.toLowerCase())) continue;
        distractors.push(candidate);
        if (distractors.length === OPTION_COUNT - 1) break;
      }
      options = shuffle([
        { text: answerText, isCorrect: true },
        ...distractors.map((text) => ({ text, isCorrect: false })),
      ]);
    }

    current = { promptText, promptAudio: answerWord.audioEt, answerText, options };
    render();
  }

  function render() {
    directionEl.textContent = `Estonian → ${nativeLangLabel}`;
    promptEl.textContent = current.promptText;
    playBtn.hidden = !current.promptAudio;

    optionsEl.hidden = quizMode !== "choice";
    typeFormEl.hidden = quizMode !== "type";

    if (quizMode === "choice") {
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
      typeInputEl.focus();
    }
  }

  function selectOption(option, btn) {
    if (answered) return;
    answered = true;
    total++;
    if (option.isCorrect) correct++;

    for (const child of optionsEl.children) {
      child.disabled = true;
    }
    btn.classList.add(option.isCorrect ? "correct" : "incorrect");
    if (!option.isCorrect) {
      const correctBtn = [...optionsEl.children].find((c) => c.textContent === current.answerText);
      if (correctBtn) correctBtn.classList.add("correct");
    }

    scoreEl.textContent = `Score: ${correct} / ${total}`;
    nextBtn.hidden = false;
  }

  // The stored translation is a gloss, sometimes with alternates ("goes / is going") or a
  // parenthetical clarifier ("(to become) a painter") — accept a typed answer that matches any one
  // of those alternates, ignoring the clarifier, case, and trailing punctuation.
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
      alts.add(normalize(alt.replace(/\([^)]*\)/g, ""))); // "(to become) a painter" -> "a painter"
      alts.add(normalize(alt.replace(/[()]/g, ""))); // "(to become) a painter" -> "to become a painter"
    }
    alts.delete("");
    return [...alts];
  }

  function submitTypedAnswer() {
    if (answered) return;
    const typed = normalize(typeInputEl.value);
    if (!typed) return;

    answered = true;
    total++;
    const isCorrect = acceptableAnswers(current.answerText).includes(typed);
    if (isCorrect) correct++;

    typeInputEl.disabled = true;
    feedbackEl.hidden = false;
    feedbackEl.textContent = isCorrect ? "Correct!" : `Not quite — correct answer: ${current.answerText}`;
    feedbackEl.className = `quiz-feedback ${isCorrect ? "correct" : "incorrect"}`;

    scoreEl.textContent = `Score: ${correct} / ${total}`;
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

  init();
})();

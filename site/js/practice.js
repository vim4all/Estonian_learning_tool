(function () {
  "use strict";

  const loadingEl = document.getElementById("practice-loading");
  const practiceEl = document.getElementById("practice");
  const scoreEl = document.getElementById("practice-score");
  const streakBadgeEl = document.getElementById("streak-badge");
  const modeButtons = document.querySelectorAll(".view-btn[data-mode]");
  const nextBtn = document.getElementById("practice-next-btn");

  const clozeCardEl = document.getElementById("cloze-card");
  const clozeSentenceEl = document.getElementById("cloze-sentence");
  const clozeHintBtn = document.getElementById("cloze-hint-btn");
  const clozeHintEl = document.getElementById("cloze-hint");
  const clozeOptionsEl = document.getElementById("cloze-options");

  const orderCardEl = document.getElementById("order-card");
  const orderNativeEl = document.getElementById("order-native");
  const orderAnswerEl = document.getElementById("order-answer");
  const orderBankEl = document.getElementById("order-bank");
  const orderCheckBtn = document.getElementById("order-check-btn");
  const orderClearBtn = document.getElementById("order-clear-btn");
  const orderFeedbackEl = document.getElementById("order-feedback");
  const orderSolutionEl = document.getElementById("order-solution");

  const OPTION_COUNT = 4;
  const ET_TOKEN_RE = /\p{L}+(?:[-''’]\p{L}+)*/gu;
  // Same lead/core/trail split book.js uses for inline glossing — needed here to blank out one
  // word inside a sentence while leaving its surrounding punctuation and spacing untouched.
  const WORD_SPLIT_RE = /^([^\p{L}]*)([\p{L}]+(?:[-'][\p{L}]+)*)([^\p{L}]*)$/u;

  const nativeLang = EstLrnLang.getNativeLang();
  EstLrnLang.initLangToggle();
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === "cloze"));

  let sentences = [];
  let vocab = [];
  let practiceMode = "cloze"; // "cloze" | "order"
  let correct = 0;
  let total = 0;
  let answered = false;
  let current = null; // cloze: { wordEt, options }. order: { originalTokens, bankIndices, answerIndices }

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

    sentences = allLesson.sentences;
    vocab = buildVocab(allLesson);
    if (sentences.length === 0) {
      loadingEl.innerHTML = "<p>Not enough content yet to build sentence practice.</p>";
      return;
    }

    loadingEl.hidden = true;
    practiceEl.hidden = false;
    renderStreak();
    nextQuestion();
  }

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

  function tokenizeEt(text) {
    return text.match(ET_TOKEN_RE) || [];
  }

  function renderStreak() {
    const streak = EstLrnProgress.getStreak();
    streakBadgeEl.textContent = streak.current > 0 ? `🔥 ${streak.current}-day streak` : "";
  }

  function setMode(mode) {
    practiceMode = mode;
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    clozeCardEl.hidden = mode !== "cloze";
    orderCardEl.hidden = mode !== "order";
    nextQuestion();
  }

  function nextQuestion() {
    answered = false;
    nextBtn.hidden = true;
    if (practiceMode === "cloze") nextCloze();
    else nextOrder();
  }

  // --- Fill in the blank -----------------------------------------------------------------------

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

  function nextCloze() {
    clozeHintEl.hidden = true;

    let sentence;
    let targetWord;
    let blanked;
    // Nearly every sentence's words[] entry appears verbatim in its own `et` text, but retry a
    // few times in case of an edge case (e.g. a word gloss covering a multi-word phrase).
    for (let attempt = 0; attempt < 20 && !blanked; attempt++) {
      sentence = sentences[Math.floor(Math.random() * sentences.length)];
      if (!sentence.words || sentence.words.length === 0) continue;
      targetWord = sentence.words[Math.floor(Math.random() * sentence.words.length)];
      blanked = blankOutWord(sentence.et, targetWord.et);
    }
    if (!blanked) {
      clozeSentenceEl.textContent = "Couldn't build a question — try Next.";
      clozeOptionsEl.innerHTML = "";
      return;
    }

    const distractors = [];
    for (const w of shuffle(vocab)) {
      if (w.et.toLowerCase() === targetWord.et.toLowerCase()) continue;
      if (distractors.some((d) => d.toLowerCase() === w.et.toLowerCase())) continue;
      distractors.push(w.et);
      if (distractors.length === OPTION_COUNT - 1) break;
    }

    current = {
      wordEt: targetWord.et,
      sentence,
      options: shuffle([{ text: targetWord.et, isCorrect: true }, ...distractors.map((text) => ({ text, isCorrect: false }))]),
    };

    clozeSentenceEl.textContent = blanked;
    clozeHintEl.textContent = sentence[nativeLang];
    clozeOptionsEl.innerHTML = "";
    for (const option of current.options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option";
      btn.textContent = option.text;
      btn.addEventListener("click", () => selectClozeOption(option, btn));
      clozeOptionsEl.appendChild(btn);
    }
  }

  function selectClozeOption(option, btn) {
    if (answered) return;
    answered = true;
    total++;
    if (option.isCorrect) correct++;
    EstLrnProgress.recordAnswer(current.wordEt, option.isCorrect);

    for (const child of clozeOptionsEl.children) child.disabled = true;
    btn.classList.add(option.isCorrect ? "correct" : "incorrect");
    if (!option.isCorrect) {
      const correctBtn = [...clozeOptionsEl.children].find((c) => c.textContent === current.wordEt);
      if (correctBtn) correctBtn.classList.add("correct");
    }
    clozeSentenceEl.textContent = current.sentence.et;

    scoreEl.textContent = `Score: ${correct} / ${total}`;
    renderStreak();
    nextBtn.hidden = false;
  }

  clozeHintBtn.addEventListener("click", () => {
    clozeHintEl.hidden = !clozeHintEl.hidden;
  });

  // --- Word order --------------------------------------------------------------------------------

  function nextOrder() {
    orderFeedbackEl.hidden = true;
    orderSolutionEl.hidden = true;

    const pool = sentences.filter((s) => tokenizeEt(s.et).length >= 3);
    const sentence = (pool.length > 0 ? pool : sentences)[Math.floor(Math.random() * (pool.length > 0 ? pool.length : sentences.length))];
    const originalTokens = tokenizeEt(sentence.et);

    current = {
      sentence,
      originalTokens,
      bankIndices: shuffle(originalTokens.map((_, i) => i)),
      answerIndices: [],
    };

    orderNativeEl.textContent = sentence[nativeLang];
    renderOrder();
  }

  function renderOrder() {
    const { originalTokens, bankIndices, answerIndices } = current;

    orderAnswerEl.innerHTML = "";
    for (const idx of answerIndices) {
      orderAnswerEl.appendChild(makeOrderTile(originalTokens[idx], () => removeFromAnswer(idx)));
    }
    if (answerIndices.length === 0) {
      const placeholder = document.createElement("span");
      placeholder.className = "order-placeholder";
      placeholder.textContent = "Tap words below to build the sentence…";
      orderAnswerEl.appendChild(placeholder);
    }

    orderBankEl.innerHTML = "";
    for (const idx of bankIndices) {
      orderBankEl.appendChild(makeOrderTile(originalTokens[idx], () => moveToAnswer(idx)));
    }
  }

  function makeOrderTile(text, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "order-tile";
    btn.textContent = text;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function moveToAnswer(idx) {
    if (answered) return;
    current.bankIndices = current.bankIndices.filter((i) => i !== idx);
    current.answerIndices.push(idx);
    renderOrder();
  }

  function removeFromAnswer(idx) {
    if (answered) return;
    current.answerIndices = current.answerIndices.filter((i) => i !== idx);
    current.bankIndices.push(idx);
    renderOrder();
  }

  function checkOrder() {
    if (answered) return;
    if (current.answerIndices.length !== current.originalTokens.length) return;
    answered = true;
    total++;

    // Each index uniquely identifies one slot in the original sentence (safe even with a repeated
    // word), so a correct reconstruction is exactly the identity permutation.
    const isCorrect = current.answerIndices.every((idx, pos) => idx === pos);
    if (isCorrect) correct++;

    orderFeedbackEl.hidden = false;
    orderFeedbackEl.textContent = isCorrect ? "Correct!" : "Not quite.";
    orderFeedbackEl.className = `quiz-feedback ${isCorrect ? "correct" : "incorrect"}`;
    orderSolutionEl.hidden = false;
    orderSolutionEl.textContent = current.sentence.et;

    scoreEl.textContent = `Score: ${correct} / ${total}`;
    renderStreak();
    nextBtn.hidden = false;
  }

  function clearOrder() {
    if (answered) return;
    current.bankIndices = shuffle([...current.bankIndices, ...current.answerIndices]);
    current.answerIndices = [];
    renderOrder();
  }

  orderCheckBtn.addEventListener("click", checkOrder);
  orderClearBtn.addEventListener("click", clearOrder);

  modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
  nextBtn.addEventListener("click", nextQuestion);

  init();
})();

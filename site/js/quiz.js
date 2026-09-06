(function () {
  "use strict";

  const loadingEl = document.getElementById("quiz-loading");
  const quizEl = document.getElementById("quiz");
  const scoreEl = document.getElementById("quiz-score");
  const directionEl = document.getElementById("quiz-direction");
  const promptEl = document.getElementById("quiz-prompt");
  const playBtn = document.getElementById("quiz-play-btn");
  const optionsEl = document.getElementById("quiz-options");
  const nextBtn = document.getElementById("quiz-next-btn");
  const clipAudioEl = document.getElementById("clip-audio-el");

  const OPTION_COUNT = 4;

  let vocab = [];
  let correct = 0;
  let total = 0;
  let current = null; // { prompt, promptAudio, answerText, options: [{text, isCorrect}] }
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

  function nextQuestion() {
    answered = false;
    nextBtn.hidden = true;

    const direction = Math.random() < 0.5 ? "et-en" : "en-et";
    const pool = shuffle(vocab);
    const answerWord = pool[0];
    const promptText = direction === "et-en" ? answerWord.et : answerWord.en;
    const answerText = direction === "et-en" ? answerWord.en : answerWord.et;

    const distractors = [];
    for (const w of pool.slice(1)) {
      const candidate = direction === "et-en" ? w.en : w.et;
      if (candidate.toLowerCase() === answerText.toLowerCase()) continue;
      if (distractors.some((d) => d.toLowerCase() === candidate.toLowerCase())) continue;
      distractors.push(candidate);
      if (distractors.length === OPTION_COUNT - 1) break;
    }

    const options = shuffle([
      { text: answerText, isCorrect: true },
      ...distractors.map((text) => ({ text, isCorrect: false })),
    ]);

    current = {
      direction,
      promptText,
      promptAudio: direction === "et-en" ? answerWord.audioEt : answerWord.audioEn,
      options,
    };
    render();
  }

  function render() {
    directionEl.textContent =
      current.direction === "et-en" ? "Estonian → English" : "English → Estonian";
    promptEl.textContent = current.promptText;
    playBtn.hidden = !current.promptAudio;

    optionsEl.innerHTML = "";
    for (const option of current.options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option";
      btn.textContent = option.text;
      btn.addEventListener("click", () => selectOption(option, btn));
      optionsEl.appendChild(btn);
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
      const correctBtn = [...optionsEl.children].find((c) => c.textContent === correctText());
      if (correctBtn) correctBtn.classList.add("correct");
    }

    scoreEl.textContent = `Score: ${correct} / ${total}`;
    nextBtn.hidden = false;
  }

  function correctText() {
    return current.options.find((o) => o.isCorrect).text;
  }

  function playPrompt() {
    if (!current.promptAudio) return;
    clipAudioEl.src = current.promptAudio;
    clipAudioEl.play();
  }

  playBtn.addEventListener("click", playPrompt);
  nextBtn.addEventListener("click", nextQuestion);

  init();
})();

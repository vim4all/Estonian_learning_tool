(function () {
  "use strict";

  const lessonSelect = document.getElementById("lesson-select");
  const carousel = document.getElementById("carousel");
  const progressEl = document.getElementById("progress");
  const topicTagEl = document.getElementById("topic-tag");
  const sentenceEnEl = document.getElementById("sentence-en");
  const sentenceEtEl = document.getElementById("sentence-et");
  const notesEl = document.getElementById("notes");
  const wordsEl = document.getElementById("words");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const randomBtn = document.getElementById("random-btn");
  const playSentenceBtn = document.getElementById("play-sentence-btn");
  const playLessonBtn = document.getElementById("play-lesson-btn");
  const stopBtn = document.getElementById("stop-btn");
  const loopToggle = document.getElementById("loop-toggle");
  const clipAudioEl = document.getElementById("clip-audio-el");
  const lessonAudioEl = document.getElementById("lesson-audio-el");
  const viewButtons = document.querySelectorAll(".view-btn");
  const vocabView = document.getElementById("vocab-view");
  const vocabGridEl = document.getElementById("vocab-grid");
  const vocabPaginationEl = document.getElementById("vocab-pagination");
  const vocabPageLabelEl = document.getElementById("vocab-page-label");
  const vocabPrevBtn = document.getElementById("vocab-prev-btn");
  const vocabNextBtn = document.getElementById("vocab-next-btn");

  const nativeLang = EstLrnLang.getNativeLang();
  const nativeAudioField = EstLrnLang.audioField(nativeLang);

  const VOCAB_PAGE_SIZE = 12;

  let currentLesson = null;
  let currentIndex = 0;
  let stopped = false;
  let viewMode = "sentences";
  let vocabWords = [];
  let vocabPage = 0;

  EstLrnLang.initLangToggle();
  EstLrnSpeed.initSpeedToggle([lessonAudioEl, clipAudioEl]);

  async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    return res.json();
  }

  async function init() {
    let manifest;
    try {
      manifest = await fetchJson("data/manifest.json");
    } catch (err) {
      lessonSelect.outerHTML =
        "<p>No lessons found yet. Run <code>npm run generate-audio</code> to build the site data, then reload.</p>";
      console.error(err);
      return;
    }

    manifest.sort((a, b) => a.order - b.order);
    for (const lesson of manifest) {
      const option = document.createElement("option");
      option.value = lesson.id;
      option.textContent = `${lesson.title[nativeLang]} (${lesson.level})`;
      lessonSelect.appendChild(option);
    }

    lessonSelect.addEventListener("change", () => loadLesson(lessonSelect.value));
    if (manifest.length > 0) await loadLesson(manifest[0].id);
  }

  async function loadLesson(lessonId) {
    lessonAudioEl.pause();
    clipAudioEl.pause();
    currentLesson = await fetchJson(`data/lessons/${lessonId}.json`);
    lessonAudioEl.src = currentLesson.lessonAudio[nativeLang];
    EstLrnSpeed.applyTo(lessonAudioEl);
    currentIndex = 0;
    setViewMode(viewMode);
  }

  function render() {
    const sentence = currentLesson.sentences[currentIndex];
    progressEl.textContent = `${currentIndex + 1} / ${currentLesson.sentences.length}`;
    topicTagEl.hidden = !sentence.lessonTitle;
    if (sentence.lessonTitle) topicTagEl.textContent = sentence.lessonTitle[nativeLang];
    sentenceEnEl.textContent = sentence[nativeLang];
    sentenceEtEl.textContent = sentence.et;
    notesEl.textContent = sentence.notes || "";
    notesEl.hidden = !sentence.notes;

    wordsEl.innerHTML = "";
    for (const word of sentence.words) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "word-chip";
      chip.innerHTML = `${word.et}<span class="ipa">${word.ipa ? "/" + word.ipa + "/" : ""}</span>`;
      chip.title = `${word[nativeLang]} (${word.pos}${word.lemma !== word.et ? `, lemma: ${word.lemma}` : ""})`;
      chip.addEventListener("click", () => playClip(word.audioEt));
      wordsEl.appendChild(chip);
    }

    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === currentLesson.sentences.length - 1;
  }

  // One card per unique Estonian word in the current lesson, first occurrence wins — lets a learner
  // see a whole lesson's vocabulary (e.g. all the family-member words) at once instead of one
  // sentence at a time.
  function buildLessonVocab(lesson) {
    const seen = new Map();
    for (const sentence of lesson.sentences) {
      for (const word of sentence.words) {
        const key = word.et.toLowerCase();
        if (!seen.has(key)) seen.set(key, word);
      }
    }
    return [...seen.values()];
  }

  function renderVocab() {
    const totalPages = Math.max(1, Math.ceil(vocabWords.length / VOCAB_PAGE_SIZE));
    vocabPage = Math.min(vocabPage, totalPages - 1);
    const start = vocabPage * VOCAB_PAGE_SIZE;

    vocabGridEl.innerHTML = "";
    for (const word of vocabWords.slice(start, start + VOCAB_PAGE_SIZE)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "vocab-card";
      card.innerHTML = `
        <div class="vocab-et">${word.et}</div>
        ${word.ipa ? `<div class="vocab-ipa">/${word.ipa}/</div>` : ""}
        <div class="vocab-native">${word[nativeLang]}</div>
      `;
      card.addEventListener("click", () => playClip(word.audioEt));
      vocabGridEl.appendChild(card);
    }

    vocabPaginationEl.hidden = totalPages <= 1;
    vocabPageLabelEl.textContent = `${vocabPage + 1} / ${totalPages}`;
    vocabPrevBtn.disabled = vocabPage === 0;
    vocabNextBtn.disabled = vocabPage >= totalPages - 1;
  }

  function setViewMode(mode) {
    viewMode = mode;
    carousel.hidden = mode !== "sentences";
    vocabView.hidden = mode !== "vocab";
    viewButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === mode));

    if (mode === "sentences") {
      render();
    } else {
      lessonAudioEl.pause();
      vocabWords = buildLessonVocab(currentLesson);
      vocabPage = 0;
      renderVocab();
    }
  }

  function playClip(src) {
    lessonAudioEl.pause(); // a manually-triggered clip always wins over the synced full-lesson track
    return new Promise((resolve) => {
      clipAudioEl.src = src;
      EstLrnSpeed.applyTo(clipAudioEl);
      // Resolve on "ended" (finished naturally) or "pause" (stopped early, e.g. the Stop button) —
      // without the "pause" path, stopping mid-clip would leave an awaiting sequence hung forever.
      const onDone = () => {
        clipAudioEl.removeEventListener("ended", onDone);
        clipAudioEl.removeEventListener("pause", onDone);
        resolve();
      };
      clipAudioEl.addEventListener("ended", onDone);
      clipAudioEl.addEventListener("pause", onDone);
      clipAudioEl.play();
    });
  }

  async function playCurrentSentence() {
    stopped = false;
    const sentence = currentLesson.sentences[currentIndex];
    playSentenceBtn.disabled = true;
    try {
      await playClip(sentence.audioEt);
      if (stopped) return;
      await playClip(sentence[nativeAudioField]);
    } finally {
      playSentenceBtn.disabled = false;
    }
  }

  function stopPlayback() {
    stopped = true;
    lessonAudioEl.pause();
    lessonAudioEl.currentTime = 0;
    clipAudioEl.pause();
    clipAudioEl.currentTime = 0;
  }

  // While "Play full lesson" is running, the card in view tracks whichever sentence is currently
  // sounding — this only has an effect while the lesson track is actually playing.
  function sentenceIndexAtTime(time) {
    let index = 0;
    for (let i = 0; i < currentLesson.sentences.length; i++) {
      if (currentLesson.sentences[i].audioStart[nativeLang] <= time) index = i;
      else break;
    }
    return index;
  }

  lessonAudioEl.addEventListener("timeupdate", () => {
    if (lessonAudioEl.paused || !currentLesson) return;
    const index = sentenceIndexAtTime(lessonAudioEl.currentTime);
    if (index !== currentIndex) {
      currentIndex = index;
      render();
    }
  });

  prevBtn.addEventListener("click", () => {
    lessonAudioEl.pause(); // manual navigation always wins over the synced full-lesson track
    if (currentIndex > 0) {
      currentIndex--;
      render();
    }
  });

  nextBtn.addEventListener("click", () => {
    lessonAudioEl.pause();
    if (currentIndex < currentLesson.sentences.length - 1) {
      currentIndex++;
      render();
    }
  });

  randomBtn.addEventListener("click", () => {
    lessonAudioEl.pause(); // manual navigation always wins over the synced full-lesson track
    const count = currentLesson.sentences.length;
    if (count < 2) return;
    let index;
    do {
      index = Math.floor(Math.random() * count);
    } while (index === currentIndex);
    currentIndex = index;
    render();
  });

  loopToggle.addEventListener("change", () => {
    lessonAudioEl.loop = loopToggle.checked;
  });

  playSentenceBtn.addEventListener("click", playCurrentSentence);
  playLessonBtn.addEventListener("click", () => {
    stopped = true; // cut short any in-flight "Play sentence" sequence
    clipAudioEl.pause();
    currentIndex = 0;
    render();
    lessonAudioEl.currentTime = 0;
    lessonAudioEl.play();
  });
  stopBtn.addEventListener("click", stopPlayback);

  viewButtons.forEach((btn) => btn.addEventListener("click", () => setViewMode(btn.dataset.view)));
  vocabPrevBtn.addEventListener("click", () => {
    vocabPage--;
    renderVocab();
  });
  vocabNextBtn.addEventListener("click", () => {
    vocabPage++;
    renderVocab();
  });

  init();
})();

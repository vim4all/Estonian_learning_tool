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
  const reviewBannerEl = document.getElementById("review-banner");
  const masteryBarEl = document.getElementById("mastery-bar");
  const masteryBarFillEl = document.getElementById("mastery-bar-fill");
  const masteryBarLabelEl = document.getElementById("mastery-bar-label");
  const shadowControlsEl = document.getElementById("shadow-controls");
  const shadowRecordBtn = document.getElementById("shadow-record-btn");
  const shadowCompareBtn = document.getElementById("shadow-compare-btn");
  const shadowStatusEl = document.getElementById("shadow-status");
  const shadowAudioEl = document.getElementById("shadow-audio-el");

  const nativeLang = EstLrnLang.getNativeLang();
  const nativeAudioField = EstLrnLang.audioField(nativeLang);

  const VOCAB_PAGE_SIZE = 12;
  // Long enough for any lesson sentence said slowly; just a guard against a forgotten recording.
  const MAX_RECORDING_MS = 15000;
  // Needs a secure context (https or localhost) as well as browser support — hide the feature
  // entirely rather than show buttons that can only fail.
  const shadowSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  let currentLesson = null;
  let currentIndex = 0;
  let stopped = false;
  let viewMode = "sentences";
  let vocabWords = [];
  let vocabPage = 0;
  let vocabByLesson = new Map(); // lessonId -> unique word[] in that lesson, from _all.json — for the mastery bar
  // Shadowing state: one recording at a time, tied to the sentence it was made for.
  let recorder = null;
  let recordingTimer = null;
  let recordingUrl = null;
  let recordingKey = null; // `${lessonId}:${index}` the current recording belongs to

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

    // Pulls in the combined "_all" lesson (same file quiz.js uses) to compute a per-lesson mastery %
    // and a site-wide due-word count without fetching every lesson individually. _all.json only
    // exists after a full (non --lesson-scoped) generate-audio run, so a 404 here is expected
    // mid-iteration — the picker and banner both just fall back to skipping those extras.
    let vocab = { perLesson: new Map(), global: [] };
    try {
      vocab = buildVocabMaps(await fetchJson("data/lessons/_all.json"));
    } catch {
      // scoped local build — no combined manifest yet.
    }
    vocabByLesson = vocab.perLesson;

    manifest.sort((a, b) => a.order - b.order);
    for (const lesson of manifest) {
      const option = document.createElement("option");
      option.value = lesson.id;
      option.textContent = `${lesson.title[nativeLang]} (${lesson.level})`;
      lessonSelect.appendChild(option);
    }

    lessonSelect.addEventListener("change", () => loadLesson(lessonSelect.value));
    if (manifest.length > 0) await loadLesson(manifest[0].id);
    renderReviewBanner(vocab.global);
  }

  // Visible per-lesson progress, shown next to the lesson the learner actually has open — a % buried
  // in a closed <select>'s option text isn't something a returning learner would ever notice.
  function renderMasteryBar(lessonId) {
    const words = vocabByLesson.get(lessonId) || [];
    if (words.length === 0) {
      masteryBarEl.hidden = true;
      return;
    }
    const pct = Math.round(EstLrnProgress.getMasteryFraction(words) * 100);
    masteryBarFillEl.style.width = `${pct}%`;
    masteryBarLabelEl.textContent = `${pct}% mastered`;
    masteryBarEl.hidden = false;
  }

  // One dedup pass over the combined "_all" lesson's sentences, grouped two ways: per-lesson (first
  // occurrence within that lesson wins — for the picker's mastery %) and globally across every lesson
  // (for the home banner's due-word count, which shouldn't double-count a word shared by two lessons).
  function buildVocabMaps(allLesson) {
    const perLessonSeen = new Map(); // lessonId -> Map(et -> word)
    const globalSeen = new Map(); // et -> word
    for (const sentence of allLesson.sentences) {
      let bucket = perLessonSeen.get(sentence.lessonId);
      if (!bucket) {
        bucket = new Map();
        perLessonSeen.set(sentence.lessonId, bucket);
      }
      for (const word of sentence.words || []) {
        const key = word.et.toLowerCase();
        if (!bucket.has(key)) bucket.set(key, word);
        if (!globalSeen.has(key)) globalSeen.set(key, word);
      }
    }
    const perLesson = new Map();
    for (const [lessonId, bucket] of perLessonSeen) perLesson.set(lessonId, [...bucket.values()]);
    return { perLesson, global: [...globalSeen.values()] };
  }

  function renderReviewBanner(globalVocab) {
    const streak = EstLrnProgress.getStreak();
    // Only words already answered at least once — getDueWords() also counts every never-seen word,
    // which would make the banner claim the whole curriculum is "due" on day one.
    const dueCount = EstLrnProgress.getDueWords(globalVocab).filter((w) => EstLrnProgress.getBox(w.et) !== null).length;
    const hasNew = globalVocab.some((w) => EstLrnProgress.getBox(w.et) === null);

    const parts = [];
    if (streak.current > 0) parts.push(`🔥 ${streak.current}-day streak`);
    if (dueCount > 0) parts.push(`${dueCount} word${dueCount === 1 ? "" : "s"} due for review`);
    else if (hasNew) parts.push("Start today's review");
    reviewBannerEl.hidden = parts.length === 0;
    reviewBannerEl.textContent = parts.length > 0 ? `${parts.join(" · ")} →` : "";
  }

  async function loadLesson(lessonId) {
    lessonAudioEl.pause();
    clipAudioEl.pause();
    currentLesson = await fetchJson(`data/lessons/${lessonId}.json`);
    lessonAudioEl.src = currentLesson.lessonAudio[nativeLang];
    EstLrnSpeed.applyTo(lessonAudioEl);
    currentIndex = 0;
    setViewMode(viewMode);
    renderMasteryBar(lessonId);
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
    renderShadow();
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
      discardRecording();
      vocabWords = buildLessonVocab(currentLesson);
      vocabPage = 0;
      renderVocab();
    }
  }

  function playClip(src) {
    lessonAudioEl.pause(); // a manually-triggered clip always wins over the synced full-lesson track
    shadowAudioEl.pause();
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
      clipAudioEl.play().catch(onDone); // a failed play() fires neither event
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
    shadowAudioEl.pause();
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

  // --- Shadowing: record yourself, then hear the original and your attempt back to back ---------

  function sentenceKey() {
    return `${currentLesson.id}:${currentIndex}`;
  }

  function discardRecording() {
    if (recorder && recorder.state === "recording") {
      recorder.onstop = null; // a recording for a sentence that's no longer shown — throw it away
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
    }
    recorder = null;
    clearTimeout(recordingTimer);
    shadowAudioEl.pause();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
    recordingKey = null;
  }

  // Called from every render(): during "Play full lesson" render() fires as the track moves between
  // sentences, so only a real sentence change discards the recording.
  function renderShadow() {
    shadowControlsEl.hidden = !shadowSupported;
    if (!shadowSupported) return;
    if (recordingKey !== null && recordingKey !== sentenceKey()) discardRecording();
    const isRecording = !!recorder && recorder.state === "recording";
    shadowRecordBtn.textContent = isRecording ? "■ Stop recording" : recordingUrl ? "🎙 Record again" : "🎙 Record yourself";
    shadowRecordBtn.classList.toggle("recording", isRecording);
    shadowCompareBtn.disabled = !recordingUrl || isRecording;
    if (!isRecording && !recordingUrl) shadowStatusEl.textContent = "Listen first, then record yourself saying the Estonian sentence.";
  }

  async function startRecording() {
    stopPlayback(); // don't record the app's own audio
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      shadowStatusEl.textContent = "Microphone access was blocked — allow it in your browser to record.";
      console.error(err);
      return;
    }
    discardRecording();
    const key = sentenceKey();
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
    recorder.onstop = () => {
      clearTimeout(recordingTimer);
      stream.getTracks().forEach((t) => t.stop()); // release the mic (and the browser's "recording" indicator)
      recordingUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      recordingKey = key;
      recorder = null;
      shadowStatusEl.textContent = "Recorded. Compare it with the original — listen for vowel length and stress.";
      renderShadow();
    };
    recorder.start();
    recordingKey = key;
    recordingTimer = setTimeout(stopRecording, MAX_RECORDING_MS);
    shadowStatusEl.textContent = "Recording… say the sentence, then press Stop.";
    renderShadow();
  }

  function stopRecording() {
    if (recorder && recorder.state === "recording") recorder.stop();
  }

  function playRecording() {
    return new Promise((resolve) => {
      shadowAudioEl.src = recordingUrl;
      const onDone = () => {
        shadowAudioEl.removeEventListener("ended", onDone);
        shadowAudioEl.removeEventListener("pause", onDone);
        resolve();
      };
      shadowAudioEl.addEventListener("ended", onDone);
      shadowAudioEl.addEventListener("pause", onDone);
      // A failed play() fires neither event — resolve anyway so Compare isn't left disabled.
      shadowAudioEl.play().catch(onDone);
    });
  }

  // Original first, then yours — same stop-flag pattern as playCurrentSentence().
  async function compareRecording() {
    if (!recordingUrl) return;
    stopped = false;
    const sentence = currentLesson.sentences[currentIndex];
    shadowCompareBtn.disabled = true;
    try {
      shadowStatusEl.textContent = "Original…";
      await playClip(sentence.audioEt);
      if (stopped) return;
      shadowStatusEl.textContent = "You…";
      await playRecording();
    } finally {
      shadowStatusEl.textContent = "Record again until the two sound alike.";
      renderShadow();
    }
  }

  shadowRecordBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") stopRecording();
    else startRecording();
  });
  shadowCompareBtn.addEventListener("click", compareRecording);

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

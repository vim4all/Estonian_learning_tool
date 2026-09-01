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
  const playSentenceBtn = document.getElementById("play-sentence-btn");
  const playLessonBtn = document.getElementById("play-lesson-btn");
  const stopBtn = document.getElementById("stop-btn");
  const loopToggle = document.getElementById("loop-toggle");
  const clipAudioEl = document.getElementById("clip-audio-el");
  const lessonAudioEl = document.getElementById("lesson-audio-el");

  let currentLesson = null;
  let currentIndex = 0;
  let stopped = false;

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
      option.textContent = `${lesson.title.en} (${lesson.level})`;
      lessonSelect.appendChild(option);
    }

    lessonSelect.addEventListener("change", () => loadLesson(lessonSelect.value));
    if (manifest.length > 0) await loadLesson(manifest[0].id);
  }

  async function loadLesson(lessonId) {
    lessonAudioEl.pause();
    clipAudioEl.pause();
    currentLesson = await fetchJson(`data/lessons/${lessonId}.json`);
    lessonAudioEl.src = currentLesson.lessonAudio;
    currentIndex = 0;
    carousel.hidden = false;
    render();
  }

  function render() {
    const sentence = currentLesson.sentences[currentIndex];
    progressEl.textContent = `${currentIndex + 1} / ${currentLesson.sentences.length}`;
    topicTagEl.hidden = !sentence.lessonTitle;
    if (sentence.lessonTitle) topicTagEl.textContent = sentence.lessonTitle.en;
    sentenceEnEl.textContent = sentence.en;
    sentenceEtEl.textContent = sentence.et;
    notesEl.textContent = sentence.notes || "";
    notesEl.hidden = !sentence.notes;

    wordsEl.innerHTML = "";
    for (const word of sentence.words) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "word-chip";
      chip.innerHTML = `${word.et}<span class="ipa">${word.ipa ? "/" + word.ipa + "/" : ""}</span>`;
      chip.title = `${word.en} (${word.pos}${word.lemma !== word.et ? `, lemma: ${word.lemma}` : ""})`;
      chip.addEventListener("click", () => playClip(word.audioEt));
      wordsEl.appendChild(chip);
    }

    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === currentLesson.sentences.length - 1;
  }

  function playClip(src) {
    lessonAudioEl.pause(); // a manually-triggered clip always wins over the synced full-lesson track
    return new Promise((resolve) => {
      clipAudioEl.src = src;
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
      await playClip(sentence.audioEn);
      if (stopped) return;
      await playClip(sentence.audioEt);
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
      if (currentLesson.sentences[i].audioStart <= time) index = i;
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

  init();
})();

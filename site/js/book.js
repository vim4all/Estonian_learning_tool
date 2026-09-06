(function () {
  "use strict";

  const bookSelect = document.getElementById("book-select");
  const chapterSelect = document.getElementById("chapter-select");
  const reader = document.getElementById("book-reader");
  const chapterTitleEnEl = document.getElementById("chapter-title-en");
  const chapterTitleEtEl = document.getElementById("chapter-title-et");
  const bookAuthorEl = document.getElementById("book-author");
  const paragraphsEl = document.getElementById("paragraphs");
  const playChapterBtn = document.getElementById("play-chapter-btn");
  const stopBtn = document.getElementById("stop-btn");
  const hideEnToggle = document.getElementById("hide-en-toggle");
  const chapterAudioEl = document.getElementById("chapter-audio-el");
  const clipAudioEl = document.getElementById("clip-audio-el");

  const nativeLang = EstLrnLang.getNativeLang();
  const nativeAudioField = EstLrnLang.audioField(nativeLang);

  let manifest = [];
  let currentBookData = null;
  let tooltipEl = null;
  let stopped = false;

  EstLrnLang.initLangToggle();

  async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    return res.json();
  }

  async function init() {
    try {
      manifest = await fetchJson("data/books-manifest.json");
    } catch (err) {
      bookSelect.outerHTML =
        "<p>No books found yet. Run <code>npm run generate-audio</code> to build the site data, then reload.</p>";
      console.error(err);
      return;
    }

    manifest.sort((a, b) => a.order - b.order);
    for (const book of manifest) {
      const option = document.createElement("option");
      option.value = book.id;
      option.textContent = book.title[nativeLang];
      bookSelect.appendChild(option);
    }

    bookSelect.addEventListener("change", () => loadBook(bookSelect.value));
    chapterSelect.addEventListener("change", () => renderChapter(chapterSelect.value));

    if (manifest.length > 0) await loadBook(manifest[0].id);
  }

  async function loadBook(bookId) {
    const meta = manifest.find((b) => b.id === bookId);
    currentBookData = await fetchJson(`data/books/${bookId}.json`);

    chapterSelect.innerHTML = "";
    for (const chapter of meta.chapters) {
      const option = document.createElement("option");
      option.value = chapter.id;
      option.textContent = chapter.title[nativeLang];
      chapterSelect.appendChild(option);
    }

    bookAuthorEl.textContent = meta.author;
    reader.hidden = false;
    renderChapter(meta.chapters[0].id);
  }

  function renderChapter(chapterId) {
    const chapter = currentBookData.chapters.find((c) => c.id === chapterId);
    chapterAudioEl.pause();
    clipAudioEl.pause();
    chapterAudioEl.src = chapter.chapterAudio[nativeLang];

    chapterTitleEnEl.textContent = chapter.title[nativeLang];
    chapterTitleEtEl.textContent = chapter.title.et;

    paragraphsEl.innerHTML = "";
    for (const paragraph of chapter.paragraphs) {
      const pEl = document.createElement("div");
      pEl.className = "paragraph";
      for (const sentence of paragraph.sentences) {
        pEl.appendChild(renderSentencePair(sentence));
      }
      paragraphsEl.appendChild(pEl);
    }
  }

  function renderSentencePair(sentence) {
    const wrapper = document.createElement("div");
    wrapper.className = "sentence-pair";
    wrapper.tabIndex = 0;

    const enEl = document.createElement("p");
    enEl.className = "sentence-pair-en";
    enEl.textContent = sentence[nativeLang];

    const etEl = document.createElement("p");
    etEl.className = "sentence-pair-et";
    etEl.appendChild(renderGlossedText(sentence.et, sentence.words));

    wrapper.appendChild(enEl);
    wrapper.appendChild(etEl);

    wrapper.addEventListener("click", (event) => {
      if (event.target.closest(".gloss-word")) return;
      playSentencePair(sentence);
    });

    return wrapper;
  }

  const WORD_RE = /^([^\p{L}]*)([\p{L}]+(?:[-'][\p{L}]+)*)([^\p{L}]*)$/u;

  function renderGlossedText(text, words) {
    const glossMap = new Map();
    for (const word of words) glossMap.set(word.et.toLowerCase(), word);

    const frag = document.createDocumentFragment();
    const tokens = text.split(/(\s+)/);
    for (const token of tokens) {
      const match = token.match(WORD_RE);
      if (!match) {
        frag.appendChild(document.createTextNode(token));
        continue;
      }
      const [, lead, core, trail] = match;
      const gloss = glossMap.get(core.toLowerCase());
      if (lead) frag.appendChild(document.createTextNode(lead));
      if (gloss) {
        const span = document.createElement("span");
        span.className = "gloss-word";
        span.textContent = core;
        span.addEventListener("click", (event) => {
          event.stopPropagation();
          showGlossTooltip(span, gloss);
          playClip(gloss.audioEt);
        });
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(core));
      }
      if (trail) frag.appendChild(document.createTextNode(trail));
    }
    return frag;
  }

  function showGlossTooltip(anchorEl, gloss) {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "gloss-tooltip";
      document.body.appendChild(tooltipEl);
    }
    const parts = [gloss[nativeLang], gloss.pos];
    if (gloss.ipa) parts.push(`/${gloss.ipa}/`);
    tooltipEl.textContent = parts.join(" · ");
    const rect = anchorEl.getBoundingClientRect();
    tooltipEl.style.left = `${rect.left}px`;
    tooltipEl.style.top = `${rect.bottom + 6}px`;
    tooltipEl.style.display = "block";
    clearTimeout(showGlossTooltip._timer);
    showGlossTooltip._timer = setTimeout(() => {
      tooltipEl.style.display = "none";
    }, 2500);
  }

  function playClip(src) {
    chapterAudioEl.pause(); // a manually-triggered clip always wins over the playing chapter track
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

  async function playSentencePair(sentence) {
    stopped = false;
    await playClip(sentence[nativeAudioField]);
    if (stopped) return;
    await playClip(sentence.audioEt);
  }

  function stopPlayback() {
    stopped = true;
    chapterAudioEl.pause();
    chapterAudioEl.currentTime = 0;
    clipAudioEl.pause();
    clipAudioEl.currentTime = 0;
  }

  playChapterBtn.addEventListener("click", () => {
    stopped = true; // cut short any in-flight sentence/word clip sequence
    clipAudioEl.pause();
    chapterAudioEl.currentTime = 0;
    chapterAudioEl.play();
  });
  stopBtn.addEventListener("click", stopPlayback);

  hideEnToggle.addEventListener("change", () => {
    paragraphsEl.classList.toggle("hide-en", hideEnToggle.checked);
  });

  init();
})();

// Shared across index.html / book.html / quiz.html: which native language (English or Ukrainian)
// pairs with Estonian throughout the site. No bundler here, so this is a plain global rather than
// an ES module — load it before each page's own script.
(function (global) {
  "use strict";

  const STORAGE_KEY = "estlrn-native-lang";
  const LABELS = { en: "English", uk: "Ukrainian" };

  function getNativeLang() {
    return localStorage.getItem(STORAGE_KEY) === "uk" ? "uk" : "en";
  }

  function setNativeLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang === "uk" ? "uk" : "en");
  }

  function nativeLangLabel(lang) {
    return LABELS[lang] || LABELS.en;
  }

  // "en" -> "audioEn", "uk" -> "audioUk" — the enriched data's per-language audio field name.
  function audioField(lang) {
    return "audio" + lang[0].toUpperCase() + lang.slice(1);
  }

  // Wires up any ".lang-btn[data-lang]" buttons already in the page: marks the active one and
  // reloads on switch so the whole page re-fetches and re-renders in the new language.
  function initLangToggle() {
    const current = getNativeLang();
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === current);
      btn.addEventListener("click", () => {
        if (btn.dataset.lang === current) return;
        setNativeLang(btn.dataset.lang);
        location.reload();
      });
    });
  }

  global.EstLrnLang = { getNativeLang, setNativeLang, nativeLangLabel, audioField, initLangToggle };
})(window);

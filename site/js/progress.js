// Shared across quiz.html / practice.html: per-word spaced-repetition history and a daily practice
// streak, both localStorage-backed (single learner, single browser — no accounts, no backend).
(function (global) {
  "use strict";

  const HISTORY_KEY = "estlrn-word-progress"; // { [et]: { box, nextReview: "YYYY-MM-DD" } }
  const STREAK_KEY = "estlrn-streak"; // { lastDate, current, longest }

  // Leitner boxes: correct moves a word up (longer wait before it's due again), incorrect drops it
  // straight back to box 0 (due again tomorrow). No ease-factor bookkeeping like full SM-2 — good
  // enough for a single-learner offline tool, and easy to reason about.
  const BOX_INTERVAL_DAYS = [1, 2, 4, 8, 16, 32];

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage unavailable (private mode, quota) — progress just won't persist this session.
    }
  }

  function loadHistory() {
    return loadJson(HISTORY_KEY, {});
  }

  function recordAnswer(et, correct) {
    const history = loadHistory();
    const key = et.toLowerCase();
    const entry = history[key] || { box: 0 };
    const box = correct ? Math.min(entry.box + 1, BOX_INTERVAL_DAYS.length - 1) : 0;
    history[key] = { box, nextReview: addDays(todayStr(), BOX_INTERVAL_DAYS[box]) };
    saveJson(HISTORY_KEY, history);
    touchStreak();
  }

  // A word with no history yet counts as due, so new vocabulary keeps entering the rotation
  // alongside words that are actually scheduled for review.
  function isDue(et) {
    const entry = loadHistory()[et.toLowerCase()];
    return !entry || entry.nextReview <= todayStr();
  }

  function getDueWords(words) {
    return words.filter((w) => isDue(w.et));
  }

  function loadStreak() {
    return loadJson(STREAK_KEY, { lastDate: null, current: 0, longest: 0 });
  }

  // Advances the streak at most once per calendar day; a skipped day resets it to 1 on the next
  // practiced day rather than continuing where it left off.
  function touchStreak() {
    const streak = loadStreak();
    const today = todayStr();
    if (streak.lastDate === today) return;
    const yesterday = addDays(today, -1);
    streak.current = streak.lastDate === yesterday ? streak.current + 1 : 1;
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastDate = today;
    saveJson(STREAK_KEY, streak);
  }

  // Read-only view for display: if the last practiced day is neither today nor yesterday, the
  // streak has lapsed even though we haven't overwritten the stored record.
  function getStreak() {
    const streak = loadStreak();
    const today = todayStr();
    const yesterday = addDays(today, -1);
    if (streak.lastDate && streak.lastDate !== today && streak.lastDate !== yesterday) {
      return { ...streak, current: 0 };
    }
    return streak;
  }

  global.EstLrnProgress = { recordAnswer, isDue, getDueWords, getStreak };
})(window);

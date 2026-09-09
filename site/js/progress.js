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

  // Local-calendar-day arithmetic throughout, deliberately never touching toISOString()/UTC: a
  // learner's "today" is their local midnight-to-midnight, and mixing a local-time parse with a
  // UTC-formatted read (as an earlier version did) silently shifts every date by a day for anyone
  // east of UTC — which is most of this app's Estonia/Ukraine audience.
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatLocalDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function todayStr() {
    return formatLocalDate(new Date());
  }

  function addDays(dateStr, days) {
    const [y, m, day] = dateStr.split("-").map(Number);
    const d = new Date(y, m - 1, day);
    d.setDate(d.getDate() + days);
    return formatLocalDate(d);
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

  // A word counts as "mastered" once it's survived 3 correct reviews in a row (box >= 3, an 8-day-or-
  // longer interval) — a deliberately coarse bar for a per-lesson progress indicator, not a claim of
  // long-term retention. Unseen and recently-failed words (both sit at box 0) count the same: neither
  // is mastered yet.
  const MASTERED_BOX = 3;

  function getMasteryFraction(words) {
    if (words.length === 0) return 0;
    const history = loadHistory();
    const masteredCount = words.filter((w) => {
      const entry = history[w.et.toLowerCase()];
      return entry && entry.box >= MASTERED_BOX;
    }).length;
    return masteredCount / words.length;
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

  global.EstLrnProgress = { recordAnswer, isDue, getDueWords, getMasteryFraction, getStreak };
})(window);

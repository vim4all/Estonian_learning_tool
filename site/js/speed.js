// Shared across index.html / book.html: remembered audio playback speed, applied to whichever
// <audio> elements the page passes in. A plain global like lang.js — no module system here.
(function (global) {
  "use strict";

  const KEY = "estlrn-playback-speed";
  const SPEEDS = [0.75, 1, 1.25, 1.5];

  function getSpeed() {
    const stored = parseFloat(localStorage.getItem(KEY));
    return SPEEDS.includes(stored) ? stored : 1;
  }

  function setSpeed(speed) {
    try {
      localStorage.setItem(KEY, String(speed));
    } catch {
      // ignore — speed just won't persist this session
    }
  }

  // Assigning an <audio> element's `src` runs the browser's media-load algorithm, which resets
  // `playbackRate` back to 1 as one of its steps — so the rate does NOT simply persist across
  // future clips the way a naive read of the spec suggests. Every call site that sets `.src` on a
  // tracked element must call this again right after, not just once at page load.
  function applyTo(el) {
    el.playbackRate = getSpeed();
  }

  // Applies the stored speed to every given <audio> element now, and wires up ".speed-btn"
  // buttons already in the page to change it. Callers still need `applyTo()` after every `src`
  // assignment on these elements — see the comment on that function.
  function initSpeedToggle(audioEls) {
    audioEls.forEach(applyTo);

    document.querySelectorAll(".speed-btn").forEach((btn) => {
      btn.classList.toggle("active", parseFloat(btn.dataset.speed) === getSpeed());
      btn.addEventListener("click", () => {
        setSpeed(parseFloat(btn.dataset.speed));
        audioEls.forEach(applyTo);
        document.querySelectorAll(".speed-btn").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  global.EstLrnSpeed = { getSpeed, setSpeed, applyTo, initSpeedToggle };
})(window);

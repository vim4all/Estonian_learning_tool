// Shared across every page, loaded first: keeps phones from running a stale copy of the site.
// A plain global like lang.js — no module system here.
//
// The deploy workflow stamps the commit SHA into each page (`<html data-build>`, and `?v=` on every
// CSS/JS URL) and writes the same SHA to `version.json`. Mobile browsers hang on to cached pages and
// restore long-lived tabs without reloading, so an old page can keep fetching data/audio paths that
// no longer exist after a redeploy (e.g. a voice change renames every mp3). This checks the live
// `version.json` on load and whenever the tab comes back into view, and reloads once if it differs.
(function (global) {
  "use strict";

  const RELOADED_KEY = "estlrn-reloaded-for-build";
  const build = document.documentElement.dataset.build || "";
  // Unstamped (local `npm run serve`) pages still say "__BUILD__" — nothing to compare against.
  const stamped = build !== "" && !build.startsWith("__");

  // Appends the build id to a URL whose content can change without its name changing (combined
  // lesson/chapter tracks); per-clip mp3s are content-hashed and don't need it.
  function bust(url) {
    if (!stamped || !url) return url;
    return url + (url.includes("?") ? "&" : "?") + "v=" + build;
  }

  async function checkForUpdate() {
    if (!stamped) return;
    let live;
    try {
      const res = await fetch("version.json", { cache: "no-store" });
      if (!res.ok) return;
      live = (await res.json()).build;
    } catch {
      return; // offline or blocked — keep running what we have
    }
    if (!live || live === build) return;
    try {
      // Guard against a reload loop if a cache somewhere keeps serving the old HTML.
      if (sessionStorage.getItem(RELOADED_KEY) === live) return;
      sessionStorage.setItem(RELOADED_KEY, live);
    } catch {
      return;
    }
    location.reload();
  }

  checkForUpdate();
  // A restored (back/forward cache) page or a tab brought back after days never re-runs scripts.
  global.addEventListener("pageshow", (event) => {
    if (event.persisted) checkForUpdate();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });

  // fetch() options for generated JSON: always revalidate with the server (a cheap 304 when
  // unchanged) instead of trusting a possibly stale HTTP cache entry.
  const FETCH_OPTS = { cache: "no-cache" };

  global.EstLrnBuild = { id: build, bust, checkForUpdate, FETCH_OPTS };
})(window);

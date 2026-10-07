/* Shared only by the isolated content script and extension popup. */
(() => {
  "use strict";
  const defaults = Object.freeze({ home: "native", search: "native", profile: "native", bookmarks: "grid", likes: "grid" });
  const reserved = new Set(["i", "home", "search", "explore", "notifications", "messages", "settings",
    "compose", "login", "logout", "signup", "account", "tos", "privacy", "grok", "premium",
    "communities", "jobs", "about", "download", "intent", "share", "help", "oauth"]);
  function pageType(pathname) {
    const path = pathname.replace(/\/$/, "");
    if (path === "/home") return "home";
    if (path === "/search") return "search";
    if (path === "/i/history/likes") return "likes";
    if (path === "/i/history" || path === "/i/bookmarks") return "bookmarks";
    const profile = path.match(/^\/([a-zA-Z0-9_]{1,15})(?:\/(?:with_replies|media|highlights))?$/);
    return profile && !reserved.has(profile[1].toLowerCase()) ? "profile" : null;
  }
  function normalize(value) {
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
      [key, ["native", "grid"].includes(value?.[key]) ? value[key] : fallback]));
  }
  globalThis.BxlPages = Object.freeze({ defaults, pageType, normalize });
})();

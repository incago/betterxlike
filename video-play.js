/* Run at document_start in MAIN, before X can cache the native play method.
   Reject unwanted play() calls before decoding/rendering another video frame.
   Shared DOM attributes carry only short-lived player gestures, never user data. */
(() => {
  "use strict";
  const prototype = HTMLMediaElement.prototype;
  const installed = Symbol.for("better-x-likes.play-guard");
  if (prototype.play[installed]) return;
  const nativePlay = prototype.play;
  function guardedPlay(...args) {
    // The isolated script marks the configured route. Comparing the current URL
    // also lets X resume immediately on navigation before the next layout frame.
    const currentRoute = document.documentElement.getAttribute("data-bxl-path") === location.pathname + location.search;
    const guarded = this instanceof HTMLVideoElement && currentRoute &&
      document.documentElement.hasAttribute("data-bxl-active") &&
      this.closest('[data-bxl-grid] article[data-testid="tweet"]');
    if (guarded) {
      let allowed = this.hasAttribute("data-bxl-video-manual") ||
        Number(this.getAttribute("data-bxl-video-until")) > Date.now();
      if (!allowed) {
        for (let player = this.parentElement; player && !player.matches('article[data-testid="tweet"]'); player = player.parentElement) {
          if (Number(player.getAttribute("data-bxl-video-intent")) > Date.now()) {
            allowed = true;
            player.removeAttribute("data-bxl-video-intent");
            break;
          }
        }
      }
      if (!allowed) {
        return Promise.reject(new DOMException("Automatic video playback is disabled in the Better X Likes grid.", "NotAllowedError"));
      }
      this.setAttribute("data-bxl-video-manual", "");
    }
    return Reflect.apply(nativePlay, this, args);
  }
  Object.defineProperty(guardedPlay, installed, { value: true });
  prototype.play = guardedPlay;
})();

/* Media play events do not distinguish autoplay from a user-requested play.
   Authorize only the video player receiving a real pointer/keyboard gesture. */
(() => {
  "use strict";
  class VideoPolicy {
    constructor(active) {
      this.active = active;
      this.grid = null;
      this.videos = new Map();
      this.intents = new WeakMap();
      this.players = new Set();
      this.gesture = this.gesture.bind(this);
      this.play = this.play.bind(this);
      this.stop = this.stop.bind(this);
      this.listening = false;
    }

    contains(video) {
      return this.active() && video instanceof HTMLVideoElement &&
        video.closest("[data-bxl-grid]") === this.grid && Boolean(this.grid);
    }

    track(video) {
      if (!this.videos.has(video)) {
        let until = 0;
        for (let player = video.parentElement; player && !player.matches('article[data-testid="tweet"]'); player = player.parentElement) {
          if (this.intents.has(player)) {
            until = this.intents.get(player);
            this.intents.delete(player);
            break;
          }
        }
        this.videos.set(video, { autoplay: video.getAttribute("autoplay"), until, playing: false });
      }
      video.removeAttribute("autoplay");
      return this.videos.get(video);
    }

    gesture(event) {
      if (!event.isTrusted || !this.active() || !this.grid) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      if (event.type === "pointerdown" && event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const article = target.closest('article[data-testid="tweet"]');
      if (!article || !this.grid.contains(article)) return;
      const lazyPlayer = target.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]');
      if (lazyPlayer && article.contains(lazyPlayer) && !lazyPlayer.querySelector("video")) {
        const until = Date.now() + 1500;
        this.intents.set(lazyPlayer, until);
        lazyPlayer.setAttribute("data-bxl-video-intent", String(until));
        this.players.add(lazyPlayer);
        return;
      }
      // Stop before the article: clicking its text/like/share buttons must never
      // authorize a video elsewhere in that tweet (or another tweet).
      for (let player = target; player && player !== article; player = player.parentElement) {
        const videos = player.matches("video") ? [player] : [...player.querySelectorAll("video")];
        if (videos.length !== 1) continue;
        const video = videos[0];
        if (!this.contains(video)) return;
        if (video.paused) {
          const until = Date.now() + 1500;
          this.track(video).until = until;
          video.setAttribute("data-bxl-video-until", String(until));
        }
        return;
      }
    }

    play(event) {
      const video = event.target;
      if (!this.contains(video)) return;
      const state = this.track(video);
      if (state.playing || state.until > Date.now() || video.hasAttribute("data-bxl-video-manual")) {
        state.playing = true;
        state.until = 0;
        video.removeAttribute("data-bxl-video-until");
        video.setAttribute("data-bxl-video-manual", "");
      } else if (!video.paused) {
        video.pause();
      }
    }

    stop(event) {
      const state = this.videos.get(event.target);
      if (!state) return;
      // A queued pause from an earlier rejected autoplay must not revoke a
      // subsequent user-requested play that is already running.
      if (event.type !== "pause" || event.target.paused) {
        state.playing = false;
        state.until = 0;
        event.target.removeAttribute("data-bxl-video-manual");
        event.target.removeAttribute("data-bxl-video-until");
      }
    }

    release(video) {
      const state = this.videos.get(video);
      video.removeAttribute("data-bxl-video-manual");
      video.removeAttribute("data-bxl-video-until");
      if (state.autoplay !== null && !video.hasAttribute("autoplay")) {
        video.setAttribute("autoplay", state.autoplay);
      }
      this.videos.delete(video);
    }

    update(grid) {
      if (this.grid !== grid) this.clear();
      this.grid = grid;
      if (!grid) return;
      if (!this.listening) {
        for (const type of ["pointerdown", "click", "keydown"]) document.addEventListener(type, this.gesture, true);
        for (const type of ["play", "playing"]) document.addEventListener(type, this.play, true);
        for (const type of ["pause", "ended", "emptied"]) document.addEventListener(type, this.stop, true);
        this.listening = true;
      }
      const current = new Set(grid.querySelectorAll('article[data-testid="tweet"] video'));
      for (const player of this.players) {
        if (!grid.contains(player) || Number(player.getAttribute("data-bxl-video-intent")) <= Date.now()) {
          player.removeAttribute("data-bxl-video-intent");
          this.players.delete(player);
        }
      }
      for (const video of this.videos.keys()) if (!current.has(video)) this.release(video);
      for (const video of current) {
        this.track(video);
        if (!video.paused) this.play({ target: video });
      }
    }

    clear() {
      for (const type of ["pointerdown", "click", "keydown"]) document.removeEventListener(type, this.gesture, true);
      for (const type of ["play", "playing"]) document.removeEventListener(type, this.play, true);
      for (const type of ["pause", "ended", "emptied"]) document.removeEventListener(type, this.stop, true);
      this.listening = false;
      this.intents = new WeakMap();
      for (const player of this.players) player.removeAttribute("data-bxl-video-intent");
      this.players.clear();
      for (const video of this.videos.keys()) this.release(video);
      this.grid = null;
    }
  }
  globalThis.BxlVideoPolicy = VideoPolicy;
})();

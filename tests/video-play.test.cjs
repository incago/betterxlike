const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const guardSource = fs.readFileSync(path.join(__dirname, "..", "video-play.js"), "utf8");
const policySource = fs.readFileSync(path.join(__dirname, "..", "video.js"), "utf8");

function setup() {
  const dom = new JSDOM(`<html data-bxl-active data-bxl-path="/i/history/likes"><body><div data-bxl-grid><article data-testid="tweet"><div data-testid="videoPlayer"><video></video><button>Play</button></div></article><article data-testid="tweet"><video></video></article></div><aside><video></video><audio></audio></aside></body></html>`, { url: "https://x.com/i/history/likes", runScripts: "outside-only" });
  const { window } = dom;
  const states = new WeakMap();
  const state = video => {
    if (!states.has(video)) states.set(video, { paused: true, plays: 0, pauses: 0 });
    return states.get(video);
  };
  Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { get() { return state(this).paused; } });
  window.HTMLMediaElement.prototype.play = function () {
    const current = state(this); current.paused = false; current.plays++;
    this.dispatchEvent(new window.Event("play"));
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {
    const current = state(this); current.paused = true; current.pauses++;
    this.dispatchEvent(new window.Event("pause"));
  };
  window.eval(guardSource); window.eval(policySource);
  const policy = new window.BxlVideoPolicy(() => window.document.documentElement.hasAttribute("data-bxl-active") && window.document.documentElement.getAttribute("data-bxl-path") === window.location.pathname + window.location.search);
  const grid = window.document.querySelector("[data-bxl-grid]");
  policy.update(grid);
  const videos = [...window.document.querySelectorAll("video")];
  return { window, policy, grid, videos, state, gesture: target => policy.gesture({ target, type: "click", isTrusted: true }), close: () => { policy.clear(); window.close(); } };
}

test("failed native playback revokes manual permission and preserves the rejection", async t => {
  for (const synchronous of [false, true]) {
    const page = setup(); t.after(page.close);
    const [video] = page.videos;
    // Install a failing native method beneath a fresh guard.
    let calls = 0;
    const failure = new page.window.DOMException('Media unavailable', 'NotSupportedError');
    page.window.HTMLMediaElement.prototype.play = () => {
      calls++;
      if (synchronous) throw failure;
      return Promise.reject(failure);
    };
    page.window.eval(guardSource);
    let now = 100;
    page.window.Date.now = () => now;
    page.gesture(video);
    if (synchronous) assert.throws(() => video.play(), error => error === failure);
    else await assert.rejects(video.play(), error => error === failure);
    assert.equal(video.hasAttribute('data-bxl-video-manual'), false);
    assert.equal(video.hasAttribute('data-bxl-video-until'), false);
    now += 5000;
    await assert.rejects(video.play(), { name: 'NotAllowedError' });
    assert.equal(calls, 1);
    page.gesture(video);
    if (synchronous) assert.throws(() => video.play(), error => error === failure);
    else await assert.rejects(video.play(), error => error === failure);
    assert.equal(calls, 2, 'a fresh gesture still permits a new native attempt');
  }
});

test("a stale failed play cannot revoke a newer successful playback", async t => {
  const page = setup(); t.after(page.close);
  const [video] = page.videos;
  let rejectFirst;
  let calls = 0;
  page.window.HTMLMediaElement.prototype.play = function () {
    if (++calls === 1) return new Promise((_, reject) => { rejectFirst = reject; });
    page.state(this).paused = false;
    this.dispatchEvent(new page.window.Event('play'));
    return Promise.resolve();
  };
  page.window.eval(guardSource);
  page.gesture(video);
  const first = video.play();
  await video.play();
  rejectFirst(new page.window.DOMException('Interrupted', 'AbortError'));
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(video.hasAttribute('data-bxl-video-manual'), true);
  assert.equal(video.paused, false);
});

test("a thousand autoplay retries never invoke native play or pause or change playback speed", async (t) => {
  const page = setup(); t.after(page.close);
  const [video] = page.videos;
  video.currentTime = 7; video.playbackRate = 1;
  const results = await Promise.allSettled(Array.from({ length: 1000 }, () => video.play()));
  assert.ok(results.every(result => result.status === "rejected" && result.reason.name === "NotAllowedError"));
  assert.deepEqual(page.state(video), { paused: true, plays: 0, pauses: 0 });
  assert.equal(video.currentTime, 7);
  assert.equal(video.playbackRate, 1);
});

test("a trusted gesture allows native play for just that player and rejects pause-handler retries", async (t) => {
  const page = setup(); t.after(page.close);
  const [first, second] = page.videos;
  page.gesture(first.parentElement.querySelector("button"));
  await first.play();
  assert.equal(first.paused, false);
  await assert.rejects(second.play(), { name: "NotAllowedError" });
  let retry;
  first.addEventListener("pause", () => { retry = first.play().catch(error => error.name); });
  first.pause();
  assert.equal(await retry, "NotAllowedError");
  assert.deepEqual(page.state(first), { paused: true, plays: 1, pauses: 1 });
  assert.equal(first.hasAttribute("data-bxl-video-manual"), false);
});

test("a lazy player's trusted gesture crosses the DOM boundary and authorizes one new video", async (t) => {
  const page = setup(); t.after(page.close);
  const [first, second] = page.videos;
  const player = first.parentElement;
  first.remove(); page.policy.update(page.grid);
  page.gesture(player.querySelector("button"));
  const video = page.window.document.createElement("video"); player.prepend(video);
  await video.play();
  assert.equal(page.state(video).plays, 1);
  assert.equal(player.hasAttribute("data-bxl-video-intent"), false);
  await assert.rejects(second.play(), { name: "NotAllowedError" });
  page.policy.clear();
  assert.equal(video.hasAttribute("data-bxl-video-manual"), false);
  assert.equal(player.hasAttribute("data-bxl-video-intent"), false);
});

test("expired gestures and changed video sources cannot authorize autoplay", async (t) => {
  const page = setup(); t.after(page.close);
  const [video] = page.videos;
  let now = 100;
  page.window.Date.now = () => now;
  page.gesture(video); now += 2000;
  await assert.rejects(video.play(), { name: "NotAllowedError" });
  page.gesture(video); await video.play();
  video.dispatchEvent(new page.window.Event("emptied"));
  await assert.rejects(video.play(), { name: "NotAllowedError" });
});

test("outside videos, audio, disabled grids, and other routes retain the native play promise", async (t) => {
  const page = setup(); t.after(page.close);
  const [first, , outside] = page.videos;
  const audio = page.window.document.querySelector("audio");
  await outside.play(); await audio.play();
  assert.equal(page.state(outside).plays, 1);
  assert.equal(page.state(audio).plays, 1);
  page.window.history.pushState({}, "", "/home"); await first.play();
  assert.equal(page.state(first).plays, 1);
  page.window.history.pushState({}, "", "/i/history");
  page.window.document.documentElement.removeAttribute("data-bxl-active"); await first.play();
  assert.equal(page.state(first).plays, 2);
});

test("the guard installs once and the manifest loads it in MAIN at document_start", (t) => {
  const page = setup(); t.after(page.close);
  const play = page.window.HTMLMediaElement.prototype.play;
  page.window.eval(guardSource);
  assert.equal(page.window.HTMLMediaElement.prototype.play, play);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const entry = manifest.content_scripts.find(script => script.js.includes("video-play.js"));
  assert.equal(entry.world, "MAIN");
  assert.equal(entry.run_at, "document_start");
});

test("autoplay is blocked on each newly configured route and navigation immediately releases stale guards", async t => {
  for (const route of ["/home", "/search?q=cookie", "/incago", "/incago/with_replies"]) {
    const page = setup(); t.after(page.close);
    page.window.history.pushState({}, "", route);
    page.window.document.documentElement.setAttribute("data-bxl-path", route);
    await assert.rejects(page.videos[0].play(), { name: "NotAllowedError" });
    page.gesture(page.videos[0]); await page.videos[0].play();
    assert.equal(page.state(page.videos[0]).plays, 1);
    page.videos[0].pause();
    await assert.rejects(page.videos[0].play(), { name: "NotAllowedError" });
    page.window.history.pushState({}, "", "/someone/status/123");
    await page.videos[0].play();
    assert.equal(page.state(page.videos[0]).plays, 2);
  }
});

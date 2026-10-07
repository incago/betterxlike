const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "..", "video.js"), "utf8");

function setup() {
  const dom = new JSDOM(`<div data-bxl-grid><article data-testid="tweet"><p>Tweet text</p><div class="player"><video autoplay="autoplay"></video><button>Play</button></div><button class="like">Like</button></article><article data-testid="tweet"><div class="player"><video autoplay></video><button>Play</button></div></article></div><aside><video autoplay></video></aside>`, { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(source);
  let active = true;
  const policy = new window.BxlVideoPolicy(() => active);
  const grid = window.document.querySelector("[data-bxl-grid]");
  const videos = [...window.document.querySelectorAll("video")];
  function media(video) {
    let paused = true;
    Object.defineProperty(video, "paused", { get: () => paused });
    video.pause = () => { paused = true; video.dispatchEvent(new window.Event("pause")); };
    video.play = () => { paused = false; video.dispatchEvent(new window.Event("play")); return Promise.resolve(); };
    return video;
  }
  videos.forEach(media);
  const gesture = (target, extra = {}) => policy.gesture({ type: "click", target, isTrusted: true, ...extra });
  return { window, policy, grid, videos, gesture, media, setActive: value => { active = value; }, close: () => { policy.clear(); window.close(); } };
}

test("stops an already playing grid video and repeated X play attempts, leaving outside videos alone", (t) => {
  const page = setup(); t.after(page.close);
  const [first, second, outside] = page.videos;
  first.play(); page.policy.update(page.grid);
  assert.equal(first.paused, true);
  for (let i = 0; i < 3; i++) { first.play(); second.play(); }
  assert.equal(first.paused, true);
  assert.equal(second.paused, true);
  outside.play(); assert.equal(outside.paused, false);
  assert.equal(outside.autoplay, true);
});

test("a real player gesture allows only that video and survives layout updates", (t) => {
  const page = setup(); t.after(page.close); page.policy.update(page.grid);
  const [first, second] = page.videos;
  page.gesture(first.parentElement.querySelector("button"));
  first.play(); second.play(); page.policy.update(page.grid);
  assert.equal(first.paused, false);
  assert.equal(second.paused, true);
  first.dispatchEvent(new page.window.Event("playing"));
  assert.equal(first.paused, false);
  first.pause(); first.play();
  assert.equal(first.paused, true, "autoplay cannot restart after a pause");
  page.gesture(first, { type: "keydown", key: " " }); first.play();
  assert.equal(first.paused, false);
});

test("synthetic clicks, unrelated tweet actions, and non-play keyboard keys do not authorize playback", (t) => {
  const page = setup(); t.after(page.close); page.policy.update(page.grid);
  const [first] = page.videos;
  for (const [target, extra] of [
    [first, { isTrusted: false }],
    [page.grid.querySelector("p"), {}],
    [page.grid.querySelector(".like"), {}],
    [first, { type: "keydown", key: "Tab" }],
    [first, { type: "pointerdown", button: 2 }]
  ]) {
    page.gesture(target, extra); first.play();
    assert.equal(first.paused, true);
  }
});

test("a gesture expires and replaced media loses its previous manual permission", (t) => {
  const page = setup(); t.after(page.close); page.policy.update(page.grid);
  const [first] = page.videos;
  let now = 100;
  page.window.Date.now = () => now;
  page.gesture(first); now += 2000; first.play(); assert.equal(first.paused, true);
  page.gesture(first); first.play(); assert.equal(first.paused, false);
  first.dispatchEvent(new page.window.Event("emptied"));
  first.play(); assert.equal(first.paused, true);
});

test("new and recycled videos are guarded and detached videos are released", (t) => {
  const page = setup(); t.after(page.close); page.policy.update(page.grid);
  const [first] = page.videos;
  const replacement = page.media(page.window.document.createElement("video"));
  replacement.autoplay = true; first.replaceWith(replacement);
  replacement.play(); assert.equal(replacement.paused, true, "capture guard handles new nodes before the next layout update");
  page.policy.update(page.grid);
  assert.equal(first.autoplay, true);
  assert.equal(page.policy.videos.has(first), false);
  replacement.autoplay = true; page.policy.update(page.grid);
  assert.equal(replacement.autoplay, false);
});

test("disabling or leaving the collection immediately allows normal X playback and restores attributes", (t) => {
  const page = setup(); t.after(page.close); page.policy.update(page.grid);
  const [first, second] = page.videos;
  assert.equal(first.autoplay, false);
  page.setActive(false); first.play(); assert.equal(first.paused, false);
  page.policy.clear();
  assert.equal(first.getAttribute("autoplay"), "autoplay");
  assert.equal(second.getAttribute("autoplay"), "");
  assert.equal(page.policy.videos.size, 0);
  page.setActive(true); second.play(); assert.equal(second.paused, false, "listeners were removed");
  page.policy.update(page.grid); assert.equal(second.paused, true);
});

test("a trusted click on a lazy player authorizes the video created by that click only", (t) => {
  const page = setup(); t.after(page.close); page.policy.update(page.grid);
  const player = page.videos[0].parentElement;
  player.dataset.testid = "videoPlayer";
  page.videos[0].remove(); page.policy.update(page.grid);
  page.gesture(player.querySelector("button"));
  const lazyVideo = page.media(page.window.document.createElement("video"));
  player.prepend(lazyVideo); lazyVideo.play();
  assert.equal(lazyVideo.paused, false);
  page.videos[1].play(); assert.equal(page.videos[1].paused, true);
  page.policy.update(page.grid); assert.equal(lazyVideo.paused, false);
  lazyVideo.pause(); lazyVideo.play(); assert.equal(lazyVideo.paused, true);
});

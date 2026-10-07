const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
const layoutSource = fs.readFileSync(path.join(root, "layout.js"), "utf8");
const stylesheet = fs.readFileSync(path.join(root, "content.css"), "utf8");

function tweet(id) {
  return `<div data-testid="cellInnerDiv" style="position: absolute; transform: translateY(${id * 200}px)"><div><article data-testid="tweet"><a href="/writer/status/${id}">Tweet ${id}</a><button data-testid="unlike">Like</button></article></div></div>`;
}

function primary() {
  return `<div data-testid="primaryColumn"><div class="feed-stack"><section style="width: 600px; max-width: 600px; margin-left: auto"><div class="feed-inner"><div id="timeline" style="height: 2000px">${[1, 2, 3, 4, 5].map(tweet).join("")}<div data-testid="cellInnerDiv" id="loader">Loading</div></div></div></section></div></div>`;
}

function setup(url = "https://x.com/i/history/likes", enabled = true, deferSettings = false, pageModes) {
  const dom = new JSDOM(`<head><style>${stylesheet}</style></head><body><div id="shell"><header>Navigation</header><main><div id="wrapper">${primary()}<aside data-testid="sidebarColumn">Sidebar</aside></div></main></div></body>`, {
    url, runScripts: "outside-only", pretendToBeVisual: true
  });
  const { window } = dom;
  const listeners = [];
  let tick;
  let resolveSettings;
  window.setInterval = (callback) => { tick = callback; return 1; };
  window.chrome = {
    runtime: {},
    storage: {
      local: { get: (_, callback) => {
        resolveSettings = () => callback({ enabled, pageModes });
        if (!deferSettings) resolveSettings();
      } },
      onChanged: { addListener: (callback) => listeners.push(callback) }
    }
  };
  window.eval(fs.readFileSync(path.join(root, "pages.js"), "utf8"));
  window.eval(layoutSource);
  window.eval(fs.readFileSync(path.join(root, "video.js"), "utf8"));
  window.eval(source);
  return {
    window, document: window.document,
    resolveSettings: () => resolveSettings(),
    settle: () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))),
    setEnabled: (value, area = "local") => listeners.forEach((listener) => listener({ enabled: { newValue: value } }, area)),
    setModes: (value, area = "local") => listeners.forEach(listener => listener({ pageModes: { newValue: value } }, area)),
    navigate: (route) => { window.history.pushState({}, "", route); tick(); },
    close: () => { window.dispatchEvent(new window.Event("pagehide")); window.close(); }
  };
}

test("middle insertions shift cached offscreen posts and preserve unique ordered slots", async t => {
  const page = setup(); t.after(page.close); await page.settle();
  const grid = page.document.querySelector('#timeline');
  const old = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')];
  old[4].remove(); await page.settle();
  old[1].insertAdjacentHTML('beforebegin', tweet(99) + tweet(100));
  await page.settle();
  assert.deepEqual([...grid.querySelectorAll('[data-bxl-cell="tweet"]')].map(cell => cell.dataset.bxlIndex), ['0', '1', '2', '3', '4', '5']);
  grid.insertBefore(old[4], page.document.querySelector('#loader')); await page.settle();
  assert.equal(old[4].dataset.bxlIndex, '6');
  page.setEnabled(false); await page.settle();
  page.setEnabled(true); await page.settle();
  assert.deepEqual([...grid.querySelectorAll('[data-bxl-cell="tweet"]')].map(cell => cell.dataset.bxlIndex), ['0', '1', '2', '3', '4', '5', '6']);
});

test("reordering mounted posts preserves cached peers and subsequent insertion order", async t => {
  const page = setup(); t.after(page.close); await page.settle();
  const grid = page.document.querySelector('#timeline');
  const old = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')];
  old[4].remove();
  grid.insertBefore(old[2], old[1]); await page.settle();
  assert.equal(old[2].dataset.bxlIndex, '1');
  assert.equal(old[1].dataset.bxlIndex, '2');
  old[1].insertAdjacentHTML('beforebegin', tweet(99)); await page.settle();
  grid.insertBefore(old[4], page.document.querySelector('#loader')); await page.settle();
  assert.deepEqual([...grid.querySelectorAll('[data-bxl-cell="tweet"]')].map(cell => cell.dataset.bxlIndex), ['0', '1', '2', '3', '4', '5']);
});

test("applies to likes, keeps original React nodes, native inline styles, and click handlers", async (t) => {
  const page = setup(); t.after(page.close);
  const article = page.document.querySelector("article");
  const button = article.querySelector("button");
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  const transform = cell.style.transform;
  const position = cell.style.position;
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  await page.settle();
  assert.ok(page.document.documentElement.hasAttribute("data-bxl-active"));
  assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 5);
  assert.equal(page.document.querySelector("#loader").getAttribute("data-bxl-cell"), "other");
  assert.equal(page.document.querySelector("article"), article);
  assert.equal(cell.style.transform, transform);
  assert.equal(cell.style.position, position);
  button.click();
  assert.equal(clicks, 1);
});

test("new tweets and recycled loader cells get the right classification", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const timeline = page.document.querySelector("#timeline");
  timeline.insertAdjacentHTML("beforeend", tweet(6));
  page.document.querySelector("#loader").innerHTML = '<article data-testid="tweet">Recycled cell</article>';
  await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 7);
  assert.equal(page.document.querySelector("#loader").getAttribute("data-bxl-cell"), "tweet");
});

test("inline follow modules collapse without hiding tweets or loading controls and restore on disable", async t => {
  for (const virtual of [true, false]) {
    const page = setup('https://x.com/incago', true, false, { profile: 'grid' }); t.after(page.close);
    const grid = page.document.querySelector('#timeline');
    if (!virtual) for (const cell of grid.children) cell.removeAttribute('style');
    const first = grid.firstElementChild;
    first.querySelector('article').insertAdjacentHTML('beforeend', '<div data-testid="UserCell">Quoted account inside a post</div>');
    first.insertAdjacentHTML('afterend', '<div data-testid="cellInnerDiv" id="suggestions" style="position: absolute; transform: translateY(500px)"><div><h2>Who to follow</h2><div data-testid="UserCell"><button>Follow</button></div><a href="/i/connect_people">Show more</a></div></div>');
    if (!virtual) page.document.querySelector('#suggestions').removeAttribute('style');
    const rec = page.document.querySelector('#suggestions'); const nativeStyle = rec.style.cssText;
    const button = rec.querySelector('button'); let clicks = 0; button.addEventListener('click', () => clicks++);
    const loader = page.document.querySelector('#loader'); loader.innerHTML = '<div role="progressbar">Loading</div><button>Retry</button>';
    await page.settle();
    assert.equal(rec.dataset.bxlCell, 'recommendation');
    assert.equal(page.window.getComputedStyle(rec.firstElementChild).display, 'none');
    assert.equal(first.dataset.bxlCell, 'tweet');
    assert.equal(loader.dataset.bxlCell, 'other');
    assert.notEqual(page.window.getComputedStyle(loader).display, 'none');
    assert.deepEqual([...grid.querySelectorAll('[data-bxl-cell="tweet"]')].map(cell => cell.dataset.bxlIndex), virtual ? ['0', '1', '2', '3', '4'] : [undefined, undefined, undefined, undefined, undefined]);
    assert.equal(grid.style.height, '2000px');
    if (virtual) {
      assert.equal(page.window.getComputedStyle(rec).height, '0px');
      assert.equal(rec.style.transform, 'translateY(500px)');
    }
    page.setEnabled(false); await page.settle();
    assert.equal(rec.hasAttribute('data-bxl-cell'), false);
    assert.notEqual(page.window.getComputedStyle(rec.firstElementChild).display, 'none');
    assert.equal(rec.style.cssText, nativeStyle);
    assert.equal(rec.querySelector('button'), button); button.click(); assert.equal(clicks, 1);
  }
});

test("split recommendations include their heading and footer and recycled loader cells become visible", async t => {
  const page = setup(); t.after(page.close);
  const grid = page.document.querySelector('#timeline');
  grid.firstElementChild.insertAdjacentHTML('afterend', '<div data-testid="cellInnerDiv" id="follow-title"><h2>Suggested people in another language</h2></div><div data-testid="cellInnerDiv" id="follow-user"><div data-testid="UserCell"><button>Follow</button></div></div><div data-testid="cellInnerDiv" id="follow-more"><a href="/i/connect_people?user_id=123">More</a></div><div data-testid="cellInnerDiv" id="retry"><h2>Something went wrong</h2><div role="alert">Failed</div><button>Retry</button></div>');
  await page.settle();
  for (const id of ['follow-title', 'follow-user', 'follow-more']) assert.equal(page.document.getElementById(id).dataset.bxlCell, 'recommendation');
  assert.equal(page.document.getElementById('retry').dataset.bxlCell, 'other');
  const user = page.document.getElementById('follow-user');
  user.innerHTML = '<div role="progressbar">Loading more</div>'; await page.settle();
  assert.equal(user.dataset.bxlCell, 'other');
  assert.notEqual(page.window.getComputedStyle(user.firstElementChild).display, 'none');
  user.innerHTML = '<article data-testid="tweet"><a href="/writer/status/999">A new post</a></article>'; await page.settle();
  assert.equal(user.dataset.bxlCell, 'tweet');
  assert.notEqual(page.window.getComputedStyle(user.firstElementChild).display, 'none');
  page.document.getElementById('follow-title').innerHTML = '<div>팔로우 추천</div>'; await page.settle();
  assert.equal(page.document.getElementById('follow-title').dataset.bxlCell, 'recommendation');
  page.navigate('/explore'); await page.settle();
  assert.equal(page.document.querySelector('[data-bxl-cell="recommendation"]'), null);
});

test("disable restores all owned attributes and respects storage area", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  page.setEnabled(false, "sync"); await page.settle();
  assert.ok(page.document.documentElement.hasAttribute("data-bxl-active"));
  page.setEnabled(false); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-primary], [data-bxl-grid], [data-bxl-cell], [data-bxl-main], [data-bxl-wrapper], [data-bxl-shell], [data-bxl-active], [data-bxl-sidebar], [data-bxl-feed], [data-bxl-nav]').length, 0);
  const restored = page.document.querySelector("#timeline").style;
  assert.equal(restored.length, 1);
  assert.equal(restored.height, "2000px");
  page.setEnabled(true); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 5);
});

test("SPA pushState without a DOM mutation restores other routes and re-enters likes", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  page.navigate("/explore"); await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-active], [data-bxl-grid]").length, 0);
  page.navigate("/i/history/likes?test=1"); await page.settle();
  assert.ok(page.document.querySelector("[data-bxl-grid]"));
  page.navigate("/someone/status/123"); await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-active], [data-bxl-grid]").length, 0);
});

test("non-timeline routes and lookalike routes are untouched", async (t) => {
  for (const route of ["/explore", "/messages", "/notifications", "/settings", "/grok", "/someone/status/123", "/someone/followers", "/someone/likes", "/i/history/likes/more", "/i/history/likes-extra", "/i/history/search", "/i/history-extra", "/i/bookmarks-extra", "/i/bookmarks/123"]) {
    const page = setup(`https://x.com${route}`); t.after(page.close);
    await page.settle();
    assert.equal(page.document.querySelectorAll("[data-bxl-active], [data-bxl-primary], [data-bxl-cell]").length, 0, route);
  }
});

test("disabled startup does not alter the likes timeline", async (t) => {
  const page = setup("https://x.com/i/history/likes", false); t.after(page.close);
  await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-active], [data-bxl-grid]").length, 0);
});

test("does not briefly enable the grid while waiting for a saved disabled setting", async (t) => {
  const page = setup("https://x.com/i/history/likes", false, true); t.after(page.close);
  await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-active], [data-bxl-grid]").length, 0);
  page.resolveSettings(); await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-active], [data-bxl-grid]").length, 0);
});

test("replacing a timeline and a complete primary column works and cleans detached elements", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const oldGrid = page.document.querySelector("#timeline");
  oldGrid.outerHTML = `<div id="timeline">${tweet(9)}</div>`;
  await page.settle();
  assert.ok(!oldGrid.hasAttribute("data-bxl-grid"));
  assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 1);
  const oldPrimary = page.document.querySelector('[data-testid="primaryColumn"]');
  oldPrimary.outerHTML = primary(); await page.settle();
  assert.ok(!oldPrimary.hasAttribute("data-bxl-primary"));
  assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 5);
});

test("MutationObserver does not loop on its own attributes", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  let mutations = 0;
  const observer = new page.window.MutationObserver((records) => { mutations += records.length; });
  observer.observe(page.document.documentElement, { subtree: true, attributes: true });
  await page.settle(); await page.settle();
  observer.disconnect();
  assert.equal(mutations, 0);
});

test("a page with no tweets or no primary column does not throw", async (t) => {
  const page = setup(); t.after(page.close);
  page.document.querySelector("main").replaceChildren();
  await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-grid]").length, 0);
});

test("restored back-forward cache pages resume watching", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  page.window.dispatchEvent(new page.window.Event("pagehide"));
  page.window.dispatchEvent(new page.window.Event("pageshow"));
  page.document.querySelector("#timeline").insertAdjacentHTML("beforeend", tweet(10));
  await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 6);
});

test("bookmarks and likes use the same grid and hide the entire right sidebar", async (t) => {
  for (const route of ["/i/history", "/i/history/", "/i/history?tab=bookmarks", "/i/bookmarks", "/i/bookmarks/", "/i/history/likes", "/i/history/likes/"]) {
    const page = setup(`https://x.com${route}`); t.after(page.close);
    await page.settle();
    assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 5, route);
    assert.equal(page.document.querySelector("#timeline").getAttribute("data-bxl-layout"), "virtual", route);
    assert.equal(page.window.getComputedStyle(page.document.querySelector('[data-testid="sidebarColumn"]')).display, "none", route);
    assert.notEqual(page.window.getComputedStyle(page.document.querySelector("header")).display, "none", route);
  }
});

test("switching bookmarks to likes to explore restores the sidebar and layout", async (t) => {
  const page = setup("https://x.com/i/history"); t.after(page.close); await page.settle();
  const sidebar = page.document.querySelector('[data-testid="sidebarColumn"]');
  page.navigate("/i/history/likes"); await page.settle();
  assert.equal(page.window.getComputedStyle(sidebar).display, "none");
  page.navigate("/explore"); await page.settle();
  assert.notEqual(page.window.getComputedStyle(sidebar).display, "none");
  assert.notEqual(page.window.getComputedStyle(page.document.querySelector("#timeline")).display, "grid");
  assert.equal(page.document.querySelector("[data-bxl-sidebar]"), null);
});

test("a sidebar outside main is also hidden, and disabling restores it", async (t) => {
  const page = setup("https://x.com/i/history"); t.after(page.close);
  const sidebar = page.document.querySelector('[data-testid="sidebarColumn"]');
  page.document.querySelector("#shell").append(sidebar);
  await page.settle();
  assert.equal(page.window.getComputedStyle(sidebar).display, "none");
  page.setEnabled(false); await page.settle();
  assert.notEqual(page.window.getComputedStyle(sidebar).display, "none");
});

test("a dynamically added search/trend/follow rail without sidebarColumn is hidden as one column", async (t) => {
  const page = setup("https://x.com/i/history"); t.after(page.close); await page.settle();
  const sidebar = page.document.querySelector('[data-testid="sidebarColumn"]');
  sidebar.removeAttribute("data-testid");
  sidebar.innerHTML = '<input data-testid="SearchBox_Search_Input"><div data-testid="trend">Trend</div><div data-testid="UserCell">Follow</div>';
  await page.settle();
  assert.equal(page.window.getComputedStyle(sidebar).display, "none");
  assert.notEqual(page.window.getComputedStyle(page.document.querySelector('[data-testid="primaryColumn"]')).display, "none");
  sidebar.replaceChildren(); await page.settle();
  assert.notEqual(page.window.getComputedStyle(sidebar).display, "none");
  assert.equal(sidebar.hasAttribute("data-bxl-sidebar"), false);
});

test("widens all intermediate feed wrappers without modifying native inline styles", async (t) => {
  const page = setup(); t.after(page.close);
  const section = page.document.querySelector("section");
  const style = section.getAttribute("style");
  await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-feed]").length, 3);
  assert.equal(page.window.getComputedStyle(page.document.querySelector(".feed-stack")).display, "block");
  assert.equal(page.document.querySelector("header").hasAttribute("data-bxl-feed"), false);
  assert.equal(page.document.querySelector("article").hasAttribute("data-bxl-feed"), false);
  assert.equal(section.getAttribute("style"), style);
  page.setEnabled(false); await page.settle();
  assert.equal(page.document.querySelectorAll("[data-bxl-feed], [data-bxl-nav]").length, 0);
  assert.equal(section.getAttribute("style"), style);
});

test("replacing a feed removes obsolete wrapper markers", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const section = page.document.querySelector("section");
  section.replaceChildren();
  page.document.querySelector('[data-testid="primaryColumn"]').insertAdjacentHTML("beforeend", `<div id="new-feed">${tweet(42)}</div>`);
  await page.settle();
  assert.equal(page.document.querySelector("#new-feed").hasAttribute("data-bxl-grid"), true);
  assert.equal(page.document.querySelectorAll("[data-bxl-feed]").length, 0);
});

test("preserves native list height and Y offsets while giving four tweets equal short slots", async (t) => {
  const page = setup(); t.after(page.close);
  const grid = page.document.querySelector("#timeline");
  grid.style.minHeight = "2300px";
  await page.settle();
  const cells = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')];
  assert.equal(page.window.getComputedStyle(grid).minHeight, "2300px");
  assert.equal(page.window.getComputedStyle(grid).height, "2000px");
  for (const [i, cell] of cells.entries()) {
    assert.equal(cell.style.transform, `translateY(${(i + 1) * 200}px)`);
    assert.equal(cell.style.getPropertyValue("--bxl-slot-height"), "84px");
    assert.equal(cell.firstElementChild.style.getPropertyValue("--bxl-rise"), `${-(i % 4) * 84}px`);
  }
  page.setEnabled(false); await page.settle();
  assert.equal(page.document.querySelector("[data-bxl-tail]"), null);
  assert.ok(cells.every(cell => !cell.style.getPropertyValue("--bxl-slot-height")));
});

test("native style rewrites do not remove the slot layout permanently", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const cell = page.document.querySelector('[data-bxl-cell="tweet"]');
  cell.setAttribute("style", "position: absolute; transform: translateY(901px); width: 100%");
  await page.settle();
  assert.equal(cell.style.transform, "translateY(901px)");
  assert.equal(cell.style.width, "100%");
  assert.equal(cell.style.getPropertyValue("--bxl-slot-height"), "84px");
});

test("indices and columns survive offscreen unmounting and remounting", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const grid = page.document.querySelector("#timeline");
  const cells = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')];
  cells.slice(0, 3).forEach(cell => cell.remove());
  grid.insertAdjacentHTML("beforeend", tweet(6) + tweet(7) + tweet(8));
  await page.settle();
  assert.equal(cells[3].getAttribute("data-bxl-index"), "3");
  assert.equal(cells[3].firstElementChild.style.getPropertyValue("--bxl-rise"), "-252px");
  grid.insertAdjacentHTML("afterbegin", tweet(1) + tweet(2) + tweet(3));
  await page.settle();
  assert.deepEqual([...grid.querySelectorAll('[data-bxl-cell="tweet"]')].map(cell => cell.getAttribute("data-bxl-index")), ["0", "1", "2", "3", "4", "5", "6", "7"]);
});

test("home refresh prepends start at column zero and reindex cached offscreen posts", async t => {
  const page = setup("https://x.com/home", true, false, { home: "grid" }); t.after(page.close); await page.settle();
  const grid = page.document.querySelector('#timeline');
  const old = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')];
  old[4].remove(); // Its order must move too, even while X has it unmounted.
  let inserted = 0;
  for (const amount of [1, 3, 35]) {
    const ids = Array.from({ length: amount }, (_, index) => 1000 + inserted + index);
    grid.insertAdjacentHTML('afterbegin', ids.map(tweet).join(''));
    inserted += amount;
    grid.firstElementChild.style.transform = 'translateY(0px)';
    await page.settle();
    const first = grid.firstElementChild;
    assert.equal(first.getAttribute('data-bxl-index'), '0');
    assert.equal(first.style.getPropertyValue('--bxl-left'), '16px');
    assert.equal(parseFloat(first.firstElementChild.style.getPropertyValue('--bxl-rise')), 0);
    assert.equal(old[0].getAttribute('data-bxl-index'), String(inserted));
    const indices = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')].map(cell => Number(cell.dataset.bxlIndex));
    assert.ok(indices.every(index => index >= 0));
    assert.equal(new Set(indices).size, indices.length);
  }
  grid.append(old[4]); await page.settle();
  assert.equal(old[4].getAttribute('data-bxl-index'), String(inserted + 4));
  page.setEnabled(false); await page.settle();
  page.setEnabled(true); await page.settle();
  assert.equal(grid.firstElementChild.getAttribute('data-bxl-index'), '0');
  assert.equal(old[4].getAttribute('data-bxl-index'), String(inserted + 4));
});

test("home refresh replacing the same native timeline resets order and obsolete heights", async t => {
  const page = setup("https://x.com/home", true, false, { home: "grid" }); t.after(page.close);
  const grid = page.document.querySelector('#timeline');
  grid.firstElementChild.firstElementChild.getBoundingClientRect = () => ({ height: 1200 });
  await page.settle();
  grid.innerHTML = tweet(1000) + tweet(1001);
  grid.firstElementChild.style.transform = 'translateY(0px)';
  await page.settle();
  assert.equal(grid.firstElementChild.getAttribute('data-bxl-index'), '0');
  assert.equal(grid.lastElementChild.getAttribute('data-bxl-index'), '1');
  assert.equal(grid.firstElementChild.style.getPropertyValue('--bxl-slot-height'), '84px');
  assert.equal(parseFloat(grid.firstElementChild.firstElementChild.style.getPropertyValue('--bxl-rise')), 0);
  // A disjoint window at a nonzero native offset is ordinary virtual paging.
  grid.innerHTML = tweet(1002) + tweet(1003); await page.settle();
  assert.equal(grid.firstElementChild.getAttribute('data-bxl-index'), '2');
  assert.equal(grid.lastElementChild.getAttribute('data-bxl-index'), '3');
});

test("a cropped home timeline with an existing post at native origin starts a new first row", async t => {
  const page = setup("https://x.com/home", true, false, { home: "grid" }); t.after(page.close); await page.settle();
  const grid = page.document.querySelector('#timeline');
  const cells = [...grid.querySelectorAll('[data-bxl-cell="tweet"]')];
  cells.slice(0, 2).forEach(cell => cell.remove());
  await page.settle();
  assert.equal(cells[2].getAttribute('data-bxl-index'), '2');
  cells[2].style.transform = 'translateY(0px)';
  await page.settle();
  assert.equal(cells[2].getAttribute('data-bxl-index'), '0');
  assert.equal(parseFloat(cells[2].firstElementChild.style.getPropertyValue('--bxl-rise')), 0);
});

test("late taller content changes every slot in its row without overriding native offsets", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const cells = [...page.document.querySelectorAll('[data-bxl-cell="tweet"]')];
  cells[2].firstElementChild.getBoundingClientRect = () => ({ height: 800, width: 245 });
  page.window.dispatchEvent(new page.window.Event("resize")); await page.settle();
  assert.ok(cells.slice(0, 4).every(cell => cell.style.getPropertyValue("--bxl-slot-height") === "204px"));
  assert.equal(cells[2].style.transform, "translateY(600px)");
  assert.equal(cells[2].firstElementChild.style.getPropertyValue("--bxl-rise"), "-408px");
});

test("disabling and re-enabling halfway through the list keeps known column identities", async (t) => {
  const page = setup(); t.after(page.close); await page.settle();
  const cells = [...page.document.querySelectorAll('[data-bxl-cell="tweet"]')];
  cells.slice(0, 3).forEach(cell => cell.remove()); await page.settle();
  page.setEnabled(false); await page.settle();
  page.setEnabled(true); await page.settle();
  assert.equal(cells[3].getAttribute("data-bxl-index"), "3");
  assert.equal(cells[4].getAttribute("data-bxl-index"), "4");
});

test("resizing regroups virtual rows and slots while preserving native geometry and tweet order", async (t) => {
  const page = setup(); t.after(page.close);
  const grid = page.document.querySelector("#timeline");
  let width = 1200;
  grid.getBoundingClientRect = () => ({ width });
  grid.style.minHeight = "2300px";
  const cells = [...grid.querySelectorAll('[data-testid="cellInnerDiv"]')].slice(0, 5);
  cells[2].firstElementChild.getBoundingClientRect = () => ({ height: 800 });
  await page.settle();
  for (const [nextWidth, columns] of [[1200, 4], [1060, 4], [1059, 3], [800, 3], [799, 2], [650, 2], [540, 2], [539, 1], [320, 1], [650, 2], [1200, 4]]) {
    width = nextWidth;
    page.window.dispatchEvent(new page.window.Event("resize")); await page.settle();
    assert.equal(grid.style.getPropertyValue("--bxl-columns"), String(columns));
    const cardWidth = (width - 32 - 16 * (columns - 1)) / columns;
    for (const [index, cell] of cells.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const height = row === Math.floor(2 / columns) ? 800 : 320;
      const slot = Math.ceil((height + 16) / columns);
      assert.equal(cell.getAttribute("data-bxl-index"), String(index));
      assert.equal(cell.style.getPropertyValue("--bxl-width"), `${cardWidth}px`);
      assert.equal(cell.style.getPropertyValue("--bxl-left"), `${16 + column * (cardWidth + 16)}px`);
      assert.equal(cell.style.getPropertyValue("--bxl-slot-height"), `${slot}px`);
      assert.equal(cell.firstElementChild.style.getPropertyValue("--bxl-rise"), `${-column * slot}px`);
      assert.equal(cell.style.transform, `translateY(${(index + 1) * 200}px)`);
    }
    assert.equal(grid.style.height, "2000px");
    assert.equal(grid.style.minHeight, "2300px");
  }
  page.setEnabled(false); await page.settle();
  assert.equal(grid.style.getPropertyValue("--bxl-columns"), "");
  assert.equal(grid.getAttribute("style"), "height: 2000px; min-height: 2300px;");
});

test("ordinary flow lists use the same responsive columns and restore on disable", async (t) => {
  const page = setup(); t.after(page.close);
  const grid = page.document.querySelector("#timeline");
  for (const cell of grid.children) cell.removeAttribute("style");
  let width = 900;
  grid.getBoundingClientRect = () => ({ width });
  await page.settle();
  assert.equal(grid.dataset.bxlLayout, "flow");
  assert.equal(grid.style.getPropertyValue("--bxl-columns"), "3");
  width = 650;
  page.window.dispatchEvent(new page.window.Event("resize")); await page.settle();
  assert.equal(grid.style.getPropertyValue("--bxl-columns"), "2");
  width = 400;
  page.window.dispatchEvent(new page.window.Event("resize")); await page.settle();
  assert.equal(grid.style.getPropertyValue("--bxl-columns"), "1");
  width = 1300;
  page.window.dispatchEvent(new page.window.Event("resize")); await page.settle();
  assert.equal(grid.style.getPropertyValue("--bxl-columns"), "4");
  page.setEnabled(false); await page.settle();
  assert.equal(grid.style.getPropertyValue("--bxl-columns"), "");
});

test("video autoplay guarding follows the grid setting, SPA routes, and dynamically added videos", async (t) => {
  const page = setup(); t.after(page.close);
  const video = page.document.createElement("video");
  video.autoplay = true;
  let paused = false;
  Object.defineProperty(video, "paused", { get: () => paused });
  video.pause = () => { paused = true; video.dispatchEvent(new page.window.Event("pause")); };
  video.play = () => { paused = false; video.dispatchEvent(new page.window.Event("play")); };
  page.document.querySelector("article").append(video);
  await page.settle();
  assert.equal(paused, true);
  assert.equal(video.autoplay, false);
  video.play(); assert.equal(paused, true);
  page.setEnabled(false); await page.settle();
  assert.equal(video.autoplay, true);
  video.play(); assert.equal(paused, false);
  page.setEnabled(true); await page.settle();
  assert.equal(paused, true);
  page.navigate("/explore"); await page.settle();
  assert.equal(video.autoplay, true);
  video.play(); assert.equal(paused, false);
  page.navigate("/i/history"); await page.settle();
  assert.equal(paused, true);
  video.autoplay = true; await page.settle();
  assert.equal(video.autoplay, false);
});

test("home, search queries, and profile tweet tabs share the responsive grid without moving headers", async t => {
  for (const route of ["/home", "/home/", "/search?q=%EC%BF%A0%ED%82%A4%EB%9F%B0&src=typed_query", "/incago", "/incago/", "/incago/with_replies", "/incago/media", "/incago/highlights"]) {
    const page = setup(`https://x.com${route}`); t.after(page.close);
    const primary = page.document.querySelector('[data-testid="primaryColumn"]');
    const header = page.document.createElement("h1"); header.textContent = "Profile / composer / search header"; primary.prepend(header);
    const original = page.document.querySelector("article");
    await page.settle();
    assert.equal(page.document.querySelector('[data-bxl-grid]'), null, route);
    assert.notEqual(page.window.getComputedStyle(page.document.querySelector('[data-testid="sidebarColumn"]')).display, 'none');
    page.setModes({ home: 'grid', search: 'grid', profile: 'grid' });
    await page.settle();
    assert.equal(page.document.querySelectorAll('[data-bxl-cell="tweet"]').length, 5, route);
    assert.equal(header.parentElement, primary);
    assert.ok(!header.hasAttribute("data-bxl-card"));
    assert.equal(page.document.querySelector("article"), original);
    assert.equal(page.window.getComputedStyle(page.document.querySelector('[data-testid="sidebarColumn"]')).display, "none");
  }
});

test("profile chrome spans the timeline while photo sizes are bounded and restore on route or setting changes", async t => {
  const page = setup("https://x.com/incago", true, false, { profile: "grid", search: "grid" }); t.after(page.close);
  const primary = page.document.querySelector('[data-testid="primaryColumn"]');
  primary.insertAdjacentHTML('afterbegin', '<div id="profile-title" style="position: sticky; top: 0px">Profile title</div>');
  const stack = primary.querySelector('.feed-stack');
  stack.insertAdjacentHTML('afterbegin', '<div id="profile-info" style="width: 100%; margin-left: auto"><a id="cover" href="/incago/header_photo" style="aspect-ratio: 3 / 1"><div style="padding-bottom:33.3333%"></div><img alt="Banner"></a><a id="avatar" href="/incago/photo" style="width: 25%; margin-top:-12.5%">Avatar</a><a id="mutual-avatar" href="/friend/photo">Mutual follower</a><button>Edit profile</button></div>');
  const inner = primary.querySelector('.feed-inner');
  inner.insertAdjacentHTML('beforebegin', '<nav id="profile-tabs">Posts / Replies / Media</nav>');
  const headers = ['profile-title', 'profile-info', 'profile-tabs'].map(id => page.document.getElementById(id));
  const nativeStyles = headers.map(header => header.getAttribute('style'));
  await page.settle();
  for (const header of headers) {
    assert.ok(header.hasAttribute('data-bxl-profile-header'));
    assert.equal(page.window.getComputedStyle(header).maxWidth, 'none');
  }
  const grid = page.document.querySelector('#timeline');
  assert.equal(page.window.getComputedStyle(grid).maxWidth, 'none');
  assert.equal(grid.hasAttribute('data-bxl-profile-header'), false);
  assert.equal(stack.hasAttribute('data-bxl-profile-header'), false);
  assert.equal(page.document.querySelector('#avatar').style.width, '25%');
  assert.equal(page.document.querySelector('#cover').style.aspectRatio, '3 / 1');
  assert.equal(page.window.getComputedStyle(page.document.querySelector('#cover')).maxHeight, '200px');
  assert.equal(page.window.getComputedStyle(page.document.querySelector('#cover img')).objectFit, 'cover');
  assert.equal(page.window.getComputedStyle(page.document.querySelector('#avatar')).maxWidth, '145px');
  assert.ok(page.document.querySelector('#avatar').hasAttribute('data-bxl-profile-overlap'));
  assert.equal(page.document.querySelector('#mutual-avatar').hasAttribute('data-bxl-profile-avatar'), false);
  const button = headers[1].querySelector('button'); let clicks = 0;
  button.addEventListener('click', () => clicks++); button.click(); assert.equal(clicks, 1);
  headers[1].remove();
  stack.insertAdjacentHTML('afterbegin', '<div id="replacement-info">New profile info</div>');
  await page.settle();
  assert.equal(headers[1].hasAttribute('data-bxl-profile-header'), false);
  assert.equal(headers[1].querySelector('[data-bxl-profile-cover], [data-bxl-profile-avatar]'), null);
  assert.ok(page.document.querySelector('#replacement-info').hasAttribute('data-bxl-profile-header'));
  for (const route of ['/incago/with_replies', '/incago/media', '/incago/highlights']) {
    page.navigate(route); await page.settle();
    assert.ok(headers[0].hasAttribute('data-bxl-profile-header'));
  }
  page.navigate('/search?q=cookie'); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-profile-header]').length, 0);
  assert.ok(page.document.querySelector('[data-bxl-grid]'));
  page.navigate('/incago'); await page.settle();
  page.setModes({ profile: 'native' }); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-profile-header], [data-bxl-grid]').length, 0);
  assert.deepEqual(headers.map(header => header.getAttribute('style')), nativeStyles);
  page.setModes({ profile: 'grid' }); await page.settle();
  page.setEnabled(false); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-profile-header]').length, 0);
});

test("separate banner wrapper and positioned avatar preserve native geometry and photo links", async t => {
  const page = setup('https://x.com/incago', true, false, { profile: 'grid', home: 'grid' }); t.after(page.close);
  const stack = page.document.querySelector('.feed-stack');
  stack.insertAdjacentHTML('afterbegin', '<div id="profile-info"><div id="cover-wrapper" style="height:200px"><a href="https://x.com/incago/header_photo"><img alt="Banner"></a></div><div><a id="portrait" href="/incago/photo" style="position:absolute;transform:translateY(-50%);width:136px;height:136px"><img alt="Avatar"></a><button>Edit profile</button></div></div>');
  const portrait = page.document.querySelector('#portrait');
  const native = portrait.style.cssText;
  await page.settle();
  assert.ok(page.document.querySelector('#cover-wrapper').hasAttribute('data-bxl-profile-cover'));
  assert.ok(portrait.hasAttribute('data-bxl-profile-avatar'));
  assert.equal(portrait.hasAttribute('data-bxl-profile-overlap'), false);
  assert.equal(portrait.style.cssText, native);
  assert.equal(portrait.getAttribute('href'), '/incago/photo');
  page.navigate('/home'); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-profile-header], [data-bxl-profile-cover], [data-bxl-profile-avatar], [data-bxl-profile-overlap]').length, 0);
  assert.equal(portrait.style.cssText, native);
});

test("blank profile banners are bounded without changing portrait spacers or tweet media", async t => {
  const page = setup('https://x.com/incago', true, false, { profile: 'grid' }); t.after(page.close);
  const stack = page.document.querySelector('.feed-stack');
  stack.insertAdjacentHTML('afterbegin', '<div id="profile-info"><div id="blank-cover"><div style="padding-bottom:33.3333%"></div></div><a href="/incago/photo"><div id="portrait-spacer" style="padding-bottom:100%"></div></a></div>');
  page.document.querySelector('article').insertAdjacentHTML('beforeend', '<div id="tweet-media"><div style="padding-bottom:33.3333%"></div></div>');
  await page.settle();
  assert.ok(page.document.querySelector('#blank-cover').hasAttribute('data-bxl-profile-cover'));
  assert.equal(page.document.querySelector('#portrait-spacer').hasAttribute('data-bxl-profile-cover'), false);
  assert.equal(page.document.querySelector('#tweet-media').hasAttribute('data-bxl-profile-cover'), false);
  page.setModes({ profile: 'native' }); await page.settle();
  assert.equal(page.document.querySelectorAll('[data-bxl-profile-cover]').length, 0);
  assert.equal(page.document.querySelector('#blank-cover > div').style.paddingBottom, '33.3333%');
});

test("percentage portrait frames and parent overlap are bounded together and restore", async t => {
  const page = setup('https://x.com/incago', true, false, {profile:'grid'}); t.after(page.close);
  page.document.querySelector('.feed-stack').insertAdjacentHTML('afterbegin', '<div id="profile-info"><a href="/incago/header_photo"><div style="padding-bottom:33.3333%"></div></a><div id="action-row"><div id="portrait-frame" style="position:relative;width:25%;margin-top:-15%"><div style="padding-bottom:100%"></div><a id="portrait" href="/incago/photo" style="position:absolute;inset:0;width:100%;height:100%">Photo</a></div><button>Follow</button></div><p>Name</p></div>');
  const frame = page.document.querySelector('#portrait-frame'); const row = page.document.querySelector('#action-row');
  const original = frame.style.cssText;
  await page.settle();
  assert.ok(frame.hasAttribute('data-bxl-profile-avatar'));
  assert.ok(frame.hasAttribute('data-bxl-profile-overlap'));
  assert.equal(page.window.getComputedStyle(frame).maxWidth,'145px');
  assert.equal(row.hasAttribute('data-bxl-profile-avatar'),false);
  assert.equal(row.hasAttribute('data-bxl-profile-overlap'),false);
  page.setModes({profile:'native'}); await page.settle();
  assert.equal(frame.hasAttribute('data-bxl-profile-avatar'),false);
  assert.equal(frame.hasAttribute('data-bxl-profile-overlap'),false);
  assert.equal(frame.style.cssText, original);
});

test("a bounded portrait frame remains stable after its measured width changes", async t => {
  const page = setup('https://x.com/incago',true,false,{profile:'grid'}); t.after(page.close);
  page.document.querySelector('.feed-stack').insertAdjacentHTML('afterbegin','<div id="profile-info"><div id="portrait-row"><div id="portrait-frame"><a href="/incago/photo">Photo</a></div><button>Follow</button></div></div>');
  const frame=page.document.querySelector('#portrait-frame'); const row=page.document.querySelector('#portrait-row');
  let measuredWidth=300;
  frame.getBoundingClientRect=()=>({width:measuredWidth}); row.getBoundingClientRect=()=>({width:1200});
  await page.settle(); assert.ok(frame.hasAttribute('data-bxl-profile-avatar'));
  measuredWidth=145; row.querySelector('button').textContent='Following';
  await page.settle(); assert.ok(frame.hasAttribute('data-bxl-profile-avatar'));
  row.append(frame.firstElementChild); frame.textContent='Unrelated content';
  await page.settle(); assert.equal(frame.hasAttribute('data-bxl-profile-avatar'),false);
});

test("native settings affect only the chosen page and survive route changes", async t => {
  const modes = { home: "native", search: "grid", profile: "native", bookmarks: "native" };
  const page = setup("https://x.com/home", true, false, modes); t.after(page.close);
  for (const route of ["/home", "/incago", "/incago/with_replies", "/i/history"]) {
    page.navigate(route); await page.settle();
    assert.equal(page.document.querySelector("[data-bxl-grid]"), null, route);
    assert.notEqual(page.window.getComputedStyle(page.document.querySelector('[data-testid="sidebarColumn"]')).display, "none");
  }
  for (const route of ["/search?q=cookie", "/i/history/likes"]) {
    page.navigate(route); await page.settle();
    assert.ok(page.document.querySelector("[data-bxl-grid]"), route);
  }
});

test("changing a page setting immediately restores and reapplies native layout on open tabs", async t => {
  const page = setup("https://x.com/search?q=cookie", true, false, { search: "grid" }); t.after(page.close); await page.settle();
  const article = page.document.querySelector("article");
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  const nativeStyle = cell.style.transform;
  page.setModes({ search: "native" }, "sync"); await page.settle();
  assert.ok(page.document.querySelector("[data-bxl-grid]"));
  page.setModes({ search: "native" }); await page.settle();
  assert.equal(page.document.querySelector("[data-bxl-grid]"), null);
  assert.equal(page.document.documentElement.hasAttribute("data-bxl-path"), false);
  assert.equal(cell.style.transform, nativeStyle);
  page.setModes(undefined); await page.settle();
  assert.equal(page.document.querySelector("[data-bxl-grid]"), null);
  page.setModes({ search: "grid" }); await page.settle();
  assert.ok(page.document.querySelector("[data-bxl-grid]"));
  assert.equal(page.document.querySelector("article"), article);
});

test("master disable still wins over all page defaults and new settings", async t => {
  const page = setup("https://x.com/home", false); t.after(page.close);
  for (const route of ["/home", "/search?q=cookie", "/incago", "/i/history", "/i/history/likes"]) {
    page.navigate(route); page.setModes({ home: "grid" }); await page.settle();
    assert.equal(page.document.querySelector("[data-bxl-grid]"), null, route);
  }
});

test("people-only search and empty profiles retain their layout until tweets arrive", async t => {
  const page = setup("https://x.com/search?q=cookie&f=user", true, false, { search: "grid" }); t.after(page.close);
  const timeline = page.document.querySelector("#timeline"); timeline.replaceChildren();
  await page.settle();
  assert.equal(page.document.documentElement.hasAttribute("data-bxl-active"), false);
  assert.notEqual(page.window.getComputedStyle(page.document.querySelector('[data-testid="sidebarColumn"]')).display, "none");
  timeline.insertAdjacentHTML("beforeend", tweet(21)); await page.settle();
  assert.ok(page.document.querySelector("[data-bxl-grid]"));
  timeline.replaceChildren(); await page.settle();
  assert.equal(page.document.documentElement.hasAttribute("data-bxl-active"), false);
});

test("search query navigation resets virtual ordering even when the pathname stays the same", async t => {
  const page = setup("https://x.com/search?q=first", true, false, { search: "grid" }); t.after(page.close); await page.settle();
  page.navigate("/search?q=second");
  const timeline = page.document.querySelector("#timeline"); timeline.innerHTML = tweet(90) + tweet(91);
  await page.settle();
  assert.equal(page.document.documentElement.getAttribute("data-bxl-path"), "/search?q=second");
  assert.equal(timeline.firstElementChild.getAttribute("data-bxl-index"), "0");
});

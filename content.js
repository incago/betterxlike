(() => {
  "use strict";

  const FLAG = "data-bxl-active";
  const OWNED = ["data-bxl-main", "data-bxl-shell", "data-bxl-wrapper",
    "data-bxl-primary", "data-bxl-grid", "data-bxl-cell", "data-bxl-sidebar",
    "data-bxl-feed", "data-bxl-nav", "data-bxl-layout", "data-bxl-card", "data-bxl-index"];
  const SIDEBAR_CONTENT = '[data-testid="SearchBox_Search_Input"], [data-testid="trend"], [data-testid="UserCell"]';
  const ownedElements = new Set();
  // Wait for the saved setting before painting, so disabled users see no flash.
  let enabled = false;
  let pageModes = BxlPages.normalize();
  let frame = 0;
  let routeTimer = 0;
  const routeKey = () => location.pathname + location.search;
  let lastPath = routeKey();
  let collectionPath = routeKey();
  const layout = new BxlVirtualGrid(mark, schedule);
  const videos = new BxlVideoPolicy(() => useGrid() && document.documentElement.getAttribute("data-bxl-path") === routeKey());

  // X navigates between pages without reloading the content script.
  function useGrid() {
    const page = BxlPages.pageType(location.pathname);
    return enabled && page && pageModes[page] === "grid";
  }

  function mark(element, name, value = "") {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    ownedElements.add(element);
  }

  function restore() {
    videos.clear();
    document.documentElement.removeAttribute(FLAG);
    document.documentElement.removeAttribute("data-bxl-path");
    layout.clear();
    for (const element of ownedElements) {
      for (const attribute of OWNED) element.removeAttribute(attribute);
    }
    ownedElements.clear();
  }

  function update() {
    frame = 0;
    lastPath = routeKey();
    if (collectionPath !== routeKey()) {
      videos.clear();
      layout.forget();
      collectionPath = routeKey();
    }
    if (!useGrid()) {
      if (document.documentElement.hasAttribute(FLAG) || ownedElements.size) restore();
      return;
    }

    const primary = document.querySelector('[data-testid="primaryColumn"]');
    const main = primary?.closest("main");
    if (!main) {
      if (ownedElements.size) restore();
      return;
    }

    // People-only search results, empty profiles and profile headers retain X's
    // native layout until an actual tweet timeline is mounted.
    const candidates = new Map();
    for (const article of primary.querySelectorAll('article[data-testid="tweet"]')) {
      const cell = article.closest('[data-testid="cellInnerDiv"]');
      if (!cell || !primary.contains(cell)) continue;
      const parent = cell.parentElement;
      candidates.set(parent, (candidates.get(parent) || 0) + 1);
    }
    const grid = [...candidates].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!grid) {
      if (ownedElements.size) restore();
      return;
    }

    // Remove detached nodes from our bookkeeping, without changing X-owned styles.
    for (const element of ownedElements) {
      if (!element.isConnected) {
        for (const attribute of OWNED) element.removeAttribute(attribute);
        ownedElements.delete(element);
      }
    }

    if (!document.documentElement.hasAttribute(FLAG)) document.documentElement.setAttribute(FLAG, "");
    if (document.documentElement.getAttribute("data-bxl-path") !== routeKey()) {
      document.documentElement.setAttribute("data-bxl-path", routeKey());
    }
    mark(primary, "data-bxl-primary");
    mark(main, "data-bxl-main");
    if (main.parentElement) mark(main.parentElement, "data-bxl-shell");
    const nav = [...main.parentElement.children].find(element => element.matches("header"));
    for (const element of ownedElements) {
      if (element !== nav) element.removeAttribute("data-bxl-nav");
    }
    if (nav) mark(nav, "data-bxl-nav");
    for (let wrapper = primary.parentElement; wrapper && wrapper !== main;
      wrapper = wrapper.parentElement) {
      mark(wrapper, "data-bxl-wrapper");
    }

    const sidebars = new Set(document.querySelectorAll('[data-testid="sidebarColumn"]'));
    // Some X layouts omit sidebarColumn. Hide the sibling rail containing its
    // search/trend/follow modules, keeping the tweet column and left navigation.
    for (let column = primary; column && column !== main; column = column.parentElement) {
      for (const sibling of column.parentElement.children) {
        if (sibling !== column && (sibling.matches(SIDEBAR_CONTENT) || sibling.querySelector(SIDEBAR_CONTENT))) {
          sidebars.add(sibling);
        }
      }
    }
    for (const element of ownedElements) {
      if (element.hasAttribute("data-bxl-sidebar") && !sidebars.has(element)) {
        element.removeAttribute("data-bxl-sidebar");
      }
    }
    for (const sidebar of sidebars) mark(sidebar, "data-bxl-sidebar");

    // Group by native timeline parent. Do not move/clone React nodes: the existing
    // links, video controls, and like buttons retain their original event handlers.
    // Widen the whole path to the feed, not just the grid itself. X can place
    // narrow, right-aligned flex wrappers between primaryColumn and the cells.
    const feedWrappers = new Set();
    for (let wrapper = grid?.parentElement; wrapper && wrapper !== primary;
      wrapper = wrapper.parentElement) {
      feedWrappers.add(wrapper);
    }
    for (const element of ownedElements) {
      if (!feedWrappers.has(element)) element.removeAttribute("data-bxl-feed");
    }
    for (const wrapper of feedWrappers) mark(wrapper, "data-bxl-feed");
    for (const oldGrid of primary.querySelectorAll("[data-bxl-grid]")) {
      if (oldGrid !== grid) {
        oldGrid.removeAttribute("data-bxl-grid");
        for (const cell of oldGrid.children) cell.removeAttribute("data-bxl-cell");
      }
    }
    mark(grid, "data-bxl-grid");
    for (const cell of grid.children) {
      const tweet = cell.querySelector('article[data-testid="tweet"]');
      mark(cell, "data-bxl-cell", tweet ? "tweet" : "other");
    }
    layout.update(grid);
    videos.update(grid);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  // Ignore our own data attributes; observing them would create an update loop.
  const observer = new MutationObserver(records => {
    if (records.some(record => record.attributeName !== "style" || layout.styleChanged(record.target))) schedule();
  });
  addEventListener("popstate", schedule);
  addEventListener("resize", schedule);
  if (window.navigation) window.navigation.addEventListener("navigatesuccess", schedule);
  function startWatching() {
    if (routeTimer) return;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid", "style", "autoplay"]
    });
    // Fallback for history.pushState() in older Chrome / SPA transitions with no DOM change.
    routeTimer = setInterval(() => {
      if (lastPath !== routeKey()) schedule();
    }, 500);
    schedule();
  }
  addEventListener("pagehide", () => {
    observer.disconnect();
    layout.suspend();
    videos.clear();
    cancelAnimationFrame(frame);
    frame = 0;
    clearInterval(routeTimer);
    routeTimer = 0;
  });
  addEventListener("pageshow", startWatching);
  startWatching();

  try {
    chrome.storage.local.get({ enabled: true, pageModes: BxlPages.defaults }, (settings) => {
      enabled = chrome.runtime.lastError ? true : settings.enabled !== false;
      pageModes = BxlPages.normalize(settings.pageModes);
      schedule();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.enabled || changes.pageModes)) {
        if (changes.enabled) enabled = changes.enabled.newValue !== false;
        if (changes.pageModes) pageModes = BxlPages.normalize(changes.pageModes.newValue);
        schedule();
      }
    });
  } catch {
    // An extension reload can invalidate an old content script. The default is usable.
    enabled = true;
    schedule();
  }
})();

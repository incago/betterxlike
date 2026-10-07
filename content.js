(() => {
  "use strict";

  const FLAG = "data-bxl-active";
  const OWNED = ["data-bxl-main", "data-bxl-shell", "data-bxl-wrapper",
    "data-bxl-primary", "data-bxl-grid", "data-bxl-cell", "data-bxl-sidebar",
    "data-bxl-feed", "data-bxl-nav", "data-bxl-layout", "data-bxl-card", "data-bxl-index",
    "data-bxl-profile-header", "data-bxl-profile-cover", "data-bxl-profile-avatar",
    "data-bxl-profile-overlap"];
  const SIDEBAR_CONTENT = '[data-testid="SearchBox_Search_Input"], [data-testid="trend"], [data-testid="UserCell"]';
  const FOLLOW_CONTENT = '[data-testid="UserCell"], [data-testid="whoToFollow"], a[href*="/i/connect_people"]';
  const FOLLOW_TITLES = new Set(["팔로우 추천", "Who to follow", "You might like", "おすすめユーザー"]);
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

  function followRecommendations(cells) {
    const result = new Set();
    let group = [];
    const flush = () => {
      const hasPeople = group.some(cell => cell.matches(FOLLOW_CONTENT) || cell.querySelector(FOLLOW_CONTENT));
      for (const cell of group) {
        const explicit = cell.matches(FOLLOW_CONTENT) || cell.querySelector(FOLLOW_CONTENT);
        // X may split the heading, people and More link into separate native
        // cells. Context identifies headings without hiding unrelated loaders.
        const heading = cell.querySelector('h1, h2, h3, [role="heading"]');
        const controls = cell.querySelector('button, [role="button"], [role="progressbar"], [role="alert"], [role="status"]');
        if (explicit || FOLLOW_TITLES.has(cell.textContent.trim()) || (hasPeople && heading && !controls)) result.add(cell);
      }
      group = [];
    };
    for (const cell of cells) {
      if (cell.querySelector('article[data-testid="tweet"]')) flush();
      else group.push(cell);
    }
    flush();
    return result;
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
    // Profile chrome spans the feed, but its banner/portrait must not scale up
    // with the wide timeline. Identify only the profile's own photo links.
    const profileHeaders = new Set();
    if (BxlPages.pageType(location.pathname) === "profile") {
      for (let branch = grid; branch && branch !== primary; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling !== branch && !sibling.hasAttribute("data-bxl-tail")) profileHeaders.add(sibling);
        }
      }
    }
    for (const element of ownedElements) {
      if (!profileHeaders.has(element)) element.removeAttribute("data-bxl-profile-header");
    }
    for (const header of profileHeaders) mark(header, "data-bxl-profile-header");
    const covers = new Set();
    const avatars = new Set();
    const overlaps = new Set();
    const handle = location.pathname.split('/')[1];
    for (const header of profileHeaders) {
      for (const link of header.querySelectorAll('a[href]')) {
        const path = new URL(link.href, location.href).pathname;
        if (path === `/${handle}/header_photo`) {
          covers.add(link);
          // Some X versions put the banner height on a separate wrapper.
          if (link.parentElement.children.length === 1) covers.add(link.parentElement);
        } else if (path === `/${handle}/photo`) {
          avatars.add(link);
          if (parseFloat(getComputedStyle(link).marginTop) < 0) overlaps.add(link);
        }
      }
      // Empty headers have no photo link, but retain X's one-third-width spacer.
      for (const spacer of header.querySelectorAll('[style*="padding-bottom"]')) {
        const padding = spacer.style.paddingBottom;
        if (padding.endsWith('%') && Math.abs(parseFloat(padding) - 100 / 3) < 0.1 &&
          spacer.parentElement.children.length <= 2) covers.add(spacer.parentElement);
      }
    }
    for (const [name, elements] of [["data-bxl-profile-cover", covers],
      ["data-bxl-profile-avatar", avatars], ["data-bxl-profile-overlap", overlaps]]) {
      for (const element of ownedElements) if (!elements.has(element)) element.removeAttribute(name);
      for (const element of elements) mark(element, name);
    }
    for (const oldGrid of primary.querySelectorAll("[data-bxl-grid]")) {
      if (oldGrid !== grid) {
        oldGrid.removeAttribute("data-bxl-grid");
        for (const cell of oldGrid.children) cell.removeAttribute("data-bxl-cell");
      }
    }
    mark(grid, "data-bxl-grid");
    const cells = [...grid.children];
    const recommendations = followRecommendations(cells);
    for (const cell of cells) {
      const tweet = cell.querySelector('article[data-testid="tweet"]');
      mark(cell, "data-bxl-cell", tweet ? "tweet" : recommendations.has(cell) ? "recommendation" : "other");
      if (!tweet) cell.removeAttribute("data-bxl-index");
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

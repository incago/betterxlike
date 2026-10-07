const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");

function setup({ enabled = true, pageModes, readError = false, writeError = false, locale = "ko" } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "popup.html"), "utf8"), { runScripts: "outside-only" });
  const { window } = dom;
  const writes = [];
  const messages = JSON.parse(fs.readFileSync(path.join(root, "_locales", ["ko", "ja"].includes(locale.toLowerCase().split(/[-_]/)[0]) ? locale.toLowerCase().split(/[-_]/)[0] : "en", "messages.json"), "utf8"));
  window.chrome = {
    i18n: {
      getUILanguage: () => locale,
      getMessage: (key, substitutions) => {
        const entry = messages[key];
        if (!entry) return "";
        return entry.message.replace(/\$COUNT\$/g, String(substitutions));
      }
    },
    runtime: {},
    storage: { local: {
      get: (_, callback) => {
        window.chrome.runtime.lastError = readError ? { message: "read failed" } : undefined;
        callback({ enabled, pageModes });
        window.chrome.runtime.lastError = undefined;
      },
      set: (settings, callback) => {
        writes.push(settings);
        window.chrome.runtime.lastError = writeError ? { message: "write failed" } : undefined;
        callback();
        window.chrome.runtime.lastError = undefined;
      }
    } }
  };
  window.eval(fs.readFileSync(path.join(root, "pages.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(root, "popup.js"), "utf8"));
  return { window, toggle: window.document.querySelector("#enabled"), status: window.document.querySelector("#status"), writes, close: () => window.close() };
}

test("popup reads settings and persists a toggle", (t) => {
  const page = setup(); t.after(page.close);
  assert.equal(page.toggle.checked, true);
  assert.equal(page.toggle.disabled, false);
  page.toggle.click();
  assert.equal(page.writes.length, 1);
  assert.equal(page.writes[0].enabled, false);
  assert.match(page.status.textContent, /기본 목록/);
});

test("popup reflects a saved disabled setting", (t) => {
  const page = setup({ enabled: false }); t.after(page.close);
  assert.equal(page.toggle.checked, false);
  assert.match(page.status.textContent, /기본 목록/);
});

test("failed writes revert the switch and show a useful error", (t) => {
  const page = setup({ writeError: true }); t.after(page.close);
  page.toggle.click();
  assert.equal(page.toggle.checked, true);
  assert.equal(page.toggle.disabled, false);
  assert.match(page.status.textContent, /저장하지 못했습니다/);
});

test("failed reads leave the toggle disabled", (t) => {
  const page = setup({ readError: true }); t.after(page.close);
  assert.equal(page.toggle.disabled, true);
  assert.match(page.status.textContent, /불러오지 못했습니다/);
});

test("page options read partial saved preferences, persist independently, and leave the master setting intact", t => {
  const page = setup({ pageModes: { home: "native", profile: "native" } }); t.after(page.close);
  const select = page.window.document.querySelector('#mode-search');
  assert.equal(page.window.document.querySelector('#mode-home').value, "native");
  assert.equal(page.window.document.querySelector('#mode-likes').value, "grid");
  select.value = "native"; select.dispatchEvent(new page.window.Event("change"));
  assert.equal(page.writes[0].pageModes.search, "native");
  assert.equal(page.writes[0].pageModes.home, "native");
  assert.equal(page.writes[0].pageModes.likes, "grid");
  assert.equal("enabled" in page.writes[0], false);
  assert.equal(page.toggle.checked, true);
});

test("failed page writes restore the saved option and master off retains page preferences", t => {
  const page = setup({ writeError: true, pageModes: { search: "native" } }); t.after(page.close);
  const select = page.window.document.querySelector('#mode-search');
  select.value = "grid"; select.dispatchEvent(new page.window.Event("change"));
  assert.equal(select.value, "native");
  assert.match(page.status.textContent, /저장하지 못했습니다/);
  page.toggle.click();
  assert.equal(select.value, "native");
  assert.equal(page.toggle.checked, true);
});


test("English popup localizes every visible label, preserves settings, and formats page counts", t => {
  const page = setup({ locale: "en-US", pageModes: { home: "native" } }); t.after(page.close);
  const doc = page.window.document;
  assert.equal(doc.documentElement.lang, "en");
  assert.equal(doc.querySelector('legend').textContent, "Layout by page");
  assert.equal(doc.querySelector('label[for="mode-search"] span').textContent, "Search results");
  assert.equal(doc.querySelector('#mode-home').value, "native");
  assert.equal(doc.querySelector('#mode-home option[value="native"]').textContent, "Default list");
  assert.match(page.status.textContent, /4 pages/);
  assert.equal(/[가-힣]/.test(doc.body.textContent), false);
  for (const element of doc.querySelectorAll('[data-i18n]')) assert.ok(element.textContent.trim());
  for (const key of ['search', 'profile', 'bookmarks']) {
    const select = doc.querySelector(`#mode-${key}`);
    select.value = "native"; select.dispatchEvent(new page.window.Event("change"));
  }
  assert.match(page.status.textContent, /1 page\./);
  page.toggle.click();
  assert.equal(page.status.textContent, "All pages use X’s default layout.");
  assert.equal(doc.querySelector('#mode-home').value, "native");
});

test("English errors and unsupported browser languages fall back to English", t => {
  const read = setup({ locale: "en-GB", readError: true }); t.after(read.close);
  assert.match(read.status.textContent, /Could not load settings/);
  const write = setup({ locale: "en", writeError: true }); t.after(write.close);
  write.toggle.click();
  assert.match(write.status.textContent, /Could not save settings/);
  assert.equal(write.toggle.checked, true);
  const fallback = setup({ locale: "fr" }); t.after(fallback.close);
  assert.equal(fallback.window.document.documentElement.lang, "en");
  assert.match(fallback.status.textContent, /5 pages/);
  const ko = setup({ locale: "ko-KR" }); t.after(ko.close);
  assert.equal(ko.window.document.documentElement.lang, "ko");
  assert.match(ko.status.textContent, /5개 화면/);
});

test("all three catalogs cover popup and manifest messages, including count placeholders", () => {
  const en = JSON.parse(fs.readFileSync(path.join(root, "_locales/en/messages.json"), "utf8"));
  const ko = JSON.parse(fs.readFileSync(path.join(root, "_locales/ko/messages.json"), "utf8"));
  const ja = JSON.parse(fs.readFileSync(path.join(root, "_locales/ja/messages.json"), "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  const html = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.default_locale, "en");
  const keys = [...html.matchAll(/data-i18n="([^" ]+)"/g), ...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(match => match[1]);
  for (const catalog of [en, ko, ja]) {
    for (const key of keys) assert.ok(catalog[key]?.message, key);
    assert.equal(catalog.statusGrid.placeholders.count.content, "$1");
    assert.ok(catalog.extensionDescription.message.length <= 132);
  }
});


test("Japanese popup translates labels and counts while preserving and saving page choices", t => {
  const page = setup({ locale: "ja-JP", pageModes: { home: "native" } }); t.after(page.close);
  const doc = page.window.document;
  assert.equal(doc.documentElement.lang, "ja");
  assert.equal(doc.querySelector('legend').textContent, "画面ごとの表示");
  assert.equal(doc.querySelector('label[for="mode-profile"] span').textContent, "プロフィール");
  assert.equal(doc.querySelector('#mode-home').value, "native");
  assert.equal(doc.querySelector('#mode-home option[value="native"]').textContent, "標準の一覧");
  assert.equal(doc.querySelector('[data-i18n="openBookmarks"]').textContent, "自分のブックマークを開く");
  assert.match(page.status.textContent, /4つの画面/);
  assert.equal(/[가-힣]/.test(doc.body.textContent), false);
  for (const element of doc.querySelectorAll('[data-i18n]')) assert.ok(element.textContent.trim());
  for (const key of ['search', 'profile', 'bookmarks']) {
    const select = doc.querySelector(`#mode-${key}`);
    select.value = "native"; select.dispatchEvent(new page.window.Event("change"));
  }
  assert.match(page.status.textContent, /1つの画面/);
  assert.equal(page.writes.at(-1).pageModes.home, "native");
  assert.equal("enabled" in page.writes.at(-1), false);
  page.toggle.click();
  assert.equal(page.status.textContent, "すべての画面でXの標準表示を使います。");
  assert.equal(doc.querySelector('#mode-home').value, "native");
});

test("Japanese read and write errors are localized and leave saved preferences intact", t => {
  const read = setup({ locale: "ja", readError: true }); t.after(read.close);
  assert.match(read.status.textContent, /設定を読み込めませんでした/);
  assert.equal(read.toggle.disabled, true);
  const write = setup({ locale: "ja", writeError: true, pageModes: { search: "native" } }); t.after(write.close);
  const select = write.window.document.querySelector('#mode-search');
  select.value = "grid"; select.dispatchEvent(new write.window.Event("change"));
  assert.equal(select.value, "native");
  assert.match(write.status.textContent, /設定を保存できませんでした/);
  assert.equal(write.toggle.checked, true);
  assert.equal(write.window.document.documentElement.lang, "ja");
});

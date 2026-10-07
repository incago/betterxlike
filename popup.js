"use strict";

const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
const uiLanguage = chrome.i18n.getUILanguage().toLowerCase().split(/[-_]/)[0];
document.documentElement.lang = ["ko", "ja"].includes(uiLanguage) ? uiLanguage : "en";
for (const element of document.querySelectorAll("[data-i18n]")) {
  element.textContent = message(element.dataset.i18n);
}

const toggle = document.querySelector("#enabled");
const pageSettings = document.querySelector("#page-settings");
const selects = [...pageSettings.querySelectorAll("select[data-page]")];
const status = document.querySelector("#status");
let enabled = false;
let pageModes = BxlPages.normalize();

function render() {
  toggle.checked = enabled;
  toggle.disabled = false;
  pageSettings.disabled = !enabled;
  for (const select of selects) select.value = pageModes[select.dataset.page];
  const count = Object.values(pageModes).filter(mode => mode === "grid").length;
  status.textContent = enabled && count
    ? message(count === 1 ? "statusGridOne" : "statusGrid", String(count))
    : message("statusNative");
}

function save(change, rollback) {
  toggle.disabled = true;
  pageSettings.disabled = true;
  chrome.storage.local.set(change, () => {
    const failed = Boolean(chrome.runtime.lastError);
    if (failed) rollback();
    render();
    if (failed) status.textContent = message("statusSaveError");
  });
}

chrome.storage.local.get({ enabled: true, pageModes: BxlPages.defaults }, settings => {
  if (chrome.runtime.lastError) {
    status.textContent = message("statusLoadError");
    return;
  }
  enabled = settings.enabled !== false;
  pageModes = BxlPages.normalize(settings.pageModes);
  render();
});

toggle.addEventListener("change", () => {
  const previous = enabled;
  enabled = toggle.checked;
  save({ enabled }, () => { enabled = previous; });
});

for (const select of selects) select.addEventListener("change", () => {
  const previous = pageModes;
  pageModes = { ...pageModes, [select.dataset.page]: select.value };
  save({ pageModes }, () => { pageModes = previous; });
});

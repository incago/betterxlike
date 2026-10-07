// Local, synthetic X DOM preview. Does not contact X or read browser data.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const fixture = fs.readFileSync(path.join(__dirname, "fixture.html"));
const assets = new Set(["/pages.js", "/layout.js", "/video.js", "/video-play.js", "/content.js", "/content.css", "/popup.html", "/popup.js", "/popup.css",
  "/store/promo.html", "/store/privacy/index.html", "/store/privacy/en.html", "/store/privacy/ja.html",
  "/icons/icon-16.png", "/icons/icon-32.png", "/icons/icon-48.png", "/icons/icon-128.png"]);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname;
  response.setHeader("Cache-Control", "no-store");
  if (["/", "/i/history", "/i/history/likes", "/i/bookmarks", "/home", "/search", "/incago", "/explore"].includes(pathname)) {
    response.writeHead(200, { "Content-Type": mime[".html"] }); response.end(fixture); return;
  }
  if (assets.has(pathname)) {
    let bytes = fs.readFileSync(path.join(root, pathname));
    if (pathname === "/popup.html") {
      const requestedLocale = url.searchParams.get("lang") || "ko";
      const locale = ["ko", "en", "ja"].includes(requestedLocale) ? requestedLocale : "en";
      const catalog = fs.readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8");
      bytes = bytes.toString().replace('<script src="popup.js" defer></script>', `<script>window.chrome={i18n:{getUILanguage:()=>${JSON.stringify(locale)},getMessage:(key,sub)=>{const catalog=${catalog};return catalog[key]?.message.replace(/\\$COUNT\\$/g,String(sub))||""}},runtime:{},storage:{local:{get:(_,cb)=>cb({enabled:localStorage.getItem("bxl-preview-enabled")!=="false",pageModes:JSON.parse(localStorage.getItem("bxl-preview-modes")||"null")}),set:(value,cb)=>{if("enabled" in value)localStorage.setItem("bxl-preview-enabled",String(value.enabled));if(value.pageModes)localStorage.setItem("bxl-preview-modes",JSON.stringify(value.pageModes));cb()}}}};</script><script src="popup.js" defer></script>`);
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(pathname)] }); response.end(bytes); return;
  }
  response.writeHead(404); response.end("Not found");
});
server.listen(4173, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:4173/i/history/likes"));

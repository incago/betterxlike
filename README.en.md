# Better X Likes

[한국어](README.md) | English | [Japanese](README.ja.md)

A Chrome extension that displays **X home, search results, profiles, bookmarks and likes in responsive grids with 1–4 posts per row**. Choose **Grid / Default list** separately for each page in the popup. Grid pages hide the right search, trends and suggested follows sidebar while keeping the left navigation.

The popup and extension description support Korean, English and Japanese. Chrome selects the language from its interface language; unsupported languages fall back to English. Your layout preferences stay the same when the language changes. The extension does not translate posts or X’s own interface.

## Install or update locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`. If you downloaded a ZIP, extract it first.
4. For an existing local installation, click its **Reload** button instead.
5. **Reload any open X tabs**, so the video guard installed at page startup uses the new code.
6. Sign in to X normally and open a supported page.

Pin the extension to the toolbar to reach its popup. The **Enable grid** master switch disables all grids without losing your per-page choices. Changes apply to open X tabs and are saved locally in this browser.

From version 1.5.4, new installations or missing page preferences default to **Grid for bookmarks and likes** and **Default list for home, search and profiles**. Saved page choices remain unchanged after updating. All 59 automated tests passed, including defaults, saved preferences and switching to grids.

## Supported pages and behavior

- Home: `/home`.
- Search results containing posts: `/search`.
- Profiles: `/username`, `/username/with_replies`, `/username/media`, `/username/highlights`. The same profile preference applies to your profile and other profiles.
- Bookmarks: `/i/history` and `/i/bookmarks`.
- Likes: `/i/history/likes`.

Post details, messages, notifications, Explore, follower lists and pages without a tweet timeline keep X’s original layout. Selecting **Default list** restores X’s layout, sidebar and video behavior for that page.

Available content widths of at least 1060px, 800px and 540px produce four, three and two columns respectively. Below 540px, posts appear in one column. Resizing the window updates the layout automatically.

The extension styles existing X elements rather than copying posts. Links, buttons, media controls and X’s own text truncation remain in place. X keeps control of virtual scrolling and loading; the extension adjusts measured cell slots and positions cards inside them.

Videos in grids remain paused until you click the corresponding player control or activate it with the keyboard. Clicking post text or Like does not authorize video playback. A guard in the page’s MAIN execution environment rejects unrequested `play()` calls before playback begins, preventing repeated start/stop cycles. Switching to Default list or leaving a grid page restores native playback behavior.

## Permissions and privacy

The `storage` permission saves only `enabled` (the master switch) and `pageModes` (five layout preferences) in `chrome.storage.local`. Content scripts run on `x.com` and `twitter.com` to detect navigation and supported timelines. The current path/query, rendered post links/IDs, dimensions and player gestures are processed temporarily in page memory. Posts, browsing history and player input are not persisted or sent to the developer. There is no backend service, analytics or remote runtime code.

[English privacy policy](https://incago.github.io/better-x-likes-privacy/en.html) · [Korean privacy policy](https://incago.github.io/better-x-likes-privacy/)

## Development and verification

```sh
npm ci
npm test
npm run preview
```

The preview server at `http://127.0.0.1:4173` uses synthetic posts and does not connect to an X account. Supported examples include `/home`, `/search?q=cookie`, `/incago`, `/i/history` and `/i/history/likes`.

Add `?virtual=1` (or `&virtual=1` after another query) to exercise virtual scrolling: seven initial posts, automatic loading up to 42 posts over six pages, and removal of offscreen DOM cells. The fixture’s browser test checks layout, late media resizing, original event handlers and restoration.

Add `?videos=1` to use actual browser videos generated from canvas streams, without external video downloads. Test autoplay retries, explicit manual playback and restoration. Popup previews are available at `/popup.html?lang=en` and `/popup.html?lang=ko`; these use mocked Chrome APIs and local preferences.

Version 1.5.0 passed 51 automated tests, home layout checks, search/profile virtual scrolling checks and a home video test with 1,000 rejected autoplay retries. Version 1.5.1 passed 54 automated tests, including English labels, status/error messages, singular/plural page counts, locale fallback and saved preference preservation. The Korean and English popup previews were also checked in the browser; both fit within Chrome’s 600px popup height. These local checks do not replace testing on the current logged-in X website. X may change its DOM or measurement behavior; if the layout breaks, disable the grid and reload the tab.

Version 1.5.2 adds Japanese translations and passed 56 automated tests, including Japanese status/error messages and saved preferences. Japanese preview: `/popup.html?lang=ja`. [Japanese privacy policy](https://incago.github.io/better-x-likes-privacy/ja.html).

Version 1.5.3 fixes new home posts appearing above the reachable scroll area after clicking Show posts. It rebases the cached order when posts are prepended and resets obsolete order/height measurements when X replaces or crops the same timeline at its native origin. X retains control of scroll offsets and total height.

All 59 automated tests passed. The Home refresh test at `/home?virtual=1` checks batches of 1, 3 and 35 new posts, first-row alignment, reachable scroll origin, returning after scrolling and enabling the grid after a native refresh. Add `&width=500`, `&width=800` or `&width=1000` to constrain available content width for one, two or three columns. Local browser checks passed 21 items for each of one through four columns, plus 16 existing virtual-scroll checks. The current logged-in X website still needs a separate check.

Version 1.5.5 keeps profile titles, banners, avatars, details and tabs outside the tweet timeline at a maximum width of 600px, shrinking to the available width on narrow screens. The tweet grid still expands to one through four columns. Original nodes and handlers are retained; Default list, disabling and navigation restore styles. All 60 automated tests passed, plus 19 flow-layout and 16 virtual-scroll profile checks (42 posts/6 pages). Wide and narrow geometry was checked locally; the current logged-in X profile still needs a separate check.

Version 1.5.6 hides inline follow recommendations, including split heading/account/More cells, on grid pages so they cannot overlap posts. Native cells and Y offsets remain intact; hidden virtual cells measure zero height. Loaders, error/retry controls and account elements inside posts remain visible. Default list, disabling and navigation restore suggestions. All 62 automated tests passed. The recommendation test at `/incago?virtual=1&recommendations=1` passed 13 checks at each of one through four columns, including loading 42 posts; the flow-list test passed 11 checks. Add `&width=500`, `&width=800` or `&width=1000` for narrow content widths. The current logged-in X site still needs a separate check.

## Packaging and store status

```sh
python3 tools/package.py
python3 tools/package.py --store
```

The regular ZIP includes runtime files and all three installation guides. The Web Store ZIP contains runtime files, including all three `_locales` catalogs. It can be uploaded directly without extracting or nesting it inside another ZIP. A store-kit archive is a bundle of submission materials, not an installable extension package.

Publisher: **Junhak Kim**. Public support email: **incago@gmail.com**.

Version **1.4.1** was submitted for review on October 7, 2026 with automatic publication after approval. The user chose to keep that review and submit the improved version later. Version **1.5.6** is prepared locally and has not been submitted. See [English submission guide](store/publish-guide-en.txt), [English store listing](store/listing-en.txt) and [submission status](store/submission-status.json).

Better X Likes is an independent extension and is not an official product of X Corp. There is no separate terms-of-service document in this project; the privacy policy is available in all three languages.

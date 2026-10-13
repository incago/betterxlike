# Better X Likes v1.6.0

- Optional tweet popup keeps the grid and scroll position intact, without opening another tab.
- Read full text, images, videos and quoted posts. Replies remain available through **Open in X**.
- Use X translation inside the popup and switch back to the original text.
- Popup styling follows the current X theme, with a minimal header and author avatar.
- Korean, English and Japanese settings and messages. The popup option is off by default.

- Fix stale popup callbacks after extension reload/update (Extension context invalidated), including scroll/focus cleanup.

Validation: 89 unit tests and 24 Chrome browser tests passed. Live X checks confirmed long-form text, Korean translation, no extra tabs and preserved scroll.

Assets: installation ZIP, Chrome Web Store ZIP, store submission kit, and the 128px icon. Reload open X tabs after updating. Existing settings are preserved.

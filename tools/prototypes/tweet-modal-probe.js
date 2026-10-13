/* Feasibility probe, deliberately excluded from the production manifest.
 * Tested 2026-10-13 in logged-in Chrome on x.com/i/history/likes.
 * Reproduce in a development copy: register this script at document_idle for
 * https://x.com/* with world ISOLATED or MAIN, reload the extension and X tab,
 * then click a tweet timestamp while the grid is active.
 * Both execution worlds produced Chrome's "x.com refused to connect" frame.
 * Opening the same post as a top-level tab loaded the post and replies.
 * This is not a shipping feature: no scroll lock, settings, focus restoration,
 * error recovery, or interaction synchronization. No security headers changed.
 */
(() => {
  document.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const article = event.target.closest('article[data-testid="tweet"]');
    if (!article || !document.documentElement.hasAttribute('data-bxl-active')) return;
    if (event.target.closest('button, [role="button"], video')) return;
    const link = event.target.closest('a');
    const timestamp = article.querySelector('a[href*="/status/"] time')?.closest('a');
    if (link && link !== timestamp) return;
    if (!timestamp) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', '트윗 팝업 시제품');
    dialog.style.cssText = 'padding:0;border:1px solid #555;border-radius:16px;width:680px;height:85vh;max-width:95vw;background:#fff';
    const close = document.createElement('button'); close.textContent = '닫기';
    close.style.cssText = 'height:44px;width:100%;font-size:16px';
    close.onclick = () => { dialog.close(); dialog.remove(); };
    const frame = document.createElement('iframe'); frame.title = '트윗 상세';
    frame.style.cssText = 'width:100%;height:calc(100% - 44px);border:0';
    frame.src = timestamp.href;
    dialog.append(close, frame); document.body.append(dialog); dialog.showModal();
  }, true);
})();

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Keep fixture validation independent of accounts and external services.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
});

async function runChecks(page, button, result) {
  await page.locator(button).click();
  await page.waitForFunction(name => Array.isArray(window[name]), result);
  const checks = await page.evaluate(name => window[name], result);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.filter(check => !check.pass)).toEqual([]);
}

for (const [width, columns] of [[500, 1], [800, 2], [1000, 3], [1320, 4]]) {
  test(`ordinary list: ${columns} columns, native handlers and restoration`, async ({ page }) => {
    await page.goto(`/i/history?width=${width}`);
    await runChecks(page, '#run', 'previewResults');
    await expect(page.locator('[data-bxl-grid]')).toHaveCSS('--bxl-columns', String(columns));
  });

  test(`virtual list: ${columns} columns, paging, remounting and media growth`, async ({ page }) => {
    await page.goto(`/i/history/likes?virtual=1&width=${width}`);
    await runChecks(page, '#run', 'previewResults');
    await expect(page.locator('#virtual-status')).toContainText('트윗 42개');
  });

  test(`home refresh: ${columns} columns, prepending and scrolling back`, async ({ page }) => {
    await page.goto(`/home?virtual=1&width=${width}`);
    await runChecks(page, '#run-refresh', 'refreshResults');
  });

  test(`profile and follow modules: ${columns} columns`, async ({ page }) => {
    await page.goto(`/incago?virtual=1&recommendations=1&avatarFrame=1&width=${width}`);
    await page.locator('#run-profile').click();
    await expect(page.locator('#profile-checks')).toHaveAttribute('data-results', /.+/);
    const profile = JSON.parse(await page.locator('#profile-checks').getAttribute('data-results'));
    expect(profile.length).toBeGreaterThan(0);
    expect(profile.filter(check => !check.pass)).toEqual([]);
    await runChecks(page, '#run-follow', 'followResults');
  });
}

test('middle insertion preserves unique slots, row alignment and remounting', async ({ page }) => {
  await page.goto('/i/history/likes?virtual=1');
  await runChecks(page, '#run', 'previewResults');
  await page.evaluate(() => window.insertPreviewPosts(1, 2));
  await expect.poll(() => page.locator('[data-bxl-cell="tweet"]').evaluateAll(cells => {
    const indices = cells.map(cell => Number(cell.dataset.bxlIndex));
    const columns = Number(cells[0].parentElement.style.getPropertyValue('--bxl-columns'));
    const rows = new Map();
    for (const cell of cells) {
      const row = Math.floor(Number(cell.dataset.bxlIndex) / columns);
      const rect = cell.firstElementChild.getBoundingClientRect();
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(rect);
    }
    const bounds = [...rows.values()];
    return new Set(indices).size === indices.length && indices.every((index, i) => index === i) &&
      bounds.every((row, i) => row.every(rect => Math.abs(rect.top - row[0].top) < 2) &&
        (!i || row[0].top >= Math.max(...bounds[i - 1].map(rect => rect.bottom))));
  })).toBe(true);
  await expect(page.locator('#virtual-status')).toContainText('트윗 44개');
  await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
  await expect(page.locator('[data-source-index="0"]')).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  for (const [id, index] of [[0, 0], [1000, 1], [1001, 2], [1, 3]]) {
    await expect(page.locator(`[data-source-index="${id}"]`)).toHaveAttribute('data-bxl-index', String(index));
  }
});

test('a real failed media request cannot leave autoplay permission behind', async ({ page }) => {
  await page.goto('/i/history/likes');
  await expect(page.locator('[data-bxl-grid]')).toBeVisible();
  await page.evaluate(() => {
    const player = document.createElement('div'); player.dataset.testid = 'videoPlayer';
    const video = document.createElement('video'); video.id = 'failed-video';
    video.src = 'data:video/mp4;base64,AAAA'; video.muted = true;
    const button = document.createElement('button'); button.id = 'failed-play'; button.textContent = 'Play invalid media';
    button.onclick = () => video.play().catch(error => { window.failedPlayResult = error.name; });
    player.append(video, button); document.querySelector('article').append(player);
  });
  await page.waitForFunction(() => document.querySelector('#failed-video').error !== null);
  await page.locator('#failed-play').click();
  await page.waitForFunction(() => window.failedPlayResult);
  await expect(page.locator('#failed-video')).not.toHaveAttribute('data-bxl-video-manual', '');
  expect(await page.locator('#failed-video').evaluate(video => video.play().then(() => 'played', error => error.name))).toBe('NotAllowedError');
});

test('real media blocks autoplay retries, accepts trusted input, and stops again after pause', async ({ page }) => {
  await page.goto('/i/history/likes?videos=1');
  await expect(page.locator('video')).toHaveCount(4);
  await expect(page.locator('#video-status')).toHaveText('영상 재생 0/4');
  await page.getByRole('button', { name: '빠른 재생 재시도 테스트' }).click();
  await expect(page.locator('#video-retries')).toHaveText('재시도 1000회 · 실제 재생 0회 · 일시정지 0회 · 프레임 유지');
  await page.locator('#video-toggle-1').click();
  await expect(page.locator('#video-status')).toHaveText('영상 재생 1/4');
  await page.locator('#video-toggle-1').click();
  await expect(page.locator('#video-status')).toHaveText('영상 재생 0/4');
  await page.locator('#video-autoplay').click();
  expect(await page.locator('video').evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
});

for (const locale of ['ko', 'en', 'ja']) {
  test(`popup ${locale}: changing preferences survives reload`, async ({ page }) => {
    await page.goto(`/popup.html?lang=${locale}`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.locator('#mode-home').selectOption('grid');
    await page.locator('#enabled').uncheck();
    await page.reload();
    await expect(page.locator('#enabled')).not.toBeChecked();
    await expect(page.locator('#mode-home')).toHaveValue('grid');
    await page.locator('#enabled').check();
    await expect(page.locator('#mode-home')).toBeEnabled();
  });
}

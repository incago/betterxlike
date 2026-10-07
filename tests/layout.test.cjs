const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('stable updates and media growth touch only mounted rows after a long scroll', t => {
  const dom = new JSDOM('<div id="grid"><div data-bxl-cell="tweet" style="position:absolute;transform:translateY(100px)"><div><article data-testid="tweet"><a href="/u/status/1"><time>now</time></a></article></div></div></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'layout.js'), 'utf8'));
  const layout = new window.BxlVirtualGrid((element, name, value = '') => element.setAttribute(name, value), () => {});
  t.after(() => layout.clear());
  const grid = window.document.querySelector('#grid');
  const cell = grid.firstElementChild;
  let height = 320;
  cell.firstElementChild.getBoundingClientRect = () => ({ height });
  layout.update(grid);
  // Simulate retained history without mounting thousands of DOM nodes.
  for (let index = 1; index < 20000; index++) {
    const key = `tweet:${index + 1}`;
    layout.indices.set(key, index);
    layout.positions.set(index, key);
    layout.heights.set(key, 500);
    layout.rows.set(Math.floor(index / 4), 500);
  }
  layout.nextIndex = 20000;
  const visitHistory = () => { throw new Error('routine update traversed the full history'); };
  layout.indices[Symbol.iterator] = visitHistory;
  layout.indices.values = visitHistory;
  layout.heights[Symbol.iterator] = visitHistory;
  layout.update(grid);
  assert.equal(cell.style.getPropertyValue('--bxl-slot-height'), '129px');
  height = 800; layout.update(grid);
  assert.equal(cell.style.getPropertyValue('--bxl-slot-height'), '204px');
  height = 100; layout.update(grid);
  assert.equal(cell.style.getPropertyValue('--bxl-slot-height'), '129px', 'unmounted peers retain their height when visible media shrinks');
});

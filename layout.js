/* Keep X's absolute offsets and total height under X's control. Divide each
   row's height between its native slots; move child cards upwards within them.
   The number of columns follows the available timeline width. */
(() => {
  "use strict";

  class VirtualGrid {
    constructor(mark, schedule) {
      this.mark = mark;
      this.schedule = schedule;
      this.styles = new Map();
      this.signatures = new WeakMap();
      this.observed = new Set();
      this.identities = new WeakMap();
      this.identityCounter = 0;
      this.resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
      this.grid = null;
      this.indices = new Map();
      this.orders = new WeakMap();
      this.heights = new Map();
      this.rows = new Map();
      this.nextIndex = 0;
      this.tail = null;
    }

    nativeStyle(element) {
      return Array.from({ length: element.style.length }, (_, i) => element.style.item(i))
        .filter(property => !property.startsWith("--bxl-"))
        .map(property => `${property}:${element.style.getPropertyValue(property)}:${element.style.getPropertyPriority(property)}`)
        .join(";");
    }

    styleChanged(element) {
      if (!this.signatures.has(element)) return false;
      if (this.signatures.get(element) !== this.nativeStyle(element)) return true;
      return [...(this.styles.get(element) || [])].some(([property, saved]) =>
        element.style.getPropertyValue(property) !== saved.current);
    }

    set(element, property, value) {
      let saved = this.styles.get(element);
      if (!saved) this.styles.set(element, saved = new Map());
      if (!saved.has(property)) saved.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      });
      saved.get(property).current = value;
      if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
    }

    release(element) {
      for (const [property, saved] of this.styles.get(element) || []) {
        if (saved.value) element.style.setProperty(property, saved.value, saved.priority);
        else element.style.removeProperty(property);
      }
      this.styles.delete(element);
      this.signatures.delete(element);
      element.removeAttribute("data-bxl-card");
      element.removeAttribute("data-bxl-index");
      this.resize?.unobserve(element);
      this.observed.delete(element);
    }

    suspend() {
      this.resize?.disconnect();
      this.observed.clear();
    }

    clear() {
      if (this.grid) this.orders.set(this.grid, { indices: this.indices, nextIndex: this.nextIndex });
      this.suspend();
      for (const element of [...this.styles.keys()]) this.release(element);
      this.grid?.removeAttribute("data-bxl-layout");
      this.tail?.remove();
      this.tail = null;
      this.grid = null;
      this.indices = new Map();
      this.heights.clear();
      this.rows.clear();
      this.nextIndex = 0;
    }

    forget() {
      this.clear();
      this.orders = new WeakMap();
    }

    key(article) {
      const timestamp = article.querySelector('a[href*="/status/"] time');
      const link = timestamp?.closest("a") || article.querySelector('a[href*="/status/"]');
      const id = link?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
      if (id) return `tweet:${id}`;
      if (!this.identities.has(article)) this.identities.set(article, `node:${++this.identityCounter}`);
      return this.identities.get(article);
    }

    observe(element) {
      if (!this.observed.has(element)) {
        this.resize?.observe(element);
        this.observed.add(element);
      }
    }

    atNativeStart(cell) {
      if (!cell) return false;
      const transform = cell.style.transform;
      // Only use an explicit X-owned offset. Newly mounted cells may not have
      // been positioned yet, and an unpositioned cell is not a refresh signal.
      if (!transform && !cell.style.top) return false;
      let y = 0;
      if (transform && transform !== "none") {
        if (typeof DOMMatrixReadOnly === "function") {
          try { y = new DOMMatrixReadOnly(transform).m42; } catch { return false; }
        } else {
          const translated = transform.match(/^translateY\(([-\d.]+)px\)$/) ||
            transform.match(/^translate3d\([^,]+,\s*([-\d.]+)px,/);
          if (!translated) return false;
          y = Number(translated[1]);
        }
      }
      return Math.abs(y + (parseFloat(cell.style.top) || 0)) < 1;
    }

    update(grid) {
      if (grid !== this.grid) {
        this.clear();
        this.grid = grid;
        const saved = grid && this.orders.get(grid);
        if (saved) {
          this.indices = saved.indices;
          this.nextIndex = saved.nextIndex;
        }
      }
      if (!grid) return;
      const cells = [...grid.children].filter(cell => cell.hasAttribute("data-bxl-cell"));
      const virtual = cells.some(cell => cell.style.position === "absolute" ||
        /translate(?:Y|3d)?\(/.test(cell.style.transform) ||
        getComputedStyle(cell).position === "absolute");
      this.mark(grid, "data-bxl-layout", virtual ? "virtual" : "flow");
      const records = cells.map(cell => {
        const article = cell.querySelector('article[data-testid="tweet"]');
        const card = article ? [...cell.children].find(child => child === article || child.contains(article)) : cell.firstElementChild;
        if (card) this.mark(card, "data-bxl-card");
        return { cell, article, card, key: article ? this.key(article) : null };
      });
      const current = new Set([grid, ...cells, ...records.map(record => record.card).filter(Boolean)]);
      if (this.tail) current.add(this.tail);
      for (const element of [...this.styles.keys()]) if (!current.has(element)) this.release(element);
      for (const element of [...this.observed]) {
        if (!current.has(element)) {
          this.resize?.unobserve(element);
          this.observed.delete(element);
        }
      }
      this.observe(grid);
      for (const { card } of records) if (card) this.observe(card);
      const width = grid.getBoundingClientRect().width || 1060;
      const columns = width >= 1060 ? 4 : width >= 800 ? 3 : width >= 540 ? 2 : 1;

      if (!virtual) {
        for (const element of [...this.styles.keys()]) if (element !== grid) this.release(element);
        this.tail?.remove(); this.tail = null;
        this.set(grid, "--bxl-columns", String(columns));
        this.signatures.set(grid, this.nativeStyle(grid));
        return;
      }

      this.set(grid, "--bxl-columns", String(columns));
      const cardWidth = Math.max(1, (width - 32 - 16 * (columns - 1)) / columns);
      const tweets = records.filter(record => record.article);
      const first = tweets[0];
      const anchor = tweets.find(record => this.indices.has(record.key));
      if (first && this.indices.size && this.atNativeStart(records[0]?.cell) &&
        (!anchor || this.indices.get(anchor.key) > 0)) {
        // X can replace/crop the home timeline without changing its parent or
        // URL. A native origin with no old head means the old order is obsolete.
        this.indices = new Map();
        this.heights.clear();
        this.nextIndex = 0;
      }
      let previous;
      for (let i = 0; i < tweets.length; i++) {
        const record = tweets[i];
        if (!this.indices.has(record.key)) {
          const next = tweets.slice(i + 1).find(candidate => this.indices.has(candidate.key));
          const distance = next ? tweets.indexOf(next) - i : 0;
          const index = previous !== undefined ? previous + 1 :
            next ? this.indices.get(next.key) - distance : this.nextIndex;
          this.indices.set(record.key, index);
          this.nextIndex = Math.max(this.nextIndex, index + 1);
        }
        previous = this.indices.get(record.key);
      }
      // Prepending before index zero temporarily produces negative indices.
      // Rebase the entire cached order, including unmounted posts, before any
      // column/rise is calculated. The first new post must start in column zero.
      let minimum = 0;
      for (const index of this.indices.values()) minimum = Math.min(minimum, index);
      if (minimum < 0) {
        for (const [key, index] of this.indices) this.indices.set(key, index - minimum);
        this.nextIndex -= minimum;
      }
      for (const record of tweets) {
        record.index = this.indices.get(record.key);
        record.column = ((record.index % columns) + columns) % columns;
        record.row = Math.floor(record.index / columns);
        this.mark(record.cell, "data-bxl-index", String(record.index));
        this.set(record.cell, "--bxl-width", `${cardWidth}px`);
        this.set(record.cell, "--bxl-left", `${16 + record.column * (cardWidth + 16)}px`);
      }
      // Read the natural card height after assigning its column width. The card
      // never gets a fixed height, so late images/video/text can resize it.
      for (const record of tweets) {
        const height = record.card?.getBoundingClientRect().height || record.card?.scrollHeight || 320;
        this.heights.set(record.key, height);
      }
      // Include cached peers that are currently unmounted, while allowing a row
      // to shrink again when media collapses or its visible cards become shorter.
      this.rows = new Map();
      for (const [key, index] of this.indices) {
        const height = this.heights.get(key);
        if (height) {
          const row = Math.floor(index / columns);
          this.rows.set(row, Math.max(this.rows.get(row) || 0, height));
        }
      }
      let pending = 0;
      for (const record of records) {
        if (record.article) {
          const slot = Math.ceil(((this.rows.get(record.row) || 320) + 16) / columns);
          this.set(record.cell, "--bxl-slot-height", `${slot}px`);
          this.set(record.card, "--bxl-rise", `${-record.column * slot}px`);
          pending = ((columns - 1 - record.column) * slot);
        } else {
          this.set(record.cell, "--bxl-width", `${width - 32}px`);
          this.set(record.cell, "--bxl-left", "16px");
          if (record.card) this.set(record.card, "--bxl-rise", `${pending}px`);
        }
        this.signatures.set(record.cell, this.nativeStyle(record.cell));
        if (record.card) this.signatures.set(record.card, this.nativeStyle(record.card));
      }
      // Complete the last partial row outside the React-owned virtual list. This
      // avoids a second vertical scrollbar when a card overflows its short slot.
      if (!this.tail || this.tail.parentElement !== grid.parentElement) {
        this.tail?.remove();
        this.tail = document.createElement("div");
        this.tail.setAttribute("data-bxl-tail", "");
        this.tail.setAttribute("aria-hidden", "true");
        grid.after(this.tail);
      }
      this.set(this.tail, "--bxl-tail-height", `${pending}px`);
      this.signatures.set(grid, this.nativeStyle(grid));
    }
  }
  globalThis.BxlVirtualGrid = VirtualGrid;
})();

// Only the browser process is shared. Every inspection still owns a fresh
// context/page, so cancellation and cookies never affect another request.
export class InspectionBrowser {
  constructor(launch, idleMs = 60_000) {
    this.launch = launch; this.idleMs = idleMs; this.users = 0;
  }
  async acquire() {
    clearTimeout(this.timer);
    this.users++;
    try {
      if (this.browser && !this.browser.isConnected()) this.browser = null;
      if (!this.browser) {
        this.pending ||= this.launch();
        try { this.browser = await this.pending; }
        finally { this.pending = null; }
      }
      return this.browser;
    } catch (error) { this.release(); throw error; }
  }
  release() {
    this.users = Math.max(0, this.users - 1);
    if (!this.users) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.close(); }, this.idleMs);
      this.timer.unref?.();
    }
  }
  async close() {
    clearTimeout(this.timer);
    const browser = this.browser; this.browser = null;
    await browser?.close().catch(() => {});
  }
}

export function attachInspectionBrowser(reader, pool) {
  let leased = false;
  reader.browserProvider = async () => {
    const browser = await pool.acquire(); leased = true; return browser;
  };
  const ensurePage = reader.ensurePage.bind(reader), close = reader.close.bind(reader);
  reader.ensurePage = async () => {
    await ensurePage();
    if (reader.inspectionResourcesBlocked) return;
    // Listing markup and the calendar API do not need gallery media, styles, fonts, or client scripts.
    await reader.context.route('**/*', route => ['image', 'media', 'font', 'stylesheet', 'script'].includes(route.request().resourceType()) ? route.abort() : route.fallback());
    reader.inspectionResourcesBlocked = true;
  };
  reader.close = async () => {
    try { await close(); }
    finally { if (leased) { leased = false; pool.release(); } }
  };
  return reader;
}

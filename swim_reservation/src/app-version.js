const SOURCE = "https://raw.githubusercontent.com/kojungho/swim-reservation-ha-app/main/swim_reservation/config.yaml";
export class AppVersion {
  constructor(current, { fetcher = (...args) => fetch(...args), now = () => Date.now() } = {}) {
    this.current = current; this.fetcher = fetcher; this.now = now; this.cached = null; this.pending = null;
  }
  async info() {
    if (this.cached && this.now() - this.cached.checkedAt < 60_000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.check().finally(() => { this.pending = null; });
    return this.pending;
  }
  async check() {
    try {
      const response = await this.fetcher(SOURCE, { signal: AbortSignal.timeout(6000), headers: { Accept: "text/plain" } });
      if (!response.ok) throw new Error();
      const text = await response.text();
      const latest = text.match(/^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m)?.[1];
      if (!latest) throw new Error();
      const installed = this.current.split(".").map(Number), available = latest.split(".").map(Number);
      const difference = available.map((number, index) => number - installed[index]).find(number => number !== 0) || 0;
      return this.cached = { current: this.current, latest, updateAvailable: difference > 0, checkedAt: this.now(), installInHa: true };
    } catch { return { current: this.current, latest: null, updateAvailable: false, error: "최신 버전을 확인하지 못했습니다. HA 업데이트 화면에서 확인해 주세요.", installInHa: true }; }
  }
}

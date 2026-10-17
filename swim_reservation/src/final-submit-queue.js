import { setTimeout as sleep } from "node:timers/promises";

// Shared by the independent sessions of one multi-room/person run.
export class FinalSubmitQueue {
  constructor({ intervalMs = 5000, now = () => performance.now(), wait = (ms, signal) => sleep(ms, undefined, { signal }) } = {}) {
    this.intervalMs = intervalMs; this.now = now; this.wait = wait;
    this.lastStarted = null; this.tail = Promise.resolve(); this.controller = new AbortController(); this.failure = null;
  }
  stop(error = Object.assign(new Error("예약 실행이 중지되어 대기 중인 최종 제출을 취소했습니다."), { code: "SUBMIT_STOPPED" })) {
    this.failure ||= error; this.controller.abort();
  }
  stoppedError() { return Object.assign(new Error(this.failure.message), { code: this.failure.code }); }
  run(action, onDelay = () => {}) {
    const execute = async () => {
      if (this.failure) throw this.stoppedError();
      try { return await action(); } catch (error) {
        if (error.code === "SITE_RATE_LIMIT") this.stop(Object.assign(new Error("사이트가 요청을 제한하여 대기 중인 최종 제출도 중단했습니다. 예약 내역을 먼저 확인해 주세요."), { code: "SITE_RATE_LIMIT" }));
        throw error;
      }
    };
    // Explicitly disabled: do not serialize otherwise independent final submissions.
    if (this.intervalMs === 0) return Promise.resolve().then(execute);
    const task = this.tail.then(async () => {
      if (this.failure) throw this.stoppedError();
      const remaining = this.lastStarted === null ? 0 : Math.max(0, this.intervalMs - (this.now() - this.lastStarted));
      if (remaining) {
        onDelay(remaining);
        try { await this.wait(remaining, this.controller.signal); } catch (error) { throw this.failure ? this.stoppedError() : error; }
      }
      if (this.failure) throw this.stoppedError();
      this.lastStarted = this.now();
      return execute();
    });
    this.tail = task.catch(() => {});
    return task;
  }
}

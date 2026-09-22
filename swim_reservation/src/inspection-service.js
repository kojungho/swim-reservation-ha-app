export class InspectionService {
  constructor(createEngine, canInspect = () => true) {
    this.createEngine = createEngine;
    this.canInspect = canInspect;
    this.tail = Promise.resolve();
    this.jobs = new Set();
  }

  inspect(config, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const snapshot = structuredClone(config);
    this.jobs.add(controller);
    const task = this.tail.then(async () => {
      if (controller.signal.aborted) throw canceled();
      if (!this.canInspect()) throw Object.assign(new Error("예약 준비 또는 실행 중에는 객실 확인을 잠시 기다려 주세요."), { code: "INSPECTION_BUSY" });
      const engine = this.createEngine();
      // Close only this job's page; never mutate another job's engine references.
      const closePage = () => { void engine.page?.close().catch(() => {}); };
      try {
        await engine.ensurePage();
        if (controller.signal.aborted) throw canceled();
        controller.signal.addEventListener("abort", closePage, { once: true });
        const rooms = await engine.inspect(snapshot);
        if (controller.signal.aborted) throw canceled();
        return rooms;
      } catch (error) {
        if (controller.signal.aborted) throw canceled();
        throw error;
      } finally {
        controller.signal.removeEventListener("abort", closePage);
        await engine.close();
      }
    });
    this.tail = task.catch(() => {});
    return task.finally(() => {
      this.jobs.delete(controller);
      signal?.removeEventListener("abort", cancel);
    });
  }

  async cancelAll() {
    for (const controller of this.jobs) controller.abort();
    await this.tail;
  }
}

function canceled() {
  return Object.assign(new Error("객실 조회를 취소했습니다."), { code: "INSPECTION_CANCELED" });
}

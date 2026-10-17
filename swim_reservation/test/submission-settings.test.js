import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SubmissionSettings, normalizeSubmissionSettings } from "../src/submission-settings.js";
import { ReservationEngine } from "../src/reservation-engine.js";

test("제출 간격은 기본 5초, 0 미사용과 1초를 저장·재시작 후 복원하고 잘못된 입력은 거부한다", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "swim-submit-settings-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new SubmissionSettings(dir);
  assert.equal((await store.read()).intervalSeconds, 5);
  for (const intervalSeconds of [0, 1, 5, 60]) {
    await store.save({ intervalSeconds });
    assert.equal((await new SubmissionSettings(dir).read()).intervalSeconds, intervalSeconds);
  }
  for (const intervalSeconds of [-1, 61, 1.5, "5", NaN]) assert.throws(() => normalizeSubmissionSettings({ intervalSeconds }));
  assert.equal((await store.read()).intervalSeconds, 60);
});

test("실행 큐는 저장한 초를 사용하고 실행 도중 설정 변경은 다음 큐부터 적용한다", async () => {
  let seconds = 1;
  const engine = new ReservationEngine({ store: {}, getFinalSubmitInterval: async () => seconds });
  const first = await engine.createFinalSubmitQueue();
  assert.equal(first.intervalMs, 1000);
  seconds = 0;
  assert.equal(first.intervalMs, 1000);
  assert.equal((await engine.createFinalSubmitQueue()).intervalMs, 0);
});

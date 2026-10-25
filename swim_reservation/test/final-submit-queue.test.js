import test from "node:test";
import assert from "node:assert/strict";
import { FinalSubmitQueue } from "../src/final-submit-queue.js";
import { ReservationEngine } from "../src/reservation-engine.js";

test('0초 동시 제출은 이미 시작된 요청을 회수하지 못하지만 429 확인 뒤 새 제출은 차단한다', async () => {
  const queue = new FinalSubmitQueue({ intervalMs: 0 });
  let release; const gate = new Promise(resolve => { release = resolve; }); let submitted = 0;
  const first = queue.run(async () => { submitted++; await gate; throw Object.assign(new Error('429'), { code: 'SITE_RATE_LIMIT' }); });
  const second = queue.run(async () => { submitted++; await gate; return 'already-started'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted, 2); release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  await assert.rejects(queue.run(async () => { submitted++; }), error => error.code === 'SITE_RATE_LIMIT');
  assert.equal(submitted, 2);
});

test("0은 지연과 직렬화를 끄고 1초는 최소 1000ms 간격을 적용한다", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let started = 0;
  const disabled = new FinalSubmitQueue({ intervalMs: 0, wait: async () => assert.fail("0초에는 대기하지 않음") });
  const tasks = [0, 1].map(() => disabled.run(async () => { started++; await gate; }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(started, 2); release(); await Promise.all(tasks);
  let now = 0; const starts = [];
  const enabled = new FinalSubmitQueue({ intervalMs: 1000, now: () => now, wait: async ms => { now += ms; } });
  await Promise.all([0, 1, 2].map(() => enabled.run(async () => starts.push(now))));
  assert.deepEqual(starts, [0, 1000, 2000]);
});

test("첫 제출은 즉시, 이후 제출은 최소 5초 간격이며 느린 응답 뒤에는 불필요하게 더 기다리지 않는다", async () => {
  let now = 0; const starts = [], waits = [];
  const queue = new FinalSubmitQueue({ now: () => now, wait: async ms => { waits.push(ms); now += ms; } });
  await Promise.all([queue.run(async () => { starts.push(now); now += 700; }), queue.run(async () => { starts.push(now); now += 6000; }), queue.run(async () => starts.push(now))]);
  assert.deepEqual(starts, [0, 5000, 11000]); assert.deepEqual(waits, [4300]);
});

test("HTTP 429 뒤에는 다음 건을 제출하거나 자동 재시도하지 않는다", async () => {
  let submits = 0;
  const queue = new FinalSubmitQueue();
  const results = await Promise.allSettled([
    queue.run(async () => { submits++; throw Object.assign(new Error("429"), { code: "SITE_RATE_LIMIT" }); }),
    queue.run(async () => { submits++; })
  ]);
  assert.equal(submits, 1); assert.ok(results.every(result => result.status === "rejected" && result.reason.code === "SITE_RATE_LIMIT"));
});

test("간격 대기 중 중지하면 타이머를 깨우고 대기 건은 제출하지 않는다", async () => {
  const queue = new FinalSubmitQueue(); let waiting, submits = 0;
  const startedWaiting = new Promise(resolve => { waiting = resolve; });
  await queue.run(async () => { submits++; });
  const pending = queue.run(async () => { submits++; }, waiting);
  await startedWaiting; queue.stop();
  await assert.rejects(pending, error => error.code === "SUBMIT_STOPPED"); assert.equal(submits, 1);
});

for (const mode of ["multiple", "profiles-parallel"]) {
  for (const prepared of [false, true]) {
    test(`${mode} / prepared=${prepared}: 독립 세션의 최종 제출에 공용 5초 간격을 적용한다`, async () => {
      let now = 0; const starts = [], statuses = [];
      const parent = new ReservationEngine({ store: { updateStatus: async patch => statuses.push(patch) } });
      parent.createFinalSubmitQueue = () => new FinalSubmitQueue({ now: () => now, wait: async ms => { now += ms; } });
      const makeSession = index => {
        const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
        engine.clickAction = async () => { starts.push(now); };
        engine.runSingle = async function () { await this.submitFinal(undefined, () => {}); return { room: `객실${index}` }; };
        return { room: `객실${index}`, rank: 1, profileIndex: index, status: {}, config: {}, engine };
      };
      const config = { bookingMode: mode, profiles: [0, 1].map(index => ({ reserverName: `예약자${index}`, phone: "01012345678", roomPriority: [] })) };
      if (mode === "multiple") {
        if (prepared) parent.childSessions = [makeSession(0), makeSession(1)];
        else parent.prepareMultiple = async () => { parent.childSessions = [makeSession(0), makeSession(1)]; };
      } else {
        if (prepared) parent.prioritySessions = [makeSession(0), makeSession(1)];
        parent.createPrioritySession = (_config, _room, entry) => makeSession(entry.index);
      }
      await parent.run(config, { prepared });
      assert.deepEqual(starts, [0, 5000]);
      assert.ok(statuses.some(status => /5초 간격/.test(status.message)));
    });
  }
}

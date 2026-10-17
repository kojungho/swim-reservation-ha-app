import test from "node:test";
import assert from "node:assert/strict";
import { ReservationEngine } from "../src/reservation-engine.js";

const profile = { reserverName: "비공개예약자", phone: "01011112222", roomPriority: [{ name: "솔_산맥존", enabled: true }] };
const config = { bookingMode: "profiles-parallel", profiles: [profile], roomPriority: profile.roomPriority };

for (const mode of ["profiles-parallel", "multiple"]) {
  test(`${mode} 하위 세션의 시작·완료·실패는 상위 로그에 객실과 단계로 기록된다`, async () => {
    const logs = [];
    const parent = new ReservationEngine({ store: { recordLog: async (level, event, message, details) => logs.push({ level, event, message, details }) } });
    const child = mode === "multiple" ? parent.createChildSession(config, "솔_산맥존") : parent.createPrioritySession(config, "솔_산맥존", { index: 0, profile });
    child.engine.closeMainPage = async () => {};
    child.engine.selectedRoom = "솔_산맥존";
    await child.engine.traceStep("personal-fill", async () => {});
    child.engine.navigationFailure = { status: 403, url: "http://example.test/reservation/order_ok3.php" };
    await assert.rejects(() => child.engine.traceStep("final-submit", async () => { throw new Error("응답 실패"); }), /응답 실패/);
    await child.engine.close();
    assert.deepEqual(logs.map(log => [log.details.step, log.details.outcome]), [["personal-fill", "start"], ["personal-fill", "complete"], ["final-submit", "start"], ["final-submit", "error"]]);
    assert.equal(logs.at(-1).details.httpStatus, 403);
    assert.equal(logs.at(-1).details.room, "솔_산맥존");
    assert.equal(new Set(logs.map(log => log.details.attemptId)).size, 1);
    if (mode === "profiles-parallel") { assert.equal(logs.at(-1).details.profileIndex, 0); assert.equal(logs.at(-1).details.rank, 1); }
    assert.ok(!JSON.stringify(logs).includes(profile.phone));
    assert.ok(!JSON.stringify(logs).includes(profile.reserverName));
  });
}

test("로그 저장이 지연되어도 최종 제출 동작을 기다리게 하지 않는다", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const engine = new ReservationEngine({ store: { recordLog: async () => gate } });
  engine.closeMainPage = async () => {};
  let clicked = false;
  await engine.traceStep("final-submit", async () => { clicked = true; });
  assert.equal(clicked, true);
  let closed = false;
  const closing = engine.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  release();
  await closing;
  assert.equal(closed, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { normalizeLookupProfiles } from "../src/lookup-profiles.js";
const booking = { reserverName: "예약 이름", depositorName: "입금 이름", phone: "01012345678", birthDate: "19900101", roomPriority: [{ name: "해_하늘존", enabled: true }] };
test("조회 정보는 이름·전화번호만 저장하며 입금자·생년월일·객실 순위를 포함하지 않는다", () => {
  assert.deepEqual(normalizeLookupProfiles([booking]), [{ reserverName: "예약 이름", phone: "01012345678" }]);
  assert.throws(() => normalizeLookupProfiles([{ reserverName: "이름", phone: "123" }]), /휴대폰/);
  assert.throws(() => normalizeLookupProfiles(Array(6).fill(booking)), /최대 5명/);
});
test("조회 정보와 예약용 정보는 저장·재시작·빈 목록 보존까지 독립이며 기존 정보는 한 번만 복사한다", async t => {
  const data = await mkdtemp(path.join(os.tmpdir(), "swim-lookup-test-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  const store = new Store(data); await store.init();
  await store.saveProfiles([booking]);
  assert.deepEqual(await store.getLookupProfiles(), [{ reserverName: "예약 이름", phone: "01012345678" }]);
  await store.saveLookupProfiles([{ reserverName: "조회 전용", phone: "01099998888", birthDate: "20000101" }]);
  assert.equal((await store.getSavedProfiles())[0].reserverName, "예약 이름");
  await store.saveProfiles([{ ...booking, reserverName: "예약만 변경" }]);
  assert.equal((await new Store(data).getLookupProfiles())[0].reserverName, "조회 전용");
  assert.doesNotMatch(await readFile(store.lookupProfilesPath, "utf8"), /birthDate|depositorName|roomPriority/);
  await Promise.all([store.getLookupProfiles(), store.saveLookupProfiles([])]);
  assert.deepEqual(await new Store(data).getLookupProfiles(), []);
  assert.equal((await store.getSavedProfiles())[0].reserverName, "예약만 변경");
});

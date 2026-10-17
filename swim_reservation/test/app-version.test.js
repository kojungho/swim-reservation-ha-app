import test from "node:test";
import assert from "node:assert/strict";
import { AppVersion } from "../src/app-version.js";

test("공개된 설치 버전을 확인하고 동시 요청·반복 조회는 합친다", async () => {
  let count = 0;
  const reader = new AppVersion("2.13.1", { fetcher: async url => {
    count++; assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/kojungho\/swim-reservation-ha-app\/main\//);
    return new Response('version: "2.14.0"\n');
  } });
  const [first, second] = await Promise.all([reader.info(), reader.info()]);
  assert.equal(first.updateAvailable, true); assert.deepEqual(first, second);
  await reader.info(); assert.equal(count, 1);
  assert.equal(first.installInHa, true);
});
test("버전 확인 실패는 최신이라고 표시하지 않으며 이전 버전으로 다운그레이드하지 않는다", async () => {
  const failure = await new AppVersion("2.14.0", { fetcher: async () => { throw new Error("offline"); } }).info();
  assert.equal(failure.latest, null); assert.ok(failure.error);
  const older = await new AppVersion("2.14.0", { fetcher: async () => new Response('version: "2.13.1"\n') }).info();
  assert.equal(older.updateAvailable, false);
});

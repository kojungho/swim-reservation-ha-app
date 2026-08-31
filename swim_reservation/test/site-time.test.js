import test from "node:test";
import assert from "node:assert/strict";
import { SiteTimeSync } from "../src/site-time.js";

test("사이트 Date 헤더와 RTT 중간값으로 서버 시간 차이를 계산한다", async () => {
  let wall = 10_000;
  let monoCalls = 0;
  const sync = new SiteTimeSync({
    wallNow: () => wall,
    monoNow: () => monoCalls++ ? 40 : 0,
    fetchImpl: async () => {
      wall = 10_040;
      return { headers: new Headers({ date: "Thu, 01 Jan 1970 00:00:11 GMT" }) };
    }
  });

  const status = await sync.sync(1);

  assert.equal(Math.round(status.offsetMs), 980);
  assert.equal(Math.round(status.rttMs), 40);
  assert.equal(status.precisionMs, 1000);
  assert.equal(Math.round(status.serverNowMs), 11_020);
});

test("Date 헤더가 없으면 로컬 시간을 서버 시간으로 표시하지 않는다", async () => {
  const sync = new SiteTimeSync({ fetchImpl: async () => ({ headers: new Headers() }) });
  await assert.rejects(() => sync.sync(1), /Date 헤더/);
  assert.equal(sync.status().synced, false);
  assert.equal(Number.isNaN(sync.now()), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { inspectMonth, monthlyUrl, readMonthlyCalendar } from "../src/monthly-availability.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("월별 PHP의 중첩 font·아이콘을 날짜별 예약 가능·완료·대기로 분석하고 범례를 제외한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<table><tr><td><img src='../images/res/i_ok_0.gif'> 예약가능 <img src='../images/res/i_ok_1.gif'> 예약완료 <img src='../images/res/i_ok_2.gif'> 예약대기</td></tr></table><p>2027 년 1월</p><table><tr><td class=line_lb><font>1</font><font>비수기 주중</font><br><img src='../images/res/i_ok_0.gif'><font>새객실_계곡존<br> <img src='../images/res/i_ok_1.gif'><font>달_하늘존<br> <img src='../images/res/i_ok_2.gif'><font>샘_산맥존<br></td><td class=line_lb><font>2</font></td></tr></table>`);
  const result = await page.evaluate(readMonthlyCalendar);
  assert.deepEqual(result, { month: "2027-01", restricted: false, days: [{ day: 1, rooms: [{ name: "새객실_계곡존", status: "available" }, { name: "달_하늘존", status: "booked" }, { name: "샘_산맥존", status: "pending" }] }, { day: 2, rooms: [] }] });
  await page.setContent(`<table><tr><td>예약</td></tr></table><a href="javascript:alert('아직 예약하실 수 없습니다.');">`);
  assert.equal((await page.evaluate(readMonthlyCalendar)).restricted, true);
});

const fake = parsed => ({ page: { goto: async () => ({ ok: () => true }), evaluate: async () => parsed } });
test("오픈 전이라도 제공된 상태는 보존하고 미제공 날짜를 예약 가능으로 추정하지 않는다", async () => {
  const result = await inspectMonth(fake({ month: "2027-01", days: [{ day: 1, rooms: [{ name: "해_하늘존", status: "available" }, { name: "달_하늘존", status: "booked" }] }] }), { month: "2027-01", nowMs: Date.parse("2026-10-11T00:00:00+09:00") });
  assert.equal(result.days.length, 31);
  assert.equal(result.beforeOpen, true);
  assert.equal(result.opensAt, "2026-11-01T00:00:00");
  assert.equal(result.days[0].rooms[0].status, "available");
  assert.equal(result.days[0].rooms[1].status, "booked");
  assert.equal(result.days[1].rooms[0].status, "unknown");
});

test("사이트가 조회를 제한한 달은 전체 날짜를 미제공으로 표시하고 윤년을 반영한다", async () => {
  const result = await inspectMonth(fake({ month: null, restricted: true, days: [] }), { month: "2028-02", nowMs: Date.parse("2026-10-11T00:00:00+09:00"), knownRooms: ["해_하늘존", "새객실_계곡존"] });
  assert.equal(result.provided, false);
  assert.equal(result.days.length, 29);
  assert.equal(result.roomNames.length, 2);
  assert.equal(result.days.every(day => day.rooms.every(room => room.status === "unknown")), true);
  assert.match(result.message, /제공하지 않습니다/);
});

test("잘못된 월·다른 달 응답·비정상 페이지·HTTP 오류에서 현황을 만들어내지 않는다", async () => {
  assert.throws(() => monthlyUrl("2027-13"));
  assert.throws(() => monthlyUrl("1999-12"));
  assert.throws(() => monthlyUrl("2027-01&aa=1"));
  assert.match(monthlyUrl("2027-01"), /year=2027&month=1$/);
  await assert.rejects(inspectMonth(fake({ month: "2027-02", days: [] }), { month: "2027-01" }), /다른 달/);
  await assert.rejects(inspectMonth(fake({ month: null, restricted: false, days: [] }), { month: "2027-01" }), /정상적인/);
  await assert.rejects(inspectMonth({ page: { goto: async () => ({ ok: () => false, status: () => 403 }) } }, { month: "2027-01" }), /응답 403/);
});

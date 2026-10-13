import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { normalizeConfig, parallelProfileLimit, validateConfig } from "../src/config.js";
import { mockBookApp, testGuest } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("다인 예약은 정상 객실 목록 수까지 허용하고 추가 객실 반영과 인원 초과 거부를 지원한다", () => {
  const base = { startDate: "2027-01-20", triggerAt: "2026-11-01T00:00", nights: 1, bookingMode: "profiles-parallel", profiles: [], roomPriority: [] };
  const config = normalizeConfig(base), count = parallelProfileLimit(config);
  config.profiles = Array.from({ length: count }, (_, index) => ({ ...testGuest(index + 1), roomPriority: [{ name: config.roomPriority[index].name, enabled: true }] }));
  assert.deepEqual(validateConfig(config), []);
  config.profiles.push({ ...testGuest(count + 1), roomPriority: [{ name: "새객실", enabled: true }] });
  assert.match(validateConfig(config).join(","), /객실 수 기준/);
  config.roomPriority.push({ name: "새객실", enabled: false });
  assert.equal(parallelProfileLimit(config), count + 1);
  assert.deepEqual(validateConfig(normalizeConfig(config)), []);
  assert.equal(normalizeConfig({ ...config, editorProfileIndex: 19 }).editorProfileIndex, 19);
});
test("PC·폰은 날짜/박수 한 줄·접힌 시각/종료일·시간 팝업·중앙 월 이동·우측 메뉴·간결한 일정 목록을 표시한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }), state = await mockBookApp(page);
    await page.clock.setFixedTime(new Date("2026-10-13T10:00:00+09:00"));
    await page.waitForFunction(() => document.querySelector("#siteTimeMeta").textContent.includes("정상"));
    assert.equal(await page.locator("#triggerAt").isVisible(), false);
    const geometry = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      return { paired: Math.abs(rect("startDate").top - rect("nights").top) < 1, menuRight: rect("workspaceMenuButton").right > innerWidth - 40, metaSingleLine: document.querySelector(".header-meta").getBoundingClientRect().height < 35, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(geometry, { paired: true, menuRight: true, metaSingleLine: true, overflow: false });
    await page.locator("#reservationConnectionDetails summary").click(); assert.equal(await page.locator("#triggerAt").isVisible(), true);
    await page.locator("#serverTimeButton").click();
    assert.equal(await page.locator("#siteTimeSyncButton").textContent(), "동기화");
    assert.match(await page.locator("#serverTimeValue").textContent(), /2026/);
    await page.locator("#siteTimeSyncButton").click(); await page.waitForFunction(() => !busy); await page.locator("#serverTimeClose").click();
    await page.screenshot({ path: `/tmp/swim-profiles.6W9Acs/compact-date-header-${width}.png` });
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="watch"]').click();
    assert.equal(await page.locator("#workspaceMenuLabel").textContent(), "취소 대기");
    assert.equal(await page.locator("#watchEndsAt").isVisible(), false);
    assert.equal(await page.locator("#watchInterval").isVisible(), false);
    await page.locator("#watchEndsAtDetails summary").click();
    const watchRow = await page.evaluate(() => {
      const input = document.getElementById("watchInterval").getBoundingClientRect(), end = document.querySelector("#watchEndsAt").getBoundingClientRect();
      return Math.abs(input.top - end.top) < 1 && input.right < end.left;
    });
    assert.equal(watchRow, true);
    await page.locator("#watchEndsAt").fill("2027-01-20T18:00");
    state.plans.push({ id: "00000000-0000-0000-0000-000000000001", name: "간결한 일정", kind: "watch", intervalSeconds: 60, config: state.config, enabled: false, status: { state: "stopped" } });
    await page.evaluate(() => refreshPlans());
    assert.ok(await page.locator("#executionPlanList .execution-plan").evaluate(el => el.getBoundingClientRect().height) < 85);
    await page.route(/\/api\/monthly-availability(?:\?|$)/, route => {
      const month = new URL(route.request().url()).searchParams.get("month");
      return route.fulfill({ json: { month, roomNames: ["해_하늘존"], beforeOpen: false, capturedAt: Date.now(), days: [{ date: `${month}-20`, rooms: [{ name: "해_하늘존", status: "available" }] }] } });
    });
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="monthly"]').click();
    await page.locator(".monthly-calendar caption #monthlyMonth").waitFor();
    assert.doesNotMatch(await page.locator(".monthly-calendar caption").textContent(), /전체 객실|날짜별 예약/);
    const center = await page.evaluate(() => {
      const controls = document.querySelector(".monthly-controls").getBoundingClientRect(), table = document.querySelector(".monthly-calendar").getBoundingClientRect();
      return Math.abs((controls.left + controls.right) / 2 - (table.left + table.right) / 2) < 2;
    });
    assert.equal(center, true);
    await page.locator("#monthlyNextButton").click();
    assert.equal(await page.locator(".monthly-calendar caption #monthlyMonth").inputValue(), "2026-11");
    await page.screenshot({ path: `/tmp/swim-profiles.6W9Acs/calendar-caption-${width}.png` });
    assert.deepEqual(state.errors, []); await page.close();
  }
});
test("20명 저장 목록과 객실 수 기준 다인 입력은 5명에서 잘리지 않고 새 객실 추가 시 인원 한도가 늘어난다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), state = await mockBookApp(page, 20);
  await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="book"]').click();
  assert.equal(await page.locator("#bookingBookList .booking-book-row").count(), 20);
  assert.equal(await page.locator("#bookNewButton").isDisabled(), true);
  await page.getByRole("button", { name: "저장예약자20 정보 수정", exact: true }).click();
  await page.locator("#bookReserverName").fill("20번째 수정"); await page.locator("#bookAddButton").click();
  await page.waitForFunction(() => document.querySelector("#bookingBookList").textContent.includes("20번째 수정"));
  await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="profiles-parallel"]').click();
  await page.locator("#startDate").fill("2027-01-20");
  await page.waitForFunction(() => document.querySelector("#profilePriorities input:not(:disabled)"));
  const count = await page.evaluate(() => bookingGuestLimit());
  for (let index = 1; index < count; index++) await page.locator("#addProfileButton").click();
  assert.equal(await page.locator("#extraProfiles .second-profile-panel").count(), count - 1);
  assert.equal(await page.locator("#addProfileButton").isDisabled(), true);
  await page.locator(`#bookingProfileSelect${count}`).selectOption("19");
  assert.equal(await page.locator(`#reserverName${count}`).inputValue(), "20번째 수정");
  state.availability = [...state.config.roomPriority.map(room => ({ name: room.name, available: true, status: "available" })), { name: "새객실", available: true, status: "available" }];
  await page.evaluate(() => refreshAvailability());
  assert.equal(await page.locator("#addProfileButton").isEnabled(), true);
  await page.locator("#addProfileButton").click();
  assert.equal(await page.evaluate(() => readConfig().profiles.length), count + 1);
  const configuration = await page.evaluate(() => readConfig());
  await page.evaluate(configuration => loadConfig(configuration), configuration);
  assert.equal(await page.locator("#extraProfiles .second-profile-panel").count(), count);
  assert.equal(state.book.length, 20); assert.deepEqual(state.errors, []);
});

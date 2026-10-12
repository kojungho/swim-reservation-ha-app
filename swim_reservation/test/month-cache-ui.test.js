import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";

const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("3개월 뒤는 저장 현황을 즉시 보여주고 조회는 서버 갱신, 이후 달은 기존 조회를 유지한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.setFixedTime(new Date("2026-10-12T10:00:00+09:00"));
  const state = await mockBookApp(page);
  let refreshes = 0, directReads = 0, intervalMinutes = 60;
  const result = month => ({ month, beforeOpen: true, opensAt: "2026-11-01T00:00:00", capturedAt: Date.parse("2026-10-12T09:00:00+09:00"), roomNames: ["해"], days: [{ date: `${month}-01`, rooms: [{ name: "해", status: "available" }] }] });
  await page.route(/\/api\/month-cache(?:\/refresh)?$/, async route => {
    if (route.request().url().endsWith("/refresh")) refreshes++;
    if (route.request().method() === "PUT") intervalMinutes = route.request().postDataJSON().intervalMinutes;
    await route.fulfill({ json: { targetMonth: "2027-01", intervalMinutes, result: result("2027-01"), finishedAt: Date.parse("2026-10-12T09:00:00+09:00"), running: false, message: "미리 조회 완료" } });
  });
  await page.route(/\/api\/monthly-availability\?/, route => { directReads++; return route.fulfill({ json: result(new URL(route.request().url()).searchParams.get("month")) }); });
  await page.evaluate(() => { switchWorkspaceTab("monthly"); elements.monthlyMonth.value = "2027-01"; return loadMonthlyAvailability(); });
  await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("전체 갱신"));
  assert.equal(directReads, 0); assert.equal(refreshes, 0);
  await page.locator("#monthlyQueryButton").click();
  await page.waitForFunction(() => !document.querySelector("#monthlyQueryButton").disabled);
  assert.equal(refreshes, 1); assert.equal(directReads, 0);
  await page.locator(".monthly-prefetch summary").click();
  await page.locator("#monthlyCacheInterval").selectOption("30");
  await page.locator("#monthlyCacheSave").click();
  await page.waitForFunction(() => document.querySelector("#monthlyCacheMessage").textContent.includes("30분"));
  assert.equal(intervalMinutes, 30);
  await page.evaluate(() => { elements.monthlyMonth.value = "2027-02"; return loadMonthlyAvailability(); });
  assert.equal(directReads, 1);
  assert.deepEqual(state.errors, []);
});

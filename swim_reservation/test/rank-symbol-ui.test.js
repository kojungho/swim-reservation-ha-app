import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("목록·개인별 순위·일정·이력은 동그라미 숫자로 통일하고 순위 없는 모드는 번호를 생략한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const state = await mockBookApp(page);
    const expected = Array.from({ length: 14 }, (_, i) => `${i + 1}순위`);
    await page.evaluate(() => { rooms.forEach(room => { room.enabled = true; }); renderRooms(); });
    assert.deepEqual(await page.locator("#roomList .room-rank").allTextContents(), expected);
    assert.match(await page.locator("#roomList").innerText(), /1순위/);
    const config = await page.evaluate(() => readConfig());
    state.plans.push({ id: "00000000-0000-0000-0000-000000000001", name: "순위 일정", kind: "scheduled", enabled: false, config, status: { state: "stopped" } });
    await page.evaluate(() => refreshPlans());
    assert.match(await page.locator(".plan-profile-targets").innerText(), /① 해 → ② 달/);
    await page.evaluate(() => renderHistory([{ id: "test", startDate: "2026-12-20", nights: 1, savedAt: Date.now(), enabledRooms: ["해_하늘존", "샘_산맥존"], bookingMode: "priority" }]));
    assert.equal(await page.locator(".history-rooms").innerText(), "① 해 → ② 샘");
    await page.evaluate(() => { elements.bookingMode.value = "profiles-parallel"; firstProfilePriority = [{ name: "해_하늘존", enabled: true }, { name: "샘_산맥존", enabled: true }]; renderProfilePriorities(); });
    assert.deepEqual(await page.locator("#profilePriorities .room-rank").allTextContents().then(values => values.slice(0, 2)), ["1순위", "2순위"]);
    await page.evaluate(() => { elements.bookingMode.value = "multiple"; renderRooms(); });
    assert.equal(await page.locator("#roomList .room-rank").count(), 0);
    await page.evaluate(() => { switchWorkspaceTab("watch"); });
    assert.equal(await page.locator("#roomList .room-rank").count(), 0);
    assert.equal(await page.evaluate(() => roomSummaryText(["해_하늘존", "샘_산맥존"], false)), "해, 샘");
    assert.equal(await page.evaluate(() => shortRoomText("예약자 1: 2순위 샘_산맥존 진행 중")), "예약자 1: ② 샘 진행 중");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(state.errors, []); await page.close();
  }
});

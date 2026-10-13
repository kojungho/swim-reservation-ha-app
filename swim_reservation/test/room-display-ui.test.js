import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("객실 목록은 원래 이름 유지, 다른 화면은 구역명 생략, 위치 버튼은 모든 탭·스크롤에서 유지", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const state = await mockBookApp(page);
    assert.match(await page.locator("#roomList").innerText(), /하늘존/);
    await page.evaluate(() => {
      renderStatus({ state: "failed", message: "샘_산맥존 · 숲_하늘존 확인 필요", selectedRoom: "샘_산맥존", selectedRooms: ["숲_하늘존"], profileStatuses: [{ label: "예약자 1", room: "샘_산맥존", message: "숲_하늘존 확인" }] });
      renderReservations([{ room: "샘_산맥존", stayDate: "2026-12-20", nights: "1박", status: "예약 완료" }]);
    });
    for (const id of ["statusText", "statusDetails", "profileStatusList", "reservationList"]) assert.doesNotMatch(await page.locator(`#${id}`).textContent(), /하늘존|산맥존/);
    const floating = page.locator("#siteMapButton");
    assert.equal(await floating.getAttribute("aria-label"), "사이트 위치");
    assert.equal(await floating.locator(".site-map-label").isVisible(), width > 600);
    assert.equal(await floating.evaluate(el => getComputedStyle(el).position), "fixed");
    const before = await floating.boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const after = await floating.boundingBox();
    assert.ok(Math.abs(before.y - after.y) < 1);
    for (const tab of ["people", "monthly", "logs", "book"]) {
      await page.locator(`[data-workspace-tab="${tab}"]`).click();
      assert.equal(await floating.isVisible(), true);
    }
    await floating.click(); await page.locator("#siteMapDialog").waitFor();
    assert.equal(await page.locator("#siteMapDialog").evaluate(el => el.matches(":modal")), true);
    assert.deepEqual(state.errors, []); await page.close();
  }
});

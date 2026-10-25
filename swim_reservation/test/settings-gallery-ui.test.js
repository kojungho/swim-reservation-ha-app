import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
import { DEFAULT_UI_SETTINGS } from "../src/ui-settings.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=", "base64");

test("설정은 저장·복원·글자 종류·4개 모서리·인접 배치·도움말·표시만 숨기기를 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const state = await mockBookApp(page); let saved = structuredClone(DEFAULT_UI_SETTINGS);
    await page.route("https://app.test/api/ui-settings", route => { if (route.request().method() === "PUT") saved = route.request().postDataJSON(); return route.fulfill({ json: saved }); });
    await page.locator("#roomList select").selectOption({index:1});await page.locator("#roomList .site-choice-tools button").click();
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="settings"]').click();
    assert.equal(await page.locator("#font-room").inputValue(), "14");
    await page.locator("#font-room").fill("18");
    assert.equal(await page.locator(".room-name").first().evaluate(el => getComputedStyle(el).fontSize), "18px");
    for (const key of ["serverTime", "reservationInfo", "safety", "watchInfo"]) await page.locator(`#setting-${key}`).uncheck();
    assert.equal(await page.locator("#serverTimeButton").isVisible(), false);
    assert.equal(await page.locator("#safetyNotice").isVisible(), false);
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      await page.locator("#setting-menuCorner").selectOption(corner); await page.locator("#setting-mapCorner").selectOption(corner);
      const menu = await page.locator("#workspaceMenuButton").boundingBox(), map = await page.locator("#siteMapButton").boundingBox();
      assert.ok(Math.abs(menu.y - map.y) < 2, `${width} ${corner}: same row`);
      assert.ok(menu.x + menu.width <= map.x - 6 || map.x + map.width <= menu.x - 6, `${width} ${corner}: separated`);
      assert.ok(menu.x >= 0 && map.x >= 0 && menu.x + menu.width <= width && map.x + map.width <= width);
      await page.locator("#workspaceMenuButton").click();
      const dropdown = await page.locator("#workspaceMenu").boundingBox(); assert.ok(dropdown.y >= 0 && dropdown.y + dropdown.height <= 844);
      await page.keyboard.press("Escape");
    }
    await page.locator("#setting-menuSpacing").fill("0");
    await page.locator('[aria-label="메뉴 간격 설명"]').click(); await page.locator("#settingsHelpDialog").waitFor();
    assert.match(await page.locator("#settingsHelpText").textContent(), /0~16/); await page.locator("#settingsHelpClose").click();
    await page.locator("#settingsSave").click(); await page.waitForFunction(() => document.getElementById("settingsMessage").textContent.includes("저장했습니다"));
    assert.equal(saved.fonts.room, 18); assert.equal(saved.serverTime, false); assert.equal(saved.menuSpacing, 0);
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="watch"]').click();
    assert.equal(await page.locator("#watchEndsAtDetails").isVisible(), false);
    const interval = await page.locator("#watchInterval").inputValue(); assert.equal(interval, "60");
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="priority"]').click();
    assert.equal(await page.locator("#reservationConnectionDetails").isVisible(), false);
    assert.equal(state.config.triggerAt, "2026-10-20T00:00:00");
    await page.reload(); await page.waitForFunction(() => document.getElementById("bookingProfileSelect1").options.length === 3 && document.querySelector("#settingsControls").children.length > 0);
    assert.equal(await page.locator("#serverTimeButton").isVisible(), false);
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="settings"]').click();
    assert.equal(await page.locator("#font-room").inputValue(), "18");
    await page.locator("#settingsCard").screenshot({ path: `/tmp/swim-profiles.6W9Acs/settings-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(state.errors, []); assert.equal(state.planCalls.length, 0); await page.close();
  }
});

test("사진 갤러리는 6개·확대·적용·삭제 취소·선택 삭제·전체 삭제를 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), state = await mockBookApp(page);
  let gallery = { entries: Array.from({ length: 6 }, (_, index) => ({ id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, createdAt: Date.now() })), activeId: "00000000-0000-0000-0000-000000000001" };
  await page.route("https://app.test/api/site-map**", route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/api/site-map/gallery") {
      if (req.method() === "DELETE") {
        const { ids } = req.postDataJSON(); gallery.entries = gallery.entries.filter(entry => !ids.includes(entry.id));
        if (ids.includes(gallery.activeId)) gallery.activeId = gallery.entries.at(-1)?.id || null;
      }
      return route.fulfill({ json: gallery });
    }
    if (req.method() === "POST") { gallery.activeId = url.pathname.split("/").at(-1); return route.fulfill({ json: gallery }); }
    return route.fulfill({ contentType: "image/png", body: png, headers: url.searchParams.get("download") === "1" ? { "Content-Disposition": 'attachment; filename="swim-map-test.png"' } : {} });
  });
  await page.locator("#siteMapButton").click(); await page.waitForFunction(() => document.getElementById("galleryCount").textContent === "6/6");
  assert.equal(await page.locator("#siteMapUploadButton").isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "배치도 사진 추가", exact: true }).isDisabled(), true);
  assert.match(await page.locator("#galleryAddButton").textContent(), /6장 가득 참/);
  assert.equal(await page.locator(".gallery-download").count(), 6);
  assert.match(await page.locator(".gallery-download").first().getAttribute("href"), /000000000001\?download=1$/);
  assert.match(await page.locator(".gallery-download").first().getAttribute("download"), /^swim-map-.*\.png$/);
  await page.locator(".gallery-preview").nth(1).click(); await page.locator("#mapZoomDialog").waitFor();
  assert.match(await page.locator("#mapZoomImage").getAttribute("src"), /000000000002$/); await page.locator("#mapZoomClose").click();
  await page.locator(".gallery-photo").nth(1).getByRole("button", { name: "적용", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".gallery-photo")[1].textContent.includes("적용 중"));
  assert.match(gallery.activeId, /000000000002$/);
  state.rejectDialogs = true; await page.locator("#galleryDeleteAll").click(); assert.equal(gallery.entries.length, 6); state.rejectDialogs = false;
  await page.locator(".gallery-select input").nth(1).check(); await page.locator(".gallery-select input").nth(2).check();
  await page.locator("#galleryDeleteSelected").click(); await page.waitForFunction(() => document.getElementById("galleryCount").textContent === "4/6");
  assert.equal(await page.locator("#siteMapUploadButton").isVisible(), false);
  assert.equal(await page.locator("#galleryAddButton").isEnabled(), true);
  assert.equal(await page.locator("#mapGallery > :last-child").getAttribute("id"), "galleryAddButton");
  const chooserWait = page.waitForEvent("filechooser"); await page.locator("#galleryAddButton").click(); const chooser = await chooserWait; await chooser.setFiles([]);
  assert.equal(await page.locator("#galleryDeleteSelected").isDisabled(), true);
  await page.locator("#siteMapDialog").screenshot({ path: "/tmp/swim-profiles.6W9Acs/gallery-390.png" });
  await page.locator("#galleryDeleteAll").click(); await page.waitForFunction(() => document.getElementById("galleryCount").textContent === "0/6");
  assert.equal(gallery.activeId, null); assert.equal(await page.locator("#galleryDeleteAll").isDisabled(), true);
  assert.equal(await page.locator("#galleryAddButton").isEnabled(), true);
  assert.equal(await page.locator("#galleryAddButton").count(), 1);
  await page.locator("#siteMapCloseButton").click(); await page.locator("#siteMapButton").click(); assert.equal(await page.locator(".gallery-photo").count(), 0);
  assert.deepEqual(state.errors, []); assert.equal(state.planCalls.length, 0);
});

test("월별 조회 원형 표시는 진행 중만 표시하고 날짜별 조회중·확인됨 문구는 제거한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), state = await mockBookApp(page);
  let release, fail = false;
  await page.route(/\/api\/monthly-availability(?:\?|$)/, async route => {
    await new Promise(resolve => { release = resolve; });
    const month = new URL(route.request().url()).searchParams.get("month");
    await route.fulfill(fail ? { status: 503, json: { error: "조회 실패 테스트" } } : { json: { month, roomNames: ["해_하늘존"], days: [{ date: `${month}-20`, rooms: [{ name: "해_하늘존", status: "available" }] }] } });
  });
  await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="monthly"]').click();
  await page.locator("#monthlyQuerySpinner").waitFor();
  await page.waitForFunction(() => document.getElementById("monthlyContent").getAttribute("aria-busy") === "true");
  for (let i = 0; !release && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(release); release();
  await page.locator("#monthlyQuerySpinner").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".monthly-day-state:visible").count(), 0);
  assert.doesNotMatch(await page.locator(".monthly-calendar").innerText(), /조회중|확인됨/);
  fail = true; release = null; await page.locator("#monthlyQueryButton").click(); await page.locator("#monthlyQuerySpinner").waitFor();
  for (let i = 0; !release && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(release); release();
  await page.locator("#monthlyQuerySpinner").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#monthlyContent").getAttribute("aria-busy"), "false");
  assert.deepEqual(state.errors, []); assert.equal(state.planCalls.length, 0);
});

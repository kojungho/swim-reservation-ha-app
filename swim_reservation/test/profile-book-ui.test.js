import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { defaultConfig, normalizeConfig, normalizeProfile } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("모바일 예약자 별도 저장·복원, 5명 조회, 선택한 한 명 사이트 이동 및 모드별 개인 순위", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let config = defaultConfig();
  let book = [{ reserverName: "저장된첫째", depositorName: "입금첫째", phone: "01012345678", birthDate: "19900101" }];
  let lookupCount = 0, siteProfile, lookupBook;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://app.test/**", async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    let data;
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/config") {
        if (request.method() === "PUT") config = normalizeConfig(request.postDataJSON());
        data = request.method() === "PUT" ? { config } : config;
      } else if (pathname === "/api/profiles") {
        if (request.method() === "PUT") book = request.postDataJSON().profiles.map(normalizeProfile);
        data = { profiles: book };
      } else if (pathname === "/api/lookup-profiles") {
        lookupBook ||= book.map(({ reserverName, phone }) => ({ reserverName, phone }));
        if (request.method() === "PUT") lookupBook = request.postDataJSON().profiles;
        data = { profiles: lookupBook };
      } else if (pathname === "/api/reservation-check-url") {
        siteProfile = request.postDataJSON().profile;
        data = { url: "about:blank#chosen-profile" };
      } else if (pathname === "/api/reservations") {
        lookupCount = lookupBook?.length || 0;
        data = { reservations: (lookupBook || []).map((profile, index) => ({ profileIndex: index, profileLabel: profile.reserverName, room: "해_하늘존", stayDate: "2026년12월04일", nights: "1박", status: "예약 완료", total: "60,000원" })) };
      } else if (pathname === "/api/history") {
        data = { entries: config.profiles ? [{ id: "saved", savedAt: Date.now(), startDate: config.startDate, nights: config.nights, bookingMode: config.bookingMode, profileCount: config.profiles.length,
          enabledRooms: ["표시하면 안 되는 공통 순위"], multipleProfileName: config.profiles[config.multipleProfileIndex || 0].reserverName,
          profilePriorities: config.profiles.map((profile, index) => ({ index, reserverName: profile.reserverName, enabledRooms: profile.roomPriority.filter(room => room.enabled).map(room => room.name) })) }] : [] };
      } else if (pathname === "/api/status") data = { state: "idle", stage: "idle" };
      else data = { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
      return route.fulfill({ json: data });
    }
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
  });
  await page.goto("https://app.test/");
  await page.waitForFunction(() => document.querySelector("#reserverName").value === "저장된첫째");
  assert.equal(await page.locator("#profilePriorities").isVisible(), false);
  await page.locator(".workspace-tabs .active").waitFor();
  await page.locator('[data-workspace-tab="profiles-parallel"]').click();
  for (let n = 2; n <= 5; n++) {
    await page.locator("#addProfileButton").click();
    await page.locator(`#reserverName${n}`).fill(`사람${n}`);
    await page.locator(`#depositorName${n}`).fill(`입금${n}`);
    await page.locator(`#phone${n}`).fill(`0101234567${n}`);
    await page.locator(`#birthDate${n}`).fill("19900101");
    assert.equal(await page.locator("#bookingMode").inputValue(), "profiles-parallel");
  }
  await page.evaluate(() => document.querySelector("#startDate").value = "");
  await page.locator("#saveProfilesButton").click();
  await page.waitForFunction(() => document.body.innerText.includes("예약용 정보를 저장했습니다."));
  assert.equal(book.length, 5);
  assert.equal(config.profiles, undefined);
  await page.locator('[data-workspace-tab="multiple"]').click();
  assert.equal(await page.locator("#bookingMode").inputValue(), "multiple");
  assert.equal(await page.locator("#multipleProfileField").isVisible(), true);
  assert.equal(await page.locator("#multipleProfileSelect option").count(), 5);
  await page.locator("#multipleProfileSelect").selectOption("3");
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => document.body.innerText.includes("설정을 HA 미니 PC에 저장했습니다."));
  assert.equal(config.bookingMode, "multiple");
  assert.equal(config.multipleProfileIndex, 3);
  assert.equal(config.profiles.length, 5);
  await page.reload();
  await page.locator("#reserverName5").waitFor({ state: "attached" });
  assert.equal(await page.locator("#bookingMode").inputValue(), "multiple");
  assert.equal(await page.locator("#multipleProfileSelect").inputValue(), "3");
  await page.locator('[data-workspace-tab="profiles-parallel"]').click();
  assert.equal(await page.locator("#roomList").isVisible(), false);
  assert.equal(await page.locator("#profilePriorities .room-list").count(), 5);
  const first = page.locator('[data-profile-index="0"]');
  await first.getByRole("checkbox", { name: "예약자 1 해_하늘존 선택", exact: true }).check();
  const second = page.locator('[data-profile-index="1"]');
  await second.getByRole("checkbox", { name: "예약자 2 달_하늘존 선택", exact: true }).check();
  await second.getByRole("button", { name: "예약자 2 달_하늘존 순서 이동", exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await page.locator("#saveProfilesButton").click();
  await page.waitForFunction(() => document.body.innerText.includes("예약용 정보를 저장했습니다."));
  assert.equal(book[0].roomPriority.find(room => room.name === "해_하늘존").enabled, true);
  assert.equal(book[1].roomPriority[0].name, "달_하늘존");
  assert.equal(book[0].roomPriority[0].name, "해_하늘존");
  await page.locator('[data-workspace-tab="profiles-parallel"]').click();
  await page.locator("#saveButton").click();
  await page.locator("#historyList .history-profile-priority").nth(4).waitFor();
  assert.equal(await page.locator("#historyList .history-profile-priority").count(), 5);
  const historyText = await page.locator("#historyList").innerText();
  assert.match(historyText, /예약자 1 · 저장된첫째\s+1순위 해_하늘존/);
  assert.match(historyText, /예약자 2 · 사람2\s+1순위 달_하늘존/);
  assert.equal(historyText.includes("표시하면 안 되는 공통 순위"), false);
  await page.locator('[data-workspace-tab="people"]').click();
  await page.locator("#reservationLookupButton").click();
  await page.locator("#reservationList .reservation-row").nth(4).waitFor();
  assert.equal(lookupCount, 5);
  await page.locator("#lookupreserverName1").fill("조회 전용 이름");
  await page.locator("#saveLookupProfilesButton").click();
  await page.waitForFunction(() => document.querySelector("#lookupMessage").textContent.includes("조회용 정보만 저장"));
  assert.equal(book[0].reserverName, "저장된첫째");
  assert.equal(config.profiles[0].reserverName, "저장된첫째");
  assert.equal(lookupBook[0].reserverName, "조회 전용 이름");
  assert.deepEqual(Object.keys(lookupBook[0]).sort(), ["phone", "reserverName"]);
  await page.locator("#siteProfileSelect").selectOption("3");
  await page.locator("#reservationSiteButton").click();
  await page.waitForTimeout(100);
  assert.equal(siteProfile.reserverName, "사람3");
  await page.reload();
  await page.locator("#reserverName5").waitFor({ state: "attached" });
  assert.equal(await page.locator("#reserverName5").inputValue(), "사람5");
  await page.locator('[data-workspace-tab="profiles-parallel"]').click();
  assert.match(await page.locator('[data-profile-index="1"] .room-row').first().innerText(), /^1순위달_하늘존/);
  await page.locator('[data-workspace-tab="priority"]').click();
  assert.equal(await page.locator("#profilePriorities").isVisible(), false);
  assert.equal(await page.locator("#roomList").isVisible(), true);
  assert.deepEqual(errors, []);
});

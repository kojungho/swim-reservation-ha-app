import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp, openPlanDetails, testGuest } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
const switchTab = async (page, tab) => { await page.locator("#workspaceMenuButton").click(); await page.locator(`[data-workspace-tab="${tab}"]`).click(); };
test("저장 이력에 실행·모드·상세 팝업을 통합하고 중지된 선택만 삭제하며 등록 일정은 보존한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }), state = await mockBookApp(page);
    page.setDefaultTimeout(5000);
    state.plans.push(...["priority", "multiple", "profiles-parallel", "priority"].map((mode, index) => ({ id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, name: `일정 ${index + 1}`, kind: index === 3 ? "watch" : "scheduled", enabled: index === 1, intervalSeconds: 60, revision: `rev-${index}`, config: { ...state.config, bookingMode: mode }, status: { state: index === 1 ? "waiting" : index === 2 ? "success" : "stopped" } })));
    await page.evaluate(() => refreshPlans());
    assert.equal(await page.locator("#historyCard #executionPlanList").count(), 1);
    assert.equal(await page.locator("#historyCard #startAllPlans").count(), 1);
    assert.equal(await page.locator("#executionCard").isVisible(), false);
    assert.deepEqual(await page.locator("#executionPlanList small").allTextContents(), ["단독 예약 · 중지", "다중 예약 · 진행 중", "다인 예약 · 완료", "취소 대기 · 중지"]);
    await openPlanDetails(page, 1);
    assert.equal(await page.locator('[data-action="edit"]').isDisabled(), true);
    assert.equal(await page.locator('[data-action="delete"]').isDisabled(), true);
    await page.locator("#planDetailsClose").click();
    await openPlanDetails(page, 0);
    assert.equal(await page.locator('[data-action="edit"]').isEnabled(), true);
    assert.equal(await page.locator('[data-action="delete"]').textContent(), "삭제");
    await page.locator('[data-action="edit"]').click();
    assert.equal(await page.locator("#addPlanButton").textContent(), "수정 저장");
    await page.locator("#cancelPlanEdit").click();
    for (const input of await page.locator("#executionPlanList input").all()) await input.check();
    state.rejectDialogs = true; await page.locator("#deleteSelectedPlans").click(); await page.waitForFunction(() => !planBatchPending); assert.equal(state.plans.length, 4);
    state.rejectDialogs = false; await page.locator("#deleteSelectedPlans").click();
    await page.waitForFunction(() => document.querySelectorAll("#executionPlanList .execution-plan").length === 2);
    assert.deepEqual(state.plans.map(entry => entry.name), ["일정 2", "일정 3"]);
    assert.equal(await page.locator("#deleteSelectedPlans").isDisabled(), true);
    assert.equal(state.planCalls.length, 0);
    await page.locator("#historyCard").screenshot({ path: `/tmp/swim-profiles.6W9Acs/unified-history-${width}.png` });
    assert.deepEqual(state.errors, []); await page.close();
  }
});
test("예약자 추가 폼·수정 저장·첫 예약자 제외·사람별 색상은 저장 일정과 객실 정보를 임의 변경하지 않는다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }), state = await mockBookApp(page);
    await switchTab(page, "book");
    assert.equal(await page.locator("#bookEditor").isVisible(), false);
    await page.locator("#bookNewButton").click(); assert.equal(await page.locator("#bookAddButton").isDisabled(), true);
    await page.locator("#bookCancelButton").click();
    await page.getByRole("button", { name: "저장예약자1 정보 수정", exact: true }).click();
    await page.locator("#bookReserverName").fill("수정예약자");
    state.rejectBook = true; await page.locator("#bookAddButton").click();
    assert.equal(state.book[0].reserverName, "저장예약자1"); assert.equal(await page.locator("#bookEditor").isVisible(), true);
    state.rejectBook = false; await page.locator("#bookAddButton").click();
    await page.waitForFunction(() => document.querySelector("#bookingBookList").textContent.includes("수정예약자"));
    assert.equal(state.book.length, 2); assert.equal(state.book[0].roomPriority[0].name, "달_하늘존");
    assert.equal(await page.locator("#bookEditor").isVisible(), false);
    await switchTab(page, "profiles-parallel");
    await page.locator("#bookingProfileSelect1").selectOption("0"); await page.locator("#addProfileButton").click();
    await page.locator("#bookingProfileSelect2").selectOption("1");
    await page.evaluate(() => { firstProfilePriority = [{ name: "해_하늘존", enabled: true }]; extraProfiles[0].roomPriority = [{ name: "샘_산맥존", enabled: true }]; renderRooms(); });
    const colors = await page.evaluate(() => [getComputedStyle(document.getElementById("firstBookingProfilePanel")).backgroundColor, getComputedStyle(document.querySelector("#extraProfiles .second-profile-panel")).backgroundColor]);
    assert.notEqual(colors[0], colors[1]);
    await page.locator("#excludeFirstProfile").click();
    await page.locator('#profileRemoveConfirm').click();
    assert.equal(await page.locator("#reserverName").inputValue(), "저장예약자2");
    assert.deepEqual(await page.evaluate(() => firstProfilePriority[0]), { name: "샘_산맥존", enabled: true });
    assert.equal(await page.locator("#extraProfiles .second-profile-panel").count(), 0);
    assert.equal(state.book.length, 2);
    assert.deepEqual(state.errors, []); await page.close();
  }
});
test("예약 조회는 저장 예약자 모두를 색상별로 묶고 실패와 내역 없음을 구분하며 1회성 조회는 분리한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }), state = await mockBookApp(page, 3);
    state.lookupResult = { reservations: [{ id: "1", room: "해_하늘존", stayDate: "2026년 12월 20일", nights: "1박", total: "100,000원", status: "예약 완료", cancelable: false, profileIndex: 0 }], lookupErrors: [{ profileIndex: 2, message: "연결 실패" }] };
    await switchTab(page, "people");
    await page.locator("#reservationList .reservation-row").waitFor();
    assert.equal(await page.locator("#reservationList .reservation-person-group").count(), 3);
    assert.match(await page.locator("#reservationList .reservation-person-group").nth(1).innerText(), /내역 없음/);
    assert.match(await page.locator("#reservationList .reservation-person-group").nth(2).innerText(), /조회 실패/);
    assert.doesNotMatch(await page.locator("#reservationList .reservation-person-group").nth(2).innerText(), /내역 없음/);
    const before = await page.locator("#reservationList").innerText();
    await page.locator(".one-off-lookup summary").click();
    await page.locator("#oneOffName").fill("일회예약자"); await page.locator("#oneOffPhone").fill("01012345679");
    state.lookupResult = null;
    await page.locator("#oneOffLookupButton").click();
    await page.locator("#oneOffReservations .reservation-person-group").waitFor();
    assert.equal(await page.locator("#reservationList").innerText(), before);
    assert.match(await page.locator("#oneOffReservations").innerText(), /일회예약자.*01012345679[\s\S]*내역 없음/);
    assert.deepEqual(state.lookupRequests.at(-1), { method: "POST", profiles: [{ reserverName: "일회예약자", phone: "01012345679" }] });
    assert.equal(state.book.length, 3); assert.equal(state.lookupBook.length, 0);
    assert.equal(state.writes.some(path => /lookup-profiles|profiles|cancel|\/start/.test(path)), false);
    await page.locator("#lookupCard").screenshot({ path: `/tmp/swim-profiles.6W9Acs/grouped-lookup-${width}.png` });
    assert.deepEqual(state.errors, []); await page.close();
  }
});

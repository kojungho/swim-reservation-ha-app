import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp, testGuest } from "./fixtures/ui-book-app.js";

const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("PC·폰의 예약자 관리에서 5명 추가·삭제·실패 복구와 로그 탭·객실 새로 고침·전체 선택을 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const state = await mockBookApp(page);
    assert.equal(await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
      return new Set(ids).size === ids.length;
    }), true);
    assert.equal(await page.locator("#logCard").isVisible(), false);
    assert.equal(await page.locator("#inspectButton").innerText(), "새로 고침");
    assert.equal(await page.evaluate(() => document.querySelector("#inspectButton").closest("section").contains(document.querySelector("#roomList"))), true);
    assert.equal(await page.evaluate(() => document.querySelector("#runNowButton").closest("section").contains(document.querySelector("#inspectResult"))), false);
    assert.equal(await page.locator("#roomList .drag-bars").count(), await page.locator("#roomList .room-row").count());
    assert.ok(await page.locator("#roomList .room-row").first().evaluate(row => row.getBoundingClientRect().height) <= 50);
    await page.locator("#bookingProfileSelect1").selectOption("0");
    await page.locator("#roomList input[type=checkbox]").first().check();
    await page.locator("#planName").fill("보존할 일정");
    await page.locator("#addPlanButton").click();
    await page.locator("#planList .plan-entry").waitFor();
    await page.locator('[data-workspace-tab="book"]').click();
    assert.equal(await page.locator("#bookingBookList .booking-book-row").count(), 2);
    async function fillBook(number) {
      const guest = testGuest(number);
      for (const [key, id] of [["reserverName", "bookReserverName"], ["depositorName", "bookDepositorName"], ["phone", "bookPhone"], ["birthDate", "bookBirthDate"]]) await page.locator("#" + id).fill(guest[key]);
    }
    await fillBook(3);
    state.rejectBook = true;
    await page.locator("#bookAddButton").click();
    await page.waitForFunction(() => document.querySelector("#workspaceMessage").textContent.includes("저장 실패 테스트"));
    assert.equal(state.book.length, 2);
    assert.equal(await page.locator("#bookReserverName").inputValue(), testGuest(3).reserverName);
    state.rejectBook = false;
    for (let number = 3; number <= 5; number++) {
      await fillBook(number);
      await page.locator("#bookAddButton").click();
      await page.waitForFunction(count => document.querySelectorAll("#bookingBookList .booking-book-row").length === count, number);
      assert.equal(await page.locator("#bookReserverName").inputValue(), "");
    }
    assert.equal(await page.locator("#bookAddButton").isDisabled(), true);
    for (let number = 1; number <= 5; number++) {
      await page.getByRole("button", { name: testGuest(number).reserverName + " 저장 정보 삭제", exact: true }).click();
      await page.waitForFunction(count => document.querySelectorAll("#bookingBookList .booking-book-row").length === count, 5 - number);
    }
    assert.equal(state.book.length, 0);
    assert.equal(state.plans[0].config.profiles[0].reserverName, testGuest(1).reserverName);
    assert.equal(state.lookupBook.length, 0);
    await page.locator('[data-workspace-tab="watch"]').click();
    assert.equal(await page.locator("#bookingProfileSelect1 option").count(), 1);
    await page.locator("#watchSelectAll").click();
    assert.equal(await page.locator("#roomList input:checked").count(), await page.locator("#roomList input").count());
    await page.locator("#watchDeselectAll").click();
    assert.equal(await page.locator("#roomList input:checked").count(), 0);
    const before = state.logsRead;
    await page.locator('[data-workspace-tab="logs"]').click();
    await page.waitForFunction(() => document.querySelector("#logList").textContent.includes("저장된 실행 로그"));
    assert.ok(state.logsRead > before);
    assert.equal(await page.locator("#logCard").isVisible(), true);
    assert.equal(await page.locator("#copyLogsButton").isVisible(), true);
    assert.equal(await page.locator("#saveLogsButton").isVisible(), true);
    assert.equal(await page.locator("#planCard").isVisible(), false);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#bookingProfileSelect1").options.length === 1);
    assert.equal(await page.locator("#reserverName").inputValue(), "");
    assert.deepEqual(state.errors, []);
    await page.close();
  }
});

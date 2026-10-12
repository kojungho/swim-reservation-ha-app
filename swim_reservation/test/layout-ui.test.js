import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";

const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("320·390·768·1280px의 모든 탭에서 입력과 버튼이 붙거나 넘치지 않고 짧은 입력·조회 도구를 compact하게 배치한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.clock.setFixedTime(new Date("2026-10-12T10:00:00+09:00"));
    const state = await mockBookApp(page);
    state.lookupBook = [{ reserverName: "가나다", phone: "01012345671" }, { reserverName: "라마바", phone: "01012345672" }];
    state.plans.push({ id: "00000000-0000-0000-0000-000000000001", name: "주말 감시", kind: "watch", intervalSeconds: 60, config: state.config, enabled: false, status: { state: "idle", message: "설정 완료" } });
    await page.route(/\/api\/monthly-availability(?:\?|$)/, async route => {
      const month = new URL(route.request().url()).searchParams.get("month");
      const [year, number] = month.split("-").map(Number);
      await route.fulfill({ json: { month, beforeOpen: false, opensAt: "2026-08-01T00:00:00", capturedAt: Date.now(), roomNames: ["해_하늘존"], days: Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, rooms: [{ name: "해_하늘존", status: "available" }] })) } });
    });
    await page.route(/\/api\/logs(?:\?|$)/, route => route.fulfill({ json: { entries: [{ timestamp: Date.now(), level: "error", message: `연결 오류: https://test.invalid/${"a".repeat(180)}` }] } }));
    await page.route(/\/api\/reservations(?:\?|$)/, route => route.fulfill({ json: { reservations: [{ id: "fake", room: "해_하늘존", profileLabel: "가나다", stayDate: "2026년12월20일", nights: "2박", total: "120,000원", status: "예약 완료", cancelable: true }], lookupErrors: [] } }));
    await page.waitForFunction(() => document.querySelector("#siteTimeMeta").textContent.includes("정상"));
    await page.evaluate(() => refreshPlans());
    await page.evaluate(() => showMessage(`연결 오류 안내: https://test.invalid/${"a".repeat(180)}`, true));
    async function checkLayout(tab) {
      const issues = await page.evaluate(() => {
        const problems = [];
        const name = document.querySelector("#planName").getBoundingClientRect();
        const register = document.querySelector("#addPlanButton").getBoundingClientRect();
        if (name.width && register.width && (Math.abs(name.bottom - register.bottom) > 1 || register.left <= name.right + 5)) problems.push("일정 이름과 등록 버튼은 같은 줄에 간격을 두고 배치");
        if (document.documentElement.scrollWidth > innerWidth + 1) problems.push("가로 넘침");
        const scope = document.querySelector("dialog:modal") || document;
        const visible = selector => [...scope.querySelectorAll(selector)].filter(el => {
          if (el.closest("details:not([open])") && !el.closest("summary")) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
        }).map(el => ({ rect: el.getBoundingClientRect(), label: el.id || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30) }));
        const buttons = visible("button:not(.info-button):not(.room-drag-handle):not(.monthly-day)");
        const inputs = visible("input:not([type=checkbox]),select");
        function spacing(first, second, min) {
          const a = first.rect, b = second.rect;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const gapX = a.left < b.left ? b.left - a.right : a.left - b.right;
          const gapY = a.top < b.top ? b.top - a.bottom : a.top - b.bottom;
          if (overlapY > 1 && gapX < min || overlapX > 1 && gapY < min) problems.push(`${first.label} / ${second.label}: 간격 부족`);
        }
        buttons.forEach((button, index) => {
          buttons.slice(index + 1).forEach(other => spacing(button, other, 5.5));
          inputs.forEach(input => spacing(button, input, 5.5));
        });
        for (const { rect, label } of [...buttons, ...inputs]) if (rect.left < -1 || rect.right > innerWidth + 1) problems.push(`${label}: 화면 밖`);
        return problems;
      });
      assert.deepEqual(issues, [], `${width}px ${tab}`);
    }
    for (const tab of ["priority", "multiple", "profiles-parallel", "watch", "book", "people", "monthly", "logs"]) {
      await page.locator(`[data-workspace-tab="${tab}"]`).click();
      if (tab === "profiles-parallel") { await page.locator("#addProfileButton").click(); await page.locator("#bookingProfileSelect2").selectOption("0"); }
      if (tab === "people") {
        await page.locator("#reservationList .reservation-row").waitFor();
        const sizes = await page.evaluate(() => {
          const first = document.querySelector("#lookupreserverName1").getBoundingClientRect();
          const phone = document.querySelector("#lookupphone1").getBoundingClientRect();
          const select = document.querySelector("#siteProfileSelect").getBoundingClientRect();
          const button = document.querySelector("#reservationSiteButton").getBoundingClientRect();
          return { paired: Math.abs(first.top - phone.top) < 1, selectWidth: select.width, aligned: Math.abs(select.bottom - button.bottom) < 1, panelHeight: document.querySelector(".lookup-profile-panel").getBoundingClientRect().height };
        });
        assert.equal(sizes.paired, true);
        assert.equal(sizes.aligned, true);
        assert.ok(sizes.selectWidth <= 220);
        assert.ok(sizes.panelHeight < 170);
        if ([390, 1280].includes(width)) await page.locator("#lookupCard").screenshot({ path: `/tmp/swim-profiles.6W9Acs/lookup-redesign-${width}.png` });
        await page.locator("#siteProfileSelect").selectOption("2");
        assert.equal(await page.locator("#siteProfileSelect").inputValue(), "2");
        await page.getByRole("button", { name: "조회 대상 2 삭제", exact: true }).click();
        await page.locator("#saveLookupProfilesButton").click();
        await page.waitForFunction(() => document.querySelector("#lookupMessage").textContent.includes("조회용 정보만 저장"));
        assert.deepEqual(state.lookupBook, [{ reserverName: "가나다", phone: "01012345671" }]);
      }
      if (tab === "monthly") {
        await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("조회 완료"));
        await page.locator(".monthly-prefetch summary").click();
      }
      if (tab === "logs") await page.waitForFunction(() => document.querySelector("#logList").textContent.includes("연결 오류"));
      await checkLayout(tab);
      if (tab === "priority" && [390, 1280].includes(width)) await page.locator("#planCard").screenshot({ path: `/tmp/swim-profiles.6W9Acs/plan-registration-${width}.png` });
    }
    await page.locator('[data-workspace-tab="priority"]').click();
    await page.locator("#reservationConnectionDetails").evaluate(el => { el.open = true; });
    await checkLayout("연결 정보 펼침");
    await page.locator("#bookingHelpButton").click();
    await checkLayout("사용 방법 창");
    await page.locator("#bookingHelpCloseButton").click();
    await page.locator("#siteMapButton").click();
    await checkLayout("안내 사진 창");
    assert.deepEqual(state.errors, []);
    assert.equal(state.writes.some(path => /cancel|\/start/.test(path)), false);
    await page.close();
  }
});

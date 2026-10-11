import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { defaultConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("PC·휴대폰 달력은 누락 날짜만 개별 조회하고 날짜 선택 시 매크로 화면으로 이동한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const queries = [], dayQueries = [], mutations = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://app.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      const pathname = url.pathname.replace("/ingress/test", "");
      if (pathname.startsWith("/api/")) {
        if (request.method() !== "GET" && pathname !== "/api/inspect") mutations.push(pathname);
        let data;
        if (pathname === "/api/monthly-availability") {
          const month = url.searchParams.get("month");
          queries.push(month);
          if (month === "2027-02") return route.fulfill({ status: 503, json: { error: "사이트 연결 실패" } });
          const provided = month === "2026-12";
          const [year, number] = month.split("-").map(Number);
          data = { month, opensAt: provided ? "2026-10-01T00:00:00" : "2026-11-01T00:00:00", beforeOpen: !provided, provided, capturedAt: Date.now(), roomNames: ["해_하늘존", "달_하늘존", "샘_산맥존"], message: provided ? "사이트 날짜별 표시" : "사이트가 이 달의 현황을 제공하지 않습니다.", days: Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, rooms: ["해_하늘존", "달_하늘존", "샘_산맥존"].map((name, room) => ({ name, status: provided ? ["available", "booked", "pending"][room] : "unknown" })) })) };
        } else if (pathname === "/api/calendar-day") {
          const date = url.searchParams.get("date");
          dayQueries.push(date);
          if (date === "2027-01-02") return route.fulfill({ status: 500, json: { error: "숙박 날짜 불일치" } });
          data = { date, rooms: [{ name: "해_하늘존", status: "available" }, { name: "달_하늘존", status: "booked" }, { name: "샘_산맥존", status: "unavailable" }], capturedAt: Date.now() };
        } else data = pathname === "/api/config" ? { ...defaultConfig(), startDate: "2026-12-11" }
          : pathname === "/api/status" ? { state: "idle", stage: "idle" }
          : { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
        return route.fulfill({ json: data });
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
    });
    await page.goto("https://app.test/ingress/test/");
    assert.equal(await page.locator("header .app-title-row #monthlyButton").count(), 1);
    assert.equal(await page.locator("#monthlyButton").count(), 1);
    assert.equal(await page.locator("header").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.deepEqual(queries, []);
    assert.deepEqual(dayQueries, []);
    await page.locator("#monthlyButton").click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("조회 완료"));
    assert.equal(await page.locator("#monthlyMonth").inputValue(), "2026-12");
    assert.equal(await page.locator("#monthlyContent tbody tr").count(), 5);
    assert.equal(await page.locator("#monthlyContent thead th").count(), 7);
    assert.equal(await page.locator("#monthlyContent .monthly-day").count(), 31);
    assert.equal(await page.locator("#monthlyContent tbody tr").first().locator("td").count(), 7);
    assert.equal(await page.locator("#monthlyContent .available").count(), 31);
    assert.equal(await page.locator("#monthlyContent .booked").count(), 31);
    assert.equal(await page.locator("#monthlyContent .pending").count(), 31);
    assert.equal(await page.locator("#monthlyDialog").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.deepEqual(await page.locator('[data-date="2026-12-01"] .monthly-room-name').allTextContents(), ["해", "달", "샘"]);
    assert.deepEqual(await page.locator('[data-date="2026-12-01"] .monthly-room-mark').allTextContents(), ["가", "완", "대"]);
    assert.match(await page.locator('[data-date="2026-12-01"] .monthly-room-row').last().getAttribute("title"), /샘_산맥존 · 예약 대기/);
    await page.evaluate(() => {
      const names = ["해", "달", "별", "빛", "강", "산", "들", "숲", "샘", "온", "숨", "꿈", "솔", "결"].map((name, index) => `${name}_${index < 8 ? "하늘존" : "산맥존"}`);
      renderMonthlyAvailability({ ...monthlyResult, roomNames: names, days: monthlyResult.days.map(day => ({ ...day, rooms: names.map((name, index) => ({ name, status: ["available", "booked", "pending", "unavailable", "unknown"][index % 5] })) })) });
    });
    assert.equal(await page.locator('[data-date="2026-12-01"] .monthly-room-row').count(), 14);
    assert.equal(await page.locator("#monthlyContent").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.doesNotMatch(await page.locator("#monthlyContent").innerText(), /하늘존|산맥존|가능 \d|완료 \d/);
    if (width === 390) await page.screenshot({ path: "/tmp/swim-profiles.6W9Acs/calendar-mobile-rooms.png" });
    assert.deepEqual(dayQueries, []);
    await page.locator('[data-date="2026-12-20"]').click();
    await page.waitForFunction(() => !document.querySelector("#monthlyDialog").open && document.activeElement.id === "startDate");
    assert.equal(await page.locator("#startDate").inputValue(), "2026-12-20");
    await page.locator("#monthlyButton").click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("조회 완료"));
    await page.locator("#monthlyNextButton").click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("조회 완료") && document.querySelector("#monthlyMonth").value === "2027-01");
    assert.equal(await page.locator("#monthlyMonth").inputValue(), "2027-01");
    assert.match(await page.locator("#monthlyStatus").innerText(), /예약 오픈 전/);
    assert.equal(dayQueries.length, 31);
    assert.equal(await page.locator("#monthlyContent .available").count(), 30);
    assert.equal(await page.locator("#monthlyContent .error").count(), 1);
    await page.locator("#monthlyNextButton").click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("조회 완료") && document.querySelector("#monthlyMonth").value === "2027-02");
    assert.equal(await page.locator("#monthlyContent .monthly-day").count(), 28);
    assert.equal(dayQueries.length, 59);
    await page.locator("#monthlyPrevButton").click();
    await page.locator("#monthlyContent table").waitFor();
    await page.locator("#monthlyCloseButton").click();
    const countAtClose = dayQueries.length;
    await page.waitForTimeout(100);
    assert.equal(dayQueries.length, countAtClose);
    assert.equal(await page.locator("#monthlyDialog").isVisible(), false);
    assert.equal(await page.locator("#startDate").inputValue(), "2026-12-20");
    assert.equal(await page.locator("#bookingMode").inputValue(), "priority");
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(queries, ["2026-12", "2026-12", "2027-01", "2027-02", "2027-01"]);
    await page.close();
  }
});

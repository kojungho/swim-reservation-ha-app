import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { defaultConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("PC·휴대폰 월 전체 조회는 오픈 전 상태·미제공을 구분하고 설정을 변경하지 않는다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const queries = [], mutations = [], errors = [];
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
        } else data = pathname === "/api/config" ? { ...defaultConfig(), startDate: "2026-12-11" }
          : pathname === "/api/status" ? { state: "idle", stage: "idle" }
          : { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
        return route.fulfill({ json: data });
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
    });
    await page.goto("https://app.test/ingress/test/");
    await page.locator("#monthlyButton").click();
    await page.locator("#monthlyContent table").waitFor();
    assert.equal(await page.locator("#monthlyMonth").inputValue(), "2026-12");
    assert.equal(await page.locator("#monthlyContent tbody tr").count(), 3);
    assert.equal(await page.locator("#monthlyContent tbody tr").first().locator("td").count(), 31);
    assert.equal(await page.locator("#monthlyContent .available").count(), 31);
    assert.equal(await page.locator("#monthlyContent .booked").count(), 31);
    assert.equal(await page.locator("#monthlyContent .pending").count(), 31);
    assert.equal(await page.locator("#monthlyDialog").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.locator("#monthlyNextButton").click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("2027-01 · 예약") && document.querySelector("#monthlyContent table"));
    assert.equal(await page.locator("#monthlyMonth").inputValue(), "2027-01");
    assert.match(await page.locator("#monthlyStatus").innerText(), /예약 오픈 전/);
    assert.equal(await page.locator("#monthlyContent .unknown").count(), 93);
    await page.locator("#monthlyNextButton").click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("월별 조회 실패"));
    assert.equal(await page.locator("#monthlyContent table").count(), 0);
    await page.locator("#monthlyPrevButton").click();
    await page.locator("#monthlyContent table").waitFor();
    await page.locator("#monthlyCloseButton").click();
    assert.equal(await page.locator("#monthlyDialog").isVisible(), false);
    assert.equal(await page.locator("#startDate").inputValue(), "2026-12-11");
    assert.equal(await page.locator("#bookingMode").inputValue(), "priority");
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(queries, ["2026-12", "2027-01", "2027-02", "2027-01"]);
    await page.close();
  }
});

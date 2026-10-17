import { chromium } from "playwright-core";
import { reservationCheckUrl } from "./reservation-check.js";
import { chromiumUserAgent } from "./reservation-engine.js";
import { readReservationRows, sameReservationStay } from "./reservation-records.js";

const NAVIGATION_TIMEOUT = 20_000;

export class ReservationManager {
  constructor({ executablePath = "/usr/bin/chromium" } = {}) {
    this.executablePath = executablePath;
  }

  async list(profile) {
    return this.withPage(async (page) => this.load(page, profile));
  }

  async cancel(profile, reservationId, expected = null) {
    return this.withPage(async (page) => {
      const reservations = await this.load(page, profile);
      const matches = reservations.filter((item) => item.id === String(reservationId));
      const target = matches.length === 1 ? matches[0] : null;
      if (!target?.cancelable) throw new Error("취소 가능한 예약을 찾지 못했습니다. 입금 완료 여부와 예약 정보를 확인해 주세요.");
      if (expected && !sameReservationStay(target, expected)) throw new Error("조회 후 예약 정보가 변경되었습니다. 다시 조회한 뒤 취소해 주세요.");
      await this.clickCancellation(page, reservationId);
      const remaining = await this.load(page, profile);
      if (remaining.some((item) => item.id === String(reservationId))) {
        throw new Error("사이트에서 예약 취소 완료를 확인하지 못했습니다. 예약 내역을 다시 확인해 주세요.");
      }
      return { canceled: target, reservations: remaining };
    });
  }

  async clickCancellation(page, reservationId) {
    // Mark only the action exposed by the freshly loaded site. Never guess a deletion URL.
    const count = await page.evaluate(id => {
      document.querySelectorAll("[data-swim-cancel-target]").forEach(element => element.removeAttribute("data-swim-cancel-target"));
      const actions = [...document.querySelectorAll("tr a,tr button,tr input[type=button],tr input[type=image]")].filter(element => {
        const action = `${element.getAttribute("href") || ""} ${element.getAttribute("onclick") || ""}`;
        const match = action.match(/\bdel_ok1\s*\(\s*['"]?(\d+)['"]?\s*[,)]/i);
        if (match) return match[1] === id;
        try {
          const url = new URL(element.getAttribute("href") || "", location.href);
          return url.origin === location.origin && /\/reservation\/order_del\d*\.php$/i.test(url.pathname) && url.searchParams.get("no") === id;
        } catch { return false; }
      });
      if (actions.length === 1) actions[0].setAttribute("data-swim-cancel-target", "true");
      return actions.length;
    }, String(reservationId));
    if (count !== 1) throw new Error("대상 예약의 취소 버튼을 정확히 찾지 못해 취소를 중단했습니다.");
    const handleDialog = async dialog => {
      if (dialog.type() === "confirm" && /취소/.test(dialog.message()) && !/전체|모든/.test(dialog.message())) await dialog.accept();
      else await dialog.dismiss();
    };
    page.on("dialog", handleDialog);
    try {
      const [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT }),
        page.locator('[data-swim-cancel-target="true"]').click()
      ]);
      if (!response || !response.ok()) throw new Error(`취소 요청 결과 확인 필요${response ? ` (HTTP ${response.status()})` : ""}. 재조회 후 확인해 주세요. 자동 재시도하지 않습니다.`);
    } finally {
      page.off("dialog", handleDialog);
    }
  }

  async load(page, profile) {
    const response = await page.goto(reservationCheckUrl(profile), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    if (response && !response.ok()) throw new Error(`예약확인 페이지 연결 실패 (응답 ${response.status()}). 0건으로 판단하지 않습니다.`);
    const recognized = await page.evaluate(() => Boolean(document.querySelector("table")) && /예약/.test(document.body?.innerText || ""));
    if (!recognized) throw new Error("정상적인 예약확인 페이지를 찾지 못했습니다. 조회 실패를 0건으로 판단하지 않습니다.");
    const rows = await page.evaluate(readReservationRows);
    if (!rows.length) {
      const emptyConfirmed = await page.evaluate(() => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ");
        return /예약[^.]{0,30}(없습니다|없음|존재하지)|조회[^.]{0,20}(0건|없습니다)/.test(text)
          || (/객실|사이트/.test(text) && /숙박|입실|이용일/.test(text) && /요금|금액|박수/.test(text));
      });
      if (!emptyConfirmed) throw new Error("예약 목록이나 정상적인 빈 목록을 확인하지 못했습니다. 취소 완료 또는 0건으로 판단하지 않습니다.");
    }
    return rows;
  }

  async withPage(action) {
    const browser = await chromium.launch({
      executablePath: this.executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=ko-KR"]
    });
    try {
      const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", userAgent: chromiumUserAgent(browser) });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      return await action(page);
    } finally {
      await browser.close();
    }
  }
}

export { readReservationRows as readReservationsFromPage } from "./reservation-records.js";

import { chromium } from "playwright-core";
import { reservationCheckUrl } from "./reservation-check.js";
import { chromiumUserAgent } from "./reservation-engine.js";
import { readReservationRows, sameReservationStay } from "./reservation-records.js";
import { reservationErrorDetails, safeReservationUrl } from "./reservation-errors.js";

const NAVIGATION_TIMEOUT = 20_000;

export class ReservationManager {
  constructor({ executablePath = "/usr/bin/chromium", log = async () => {} } = {}) {
    this.executablePath = executablePath;
    this.log = (...args) => Promise.resolve().then(() => log(...args)).catch(() => {});
  }

  async cancelStep(step, reservationId, action) {
    const startedAt = Date.now();
    await this.log("info", "cancel-step", `예약 취소 · ${step} 시작`, { reservationId: String(reservationId), step, outcome: "start" });
    try {
      const result = await action();
      await this.log("info", "cancel-step", `예약 취소 · ${step} 완료`, { reservationId: String(reservationId), step, outcome: "complete", elapsedMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const details = reservationErrorDetails(error);
      await this.log("error", "cancel-step", `예약 취소 · ${step} 실패: ${details.message}`, { reservationId: String(reservationId), step, outcome: "error", elapsedMs: Date.now() - startedAt, error: details });
      error.message = `예약 취소 · ${step}: ${details.message}`;
      throw error;
    }
  }

  async list(profile) {
    return this.withPage(async (page) => this.load(page, profile));
  }

  async cancel(profile, reservationId, expected = null) {
    return this.withPage(async (page) => {
      const reservations = await this.cancelStep("대상 재조회", reservationId, () => this.load(page, profile));
      const matches = reservations.filter((item) => item.id === String(reservationId));
      const target = matches.length === 1 ? matches[0] : null;
      await this.cancelStep("대상 대조", reservationId, async () => {
        if (!matches.length) throw new Error("재조회한 목록에 해당 예약 번호가 없습니다. 예약 조회를 새로 실행해 주세요.");
        if (matches.length > 1) throw new Error("같은 예약 번호가 여러 번 발견되어 중단했습니다.");
        if (!target?.cancelable) throw new Error("사이트에서 해당 예약의 취소 버튼을 제공하지 않습니다.");
        if (expected && !sameReservationStay(target, expected)) throw new Error("조회 후 예약 정보가 변경되었습니다. 다시 조회한 뒤 취소해 주세요.");
      });
      await this.cancelStep("원본 취소 버튼 실행", reservationId, () => this.clickCancellation(page, reservationId));
      const remaining = await this.cancelStep("취소 후 재조회·확인", reservationId, async () => {
        const rows = await this.load(page, profile);
        if (rows.some(item => item.id === String(reservationId))) throw new Error("사이트에서 예약 취소 완료를 확인하지 못했습니다. 다시 예약 조회해 주세요. 자동 재시도하지 않습니다.");
        return rows;
      });
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
    if (count !== 1) throw new Error(`대상 예약의 취소 버튼을 정확히 찾지 못했습니다 (${count}개). 취소 요청은 보내지 않았습니다.`);
    const handleDialog = async dialog => {
      const approved = dialog.type() === "confirm" && /취소/.test(dialog.message()) && !/전체|모든/.test(dialog.message());
      await this.log("info", "cancel-dialog", "예약 취소 · 확인창 처리", { reservationId: String(reservationId), dialogType: dialog.type(), approved });
      if (approved) await dialog.accept();
      else await dialog.dismiss();
    };
    page.on("dialog", handleDialog);
    try {
      const [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT }),
        page.locator('[data-swim-cancel-target="true"]').click()
      ]);
      await this.log(response?.ok() ? "info" : "error", "cancel-http", "예약 취소 · 사이트 응답", { reservationId: String(reservationId), httpStatus: response?.status() || null, url: safeReservationUrl(response?.url()) });
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

  async withPage(action, {signal} = {}) {
    const browser = await chromium.launch({
      executablePath: this.executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=ko-KR"]
    });
    const cancel=()=>{void browser.close().catch(()=>{});};
    try {
      signal?.addEventListener("abort",cancel,{once:true});signal?.throwIfAborted();
      const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", userAgent: chromiumUserAgent(browser) });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      return await action(page);
    } finally {
      signal?.removeEventListener("abort",cancel);await browser.close();
    }
  }
}

export { readReservationRows as readReservationsFromPage } from "./reservation-records.js";

import { chromium } from "playwright-core";
import { reservationCancelUrl, reservationCheckUrl } from "./reservation-check.js";

const NAVIGATION_TIMEOUT = 20_000;

export class ReservationManager {
  constructor({ executablePath = "/usr/bin/chromium" } = {}) {
    this.executablePath = executablePath;
  }

  async list(profile) {
    return this.withPage(async (page) => this.load(page, profile));
  }

  async cancel(profile, reservationId) {
    return this.withPage(async (page) => {
      const reservations = await this.load(page, profile);
      const target = reservations.find((item) => item.id === String(reservationId));
      if (!target?.cancelable) throw new Error("취소 가능한 예약을 찾지 못했습니다. 입금 완료 여부와 예약 정보를 확인해 주세요.");

      await page.goto(reservationCancelUrl(profile, reservationId), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
      const remaining = await this.load(page, profile);
      if (remaining.some((item) => item.id === String(reservationId))) {
        throw new Error("사이트에서 예약 취소 완료를 확인하지 못했습니다. 예약 내역을 다시 확인해 주세요.");
      }
      return { canceled: target, reservations: remaining };
    });
  }

  async load(page, profile) {
    await page.goto(reservationCheckUrl(profile), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    return page.evaluate(readReservationsFromPage);
  }

  async withPage(action) {
    const browser = await chromium.launch({
      executablePath: this.executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=ko-KR"]
    });
    try {
      const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      return await action(page);
    } finally {
      await browser.close();
    }
  }
}

export function readReservationsFromPage() {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  return [...document.querySelectorAll("tr")].map((row) => {
    const cells = [...row.cells].map((cell) => clean(cell.innerText));
    const dateIndex = cells.findIndex((cell) => /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/.test(cell));
    if (dateIndex < 1) return null;
    const cancelLink = [...row.querySelectorAll("a")].find((link) => /del_ok1/.test(`${link.getAttribute("href") || ""} ${link.getAttribute("onclick") || ""}`));
    const action = `${cancelLink?.getAttribute("href") || ""} ${cancelLink?.getAttribute("onclick") || ""}`;
    const id = action.match(/del_ok1\s*\(\s*['\"]?(\d+)/)?.[1] || null;
    return {
      id,
      room: cells[dateIndex - 1] || "—",
      stayDate: cells[dateIndex] || "—",
      nights: cells[dateIndex + 1] || "—",
      size: cells[dateIndex + 2] || "—",
      guests: cells[dateIndex + 3] || "—",
      fee: cells[dateIndex + 4] || "—",
      extraFee: cells[dateIndex + 5] || "—",
      total: cells[dateIndex + 6] || "—",
      status: clean((cells[dateIndex + 7] || "").replace(/취소하기/g, "")) || (id ? "예약대기 중" : "취소 불가"),
      cancelable: Boolean(id)
    };
  }).filter(Boolean);
}

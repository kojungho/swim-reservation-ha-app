import { chromium } from "playwright-core";
import { reservationUrl } from "./config.js";
import { fillPersonalFields } from "./personal-fields.js";
import { readPageDiagnostics } from "./page-diagnostics.js";

const NAVIGATION_TIMEOUT = 20_000;

export class ReservationEngine {
  constructor({ store, executablePath = "/usr/bin/chromium" }) {
    this.store = store;
    this.executablePath = executablePath;
    this.browser = null;
    this.page = null;
  }

  async prepare(config) {
    await this.ensurePage();
    await this.page.goto(reservationUrl(config.startDate), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
  }

  async inspect(config) {
    let temporary = false;
    if (!this.page) {
      temporary = true;
      await this.ensurePage();
    }
    try {
      await this.page.goto(reservationUrl(config.startDate), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
      return await this.readRooms(config.nights);
    } finally {
      if (temporary) await this.close();
    }
  }

  async run(config, { prepared = false } = {}) {
    try {
      await this.ensurePage();
      if (prepared) await this.page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
      else await this.page.goto(reservationUrl(config.startDate), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });

      const room = await this.selectRoom(config);
      await this.store.updateStatus({ stage: "room-selected", selectedRoom: room, message: `${room}, ${config.nights}박을 선택했습니다.` });
      await this.submitCurrentStep();

      for (let step = 0; step < 5; step += 1) {
        await this.page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT });
        const result = await this.detectPage();
        if (result === "success") {
          await this.store.updateStatus({ state: "success", stage: "complete", message: "사이트에서 예약 완료 화면을 확인했습니다." });
          return;
        }
        if (result === "personal") {
          await this.fillPersonalInfo(config);
          await this.store.updateStatus({ stage: "final-submit", message: "예약자 정보를 입력하고 최종 예약을 전송합니다." });
          await this.clickAction(["예약하기", "예약신청", "예약완료", "확인"], true);
          continue;
        }
        if (result === "terms") {
          await this.acceptTerms();
          await this.store.updateStatus({ stage: "terms-accepted", message: "환불·이용 규정에 동의했습니다." });
          await this.clickAction(["동의하고", "다음", "예약 진행", "예약하기"], true);
          continue;
        }
        throw new Error(`자동으로 판별하지 못한 예약 화면입니다: ${await this.page.title()}`);
      }
      throw new Error("예약 단계가 예상보다 많아 자동 실행을 중지했습니다.");
    } catch (error) {
      const diagnostics = error.diagnostics || await this.collectDiagnostics();
      await this.store.updateStatus({
        state: "failed",
        stage: "reservation-error",
        message: error.message || String(error),
        diagnostics
      });
      throw error;
    } finally {
      await this.close();
    }
  }

  async ensurePage() {
    if (this.page) return;
    this.browser = await chromium.launch({
      executablePath: this.executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=ko-KR"]
    });
    const context = await this.browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
    this.page = await context.newPage();
    this.page.setDefaultTimeout(10_000);
    this.page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  }

  async readRooms(nights) {
    return this.page.locator('input[type="checkbox"][name^="room_rid"]').evaluateAll((boxes, requestedNights) => boxes.map((box) => {
      const row = box.closest("tr");
      const index = Number((box.name.match(/\[(\d+)\]/) || [])[1]);
      const select = document.querySelector(`select[name="daytype[${index}]"]`);
      const name = (row?.querySelector("td:nth-child(2)")?.innerText || row?.innerText || "").trim().split(/\s+/)[0];
      return {
        name,
        available: Boolean(select && [...select.options].some((option) => option.value === String(requestedNights) && !option.disabled)),
        options: select ? [...select.options].map((option) => option.text.trim()) : []
      };
    }), nights);
  }

  async selectRoom(config) {
    const priorities = config.roomPriority.filter((room) => room.enabled);
    const selected = await this.page.evaluate(({ priorities: requested, nights }) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const rows = [...document.querySelectorAll('input[type="checkbox"][name^="room_rid"]')].map((checkbox) => {
        const row = checkbox.closest("tr");
        const index = Number((checkbox.name.match(/\[(\d+)\]/) || [])[1]);
        return { checkbox, row, index, text: clean(row?.innerText), select: document.querySelector(`select[name="daytype[${index}]"]`) };
      });
      for (const room of requested) {
        const candidate = rows.find((row) => row.text.includes(room.name));
        const option = candidate?.select ? [...candidate.select.options].find((item) => item.value === String(nights) && !item.disabled) : null;
        if (!candidate || !option || candidate.checkbox.disabled) continue;
        candidate.checkbox.checked = true;
        candidate.checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        candidate.select.value = String(nights);
        candidate.select.dispatchEvent(new Event("change", { bubbles: true }));
        return room.name;
      }
      return null;
    }, { priorities, nights: config.nights });
    if (!selected) throw new Error(`${config.nights}박으로 예약 가능한 우선순위 객실이 없습니다.`);
    return selected;
  }

  async submitCurrentStep() {
    const currentUrl = this.page.url();
    await Promise.all([
      this.page.waitForURL((url) => url.href !== currentUrl, { timeout: NAVIGATION_TIMEOUT }),
      this.page.locator('img[onclick*="click_go"], input[type="image"], input[type="submit"]').last().click()
    ]);
  }

  async detectPage() {
    return this.page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ");
      const exactPersonalFields = ["name", "name2", "tel1", "tel2", "tel3", "birthYear", "birthMonth", "birthDay"]
        .filter((name) => document.querySelector(`[name="${name}"]`)).length;
      if (exactPersonalFields >= 6) return "personal";
      const personal = /예약자(명| 이름)?/.test(text) && /(입금자|휴대폰|생년월일)/.test(text);
      if (/예약(이 | )?(완료|되었습니다)|예약번호/.test(text) && !personal) return "success";
      if (/환불|취소.*규정|이용.*약관/.test(text) || document.querySelector('input[type="checkbox"]')) return "terms";
      if (personal) return "personal";
      return "unknown";
    });
  }

  async acceptTerms() {
    await this.page.locator('input[type="checkbox"]:not(:disabled)').evaluateAll((boxes) => {
      for (const box of boxes) {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  async fillPersonalInfo(config) {
    const result = await this.page.evaluate(fillPersonalFields, config.profile);
    const missing = Object.entries(result.filled).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      const error = new Error(`예약자 입력란을 찾지 못했습니다: ${missing.join(", ")}. 아래의 진단 정보 복사 버튼을 눌러 내용을 보내주세요.`);
      error.diagnostics = await this.collectDiagnostics();
      throw error;
    }
  }

  async collectDiagnostics() {
    if (!this.page || this.page.isClosed()) return null;
    try {
      return await this.page.evaluate(readPageDiagnostics);
    } catch {
      return null;
    }
  }

  async clickAction(words, allowSubmitFallback) {
    const currentUrl = this.page.url();
    const action = this.page.locator('button, input[type="button"], input[type="submit"], input[type="image"], img[onclick], a[onclick]');
    const count = await action.count();
    let chosen = null;
    for (let index = 0; index < count; index += 1) {
      const item = action.nth(index);
      const label = await item.evaluate((element) => `${element.innerText || ""} ${element.value || ""} ${element.alt || ""} ${element.title || ""}`.replace(/\s+/g, " ").trim());
      if (words.some((word) => label.includes(word))) { chosen = item; break; }
    }
    if (!chosen && allowSubmitFallback) {
      const submits = this.page.locator('input[type="submit"], input[type="image"], button[type="submit"], img[onclick]');
      if (await submits.count()) chosen = submits.last();
    }
    if (!chosen) throw new Error(`다음 버튼을 찾지 못했습니다: ${words.join("/")}`);
    await Promise.all([
      this.page.waitForURL((url) => url.href !== currentUrl, { timeout: NAVIGATION_TIMEOUT }),
      chosen.click()
    ]);
  }

  async close() {
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }
}

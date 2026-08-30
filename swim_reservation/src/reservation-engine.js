import { chromium } from "playwright-core";
import { reservationUrl, startEpoch } from "./config.js";
import { fillPersonalFields } from "./personal-fields.js";
import { readPageDiagnostics } from "./page-diagnostics.js";

const NAVIGATION_TIMEOUT = 20_000;

export class ReservationEngine {
  constructor({ store, executablePath = "/usr/bin/chromium" }) {
    this.store = store;
    this.executablePath = executablePath;
    this.browser = null;
    this.page = null;
    this.selectedRoom = null;
    this.childSessions = [];
  }

  async prepare(config) {
    if (config.bookingMode === "multiple") return this.prepareMultiple(config);
    return this.prepareSingle(config);
  }

  async prepareSingle(config) {
    try {
      await this.ensurePage();
      await this.page.goto(reservationUrl(config.startDate), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
      await this.assertReservationDate(config, { required: true });
      const room = await this.selectRoom(config);
      this.selectedRoom = room;
      await this.store.updateStatus({ stage: "preparing-room", selectedRoom: room, message: `${room}, ${config.nights}박을 미리 선택했습니다.` });
      await this.submitCurrentStep();

      await this.page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT });
      await this.assertReservationDate(config, { required: true });
      if (await this.detectPage() !== "terms") throw new Error("환불 규정 페이지를 확인하지 못했습니다.");
      await this.acceptTerms();
      await this.clickAction(["동의하고", "다음", "예약 진행", "예약하기"], true);

      await this.page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT });
      await this.assertReservationDate(config, { required: true });
      if (await this.detectPage() !== "personal") throw new Error("예약자 정보 입력 페이지를 확인하지 못했습니다.");
      await this.fillPersonalInfo(config);
      await this.store.updateStatus({
        state: "waiting",
        stage: "final-ready",
        selectedRoom: room,
        message: "예약자 정보까지 입력했습니다. 지정 시각에 마지막 예약하기를 누릅니다."
      });
    } catch (error) {
      error.diagnostics ||= await this.collectDiagnostics();
      throw error;
    }
  }

  async inspect(config) {
    let temporary = false;
    if (!this.page) {
      temporary = true;
      await this.ensurePage();
    }
    try {
      await this.page.goto(reservationUrl(config.startDate), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
      await this.assertReservationDate(config, { required: true });
      return await this.readRooms(config.nights);
    } finally {
      if (temporary) await this.close();
    }
  }

  async run(config, options = {}) {
    if (config.bookingMode === "multiple") return this.runMultiple(config, options);
    return this.runSingle(config, options);
  }

  async runSingle(config, { prepared = false, allowFallback = true } = {}) {
    try {
      await this.ensurePage();
      const attemptedRooms = new Set();
      if (prepared) {
        await this.assertReservationDate(config, { required: true });
        if (await this.detectPage() !== "personal") throw new Error("미리 준비한 예약자 정보 페이지가 유지되지 않았습니다.");
        await this.fillPersonalInfo(config);
        await this.store.updateStatus({ stage: "final-submit", message: "지정 시각에 최종 예약하기를 전송합니다." });
        await this.clickAction(["예약하기", "예약신청", "예약완료", "확인"], true);
      } else {
        await this.startRoomAttempt(config, attemptedRooms);
      }

      for (let step = 0; step < 20; step += 1) {
        await this.page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT });
        await this.assertReservationDate(config);
        const result = await this.detectPage();
        if (result === "success") {
          await this.store.updateStatus({ state: "success", stage: "complete", message: "사이트에서 예약 완료 화면을 확인했습니다." });
          return;
        }
        if (result === "retryable") {
          if (!allowFallback) {
            const error = new Error(`${this.selectedRoom || "선택 객실"} 예약이 마감되었거나 다른 예약과 중복되었습니다.`);
            error.code = "ROOM_UNAVAILABLE";
            error.room = this.selectedRoom;
            throw error;
          }
          if (this.selectedRoom) attemptedRooms.add(this.selectedRoom);
          await this.store.updateStatus({
            stage: "retrying-next-room",
            attemptedRooms: [...attemptedRooms],
            message: `${this.selectedRoom || "선택 객실"} 예약이 마감되어 다음 우선순위 객실을 시도합니다.`
          });
          await this.startRoomAttempt(config, attemptedRooms);
          continue;
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
      throw new Error("객실 재시도를 포함한 예약 단계가 예상보다 많아 자동 실행을 중지했습니다.");
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

  async selectRoom(config, excludedRooms = []) {
    const priorities = config.roomPriority.filter((room) => room.enabled);
    const selected = await this.page.evaluate(({ priorities: requested, nights, excluded }) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const rows = [...document.querySelectorAll('input[type="checkbox"][name^="room_rid"]')].map((checkbox) => {
        const row = checkbox.closest("tr");
        const index = Number((checkbox.name.match(/\[(\d+)\]/) || [])[1]);
        return { checkbox, row, index, text: clean(row?.innerText), select: document.querySelector(`select[name="daytype[${index}]"]`) };
      });
      for (const room of requested) {
        if (excluded.includes(room.name)) continue;
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
    }, { priorities, nights: config.nights, excluded: [...excludedRooms] });
    if (!selected) {
      const error = new Error(`${config.nights}박으로 예약 가능한 우선순위 객실이 없습니다.`);
      error.code = "NO_AVAILABLE_ROOM";
      throw error;
    }
    return selected;
  }

  async startRoomAttempt(config, attemptedRooms) {
    await this.page.goto(reservationUrl(config.startDate), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    await this.assertReservationDate(config, { required: true });
    const room = await this.selectRoom(config, [...attemptedRooms]);
    this.selectedRoom = room;
    await this.store.updateStatus({
      stage: attemptedRooms.size ? "room-reselected" : "room-selected",
      selectedRoom: room,
      attemptedRooms: [...attemptedRooms],
      message: `${room}, ${config.nights}박을 선택했습니다.`
    });
    await this.submitCurrentStep();
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
      const finalResult = /order_ok3\.php$/i.test(location.pathname);
      if (finalResult && /(이미|동시).*예약|예약.*(불가|마감|실패|완료되지|취소)|객실.*(없습니다|마감)/.test(text)) return "retryable";
      if (/예약(이 | )?(완료|되었습니다)|예약번호/.test(text) && !personal) return "success";
      if (/환불|취소.*규정|이용.*약관/.test(text) || document.querySelector('input[type="checkbox"]')) return "terms";
      if (personal) return "personal";
      return "unknown";
    });
  }

  async assertReservationDate(config, { required = false } = {}) {
    const expected = String(Math.floor(startEpoch(config.startDate) / 1000));
    const found = await this.page.locator('input[name="adaystart"]').evaluateAll((inputs) => (
      [...new Set(inputs.map((input) => String(input.value || "")).filter(Boolean))]
    ));
    if (required && !found.length) {
      throw new Error(`숙박 날짜 확인값을 찾지 못해 예약을 중지했습니다: ${config.startDate}`);
    }
    if (found.length && !found.includes(expected)) {
      throw new Error(`사이트의 숙박 날짜가 선택한 날짜와 달라 예약을 중지했습니다: 선택 ${config.startDate} (${expected}), 사이트 ${found.join(", ")}`);
    }
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

  async prepareMultiple(config) {
    await this.close();
    const availability = await this.inspect({ ...config, bookingMode: "priority" });
    const selectedNames = config.roomPriority.filter((room) => room.enabled).map((room) => room.name);
    const availableNames = new Set(availability.filter((room) => room.available).map((room) => room.name));
    const unavailable = selectedNames.filter((name) => !availableNames.has(name));
    if (unavailable.length) throw new Error(`동시 예약 대상 중 ${config.nights}박 예약이 불가능한 객실: ${unavailable.join(", ")}`);

    this.childSessions = selectedNames.map((room) => this.createChildSession(config, room));
    try {
      await Promise.all(this.childSessions.map((session) => session.engine.prepareSingle(session.config)));
    } catch (error) {
      error.diagnostics ||= this.childSessions.find((session) => session.status.diagnostics)?.status.diagnostics || null;
      await this.close();
      throw error;
    }
    await this.store.updateStatus({
      state: "waiting",
      stage: "multiple-final-ready",
      selectedRoom: null,
      selectedRooms: selectedNames,
      message: `${selectedNames.length}개 객실의 예약자 정보 입력을 마쳤습니다. 지정 시각에 동시에 최종 제출합니다.`
    });
  }

  async runMultiple(config, { prepared = false } = {}) {
    if (!prepared || !this.childSessions.length) await this.prepareMultiple(config);
    const sessions = [...this.childSessions];
    await this.store.updateStatus({
      state: "running",
      stage: "multiple-final-submit",
      selectedRooms: sessions.map((session) => session.room),
      message: `${sessions.length}개 객실의 최종 예약하기를 동시에 전송합니다.`
    });
    const results = await Promise.allSettled(sessions.map((session) => (
      session.engine.runSingle(session.config, { prepared: true, allowFallback: false })
    )));
    const succeeded = results.flatMap((result, index) => result.status === "fulfilled" ? [sessions[index].room] : []);
    const failed = results.flatMap((result, index) => result.status === "rejected" ? [{ room: sessions[index].room, error: result.reason }] : []);
    this.childSessions = [];

    if (!failed.length) {
      await this.store.updateStatus({
        state: "success",
        stage: "multiple-complete",
        selectedRooms: succeeded,
        message: `${succeeded.length}개 객실의 예약 완료 화면을 모두 확인했습니다.`
      });
      return;
    }
    await this.store.updateStatus({
      state: "failed",
      stage: succeeded.length ? "multiple-partial" : "multiple-failed",
      selectedRooms: sessions.map((session) => session.room),
      succeededRooms: succeeded,
      failedRooms: failed.map(({ room }) => room),
      diagnostics: failed.find(({ error }) => error?.diagnostics)?.error.diagnostics || null,
      message: `동시 예약 결과: 성공 ${succeeded.length}개${succeeded.length ? ` (${succeeded.join(", ")})` : ""}, 실패 ${failed.length}개 (${failed.map(({ room }) => room).join(", ")}).`
    });
  }

  createChildSession(config, room) {
    const status = {};
    const scopedStore = {
      updateStatus: async (patch) => Object.assign(status, patch)
    };
    const childConfig = {
      ...config,
      bookingMode: "priority",
      roomPriority: config.roomPriority.map((item) => ({ ...item, enabled: item.name === room }))
    };
    return {
      room,
      status,
      config: childConfig,
      engine: new ReservationEngine({ store: scopedStore, executablePath: this.executablePath })
    };
  }

  async close() {
    const children = this.childSessions.splice(0);
    await Promise.all(children.map((session) => session.engine.close().catch(() => {})));
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
    this.page = null;
    this.selectedRoom = null;
  }
}

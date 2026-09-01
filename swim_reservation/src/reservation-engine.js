import { chromium } from "playwright-core";
import { reservationUrl, startEpoch } from "./config.js";
import { fillPersonalFields } from "./personal-fields.js";
import { readPageDiagnostics } from "./page-diagnostics.js";

const NAVIGATION_TIMEOUT = 20_000;

export class ReservationEngine {
  constructor({ store, executablePath = "/usr/bin/chromium", browserProvider = null }) {
    this.store = store;
    this.executablePath = executablePath;
    this.browserProvider = browserProvider;
    this.browser = null;
    this.browserPromise = null;
    this.ownsBrowser = false;
    this.context = null;
    this.page = null;
    this.selectedRoom = null;
    this.childSessions = [];
    this.prioritySessions = [];
  }

  async prepare(config) {
    if (config.bookingMode === "multiple") return this.prepareMultiple(config);
    return this.preparePriorityCandidates(config);
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
      if (temporary) {
        const keepPreparedBrowser = this.childSessions.length > 0 || this.prioritySessions.length > 0;
        await this.closeMainPage({ keepBrowser: keepPreparedBrowser });
      }
    }
  }

  async run(config, options = {}) {
    if (config.bookingMode === "multiple") return this.runMultiple(config, options);
    if (options.prepared && this.prioritySessions.length) return this.runPreparedProfiles(config);
    if (config.useSecondProfile) return this.runProfilesSequential(config);
    return this.runSingle(config, { ...options, prepared: Boolean(options.prepared && this.page) });
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
          return { room: this.selectedRoom };
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
        message: userErrorMessage(error),
        technicalMessage: error.message || String(error),
        diagnostics
      });
      throw error;
    } finally {
      await this.close();
    }
  }

  async ensurePage() {
    if (this.page) return;
    this.browser = this.browserProvider ? await this.browserProvider() : await this.ensureBrowser();
    this.context = await this.browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(10_000);
    this.page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  }

  async ensureBrowser() {
    if (this.browser) return this.browser;
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        executablePath: this.executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=ko-KR"]
      });
    }
    try {
      this.browser = await this.browserPromise;
      this.ownsBrowser = true;
      return this.browser;
    } finally {
      this.browserPromise = null;
    }
  }

  async readRooms(nights) {
    return this.page.locator('input[type="checkbox"][name^="room_rid"]').evaluateAll((boxes, requestedNights) => boxes.map((box) => {
      const row = box.closest("tr");
      const index = Number((box.name.match(/\[(\d+)\]/) || [])[1]);
      const select = document.querySelector(`select[name="daytype[${index}]"]`);
      const name = (row?.querySelector("td:nth-child(2)")?.innerText || row?.innerText || "").trim().split(/\s+/)[0];
      const nightsAvailable = Boolean(select && [...select.options].some((option) => option.value === String(requestedNights) && !option.disabled));
      return {
        name,
        available: !box.disabled && nightsAvailable,
        status: box.disabled ? "booked" : nightsAvailable ? "available" : "unavailable",
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
      const completionPage = /order_ok4\.php$/i.test(location.pathname);
      if (completionPage && (/예약취소/.test(text) || /입금계좌번호안내/.test(text))) return "success";
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

  async preparePriorityCandidates(config) {
    await this.close();
    const availability = await this.inspect({ ...config, bookingMode: "priority" });
    const availableNames = new Set(availability.filter((room) => room.available).map((room) => room.name));
    const selectedNames = config.roomPriority.filter((room) => room.enabled).map((room) => room.name);
    const profiles = activeProfiles(config);
    const prepared = [];
    const preparationErrors = [];

    for (const profileEntry of profiles) {
      for (const room of selectedNames) {
        if (!availableNames.has(room)) continue;
        const session = this.createPrioritySession(config, room, profileEntry);
        try {
          await session.engine.prepareSingle(session.config);
          prepared.push(session);
        } catch (error) {
          session.error = error;
          preparationErrors.push(error);
          await session.engine.close().catch(() => {});
        }
      }
      if (profileEntry.index === 0 && !prepared.some((session) => session.profileIndex === 0)) {
        this.prioritySessions = [];
        await this.store.updateStatus({
          state: "waiting",
          stage: "profiles-preparation-deferred",
          profileStatuses: profiles.map((entry) => ({ index: entry.index, label: entry.label, state: "예약 오픈 시 처음부터 진행" })),
          diagnostics: preparationErrors.find((item) => item?.diagnostics)?.diagnostics || null,
          message: "예약 오픈 전에 최종 제출 직전 단계까지 준비할 수 없어, 지정 시각에 최신 페이지로 처음부터 진행합니다."
        });
        return;
      }
    }

    this.prioritySessions = prepared;
    const profileStatuses = profiles.map((entry) => ({
      index: entry.index,
      label: entry.label,
      state: entry.index === 0 ? "준비 완료" : "예약자 1 완료 대기 중",
      preparedRooms: prepared.filter((session) => session.profileIndex === entry.index).map((session) => session.room)
    }));
    await this.store.updateStatus({
      state: "waiting",
      stage: "profiles-final-ready",
      selectedRooms: selectedNames,
      profileStatuses,
      message: `${profiles.length}명의 예약자와 우선순위 객실을 최종 제출 직전까지 준비했습니다.`
    });
  }

  async runPreparedProfiles(config) {
    const profiles = activeProfiles(config);
    const profileStatuses = profiles.map((entry) => ({
      index: entry.index, label: entry.label,
      state: entry.index === 0 ? "예약 진행 중" : "예약자 1 완료 대기 중"
    }));
    const completed = [];
    try {
      for (const profileEntry of profiles) {
        let sessions = this.prioritySessions
          .filter((session) => session.profileIndex === profileEntry.index)
          .sort((left, right) => left.rank - right.rank);
        if (!sessions.length) {
          const fallback = this.createPrioritySession(config, null, profileEntry);
          this.prioritySessions.push(fallback);
          sessions = [fallback];
        }
        profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "예약 진행 중" };
        await this.store.updateStatus({ state: "running", stage: "profile-running", profileStatuses, message: `${profileEntry.label} 예약을 시작합니다.` });
        let success = null;
        for (const session of sessions) {
          profileStatuses[profileEntry.index] = {
            ...profileStatuses[profileEntry.index], state: "예약 진행 중", room: session.room,
            message: `${session.rank}순위 객실 예약 진행 중`
          };
          await this.store.updateStatus({ profileStatuses, selectedRoom: session.room, message: `${profileEntry.label}: ${session.rank}순위 ${session.room} 예약 진행 중` });
          try {
            const result = await session.engine.runSingle(session.config, { prepared: Boolean(session.room), allowFallback: !session.room });
            success = { room: result?.room || session.room, rank: session.rank };
            break;
          } catch (error) {
            if (error.code !== "ROOM_UNAVAILABLE" && error.code !== "NO_AVAILABLE_ROOM") {
              const message = userErrorMessage(error);
              profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "결과 확인 필요", message };
              await this.store.updateStatus({ state: "failed", stage: "profile-uncertain", profileStatuses, message: `${profileEntry.label} 결과가 불확실하여 다음 예약을 중단했습니다: ${message}`, technicalMessage: error.message || String(error) });
              error.statusRecorded = true;
              throw error;
            }
            profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "다음 순위 시도 중" };
          }
        }
        if (!success) {
          profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "예약 실패", message: "모든 우선순위 실패" };
          await this.store.updateStatus({ state: "failed", stage: "profile-failed", profileStatuses, message: `${profileEntry.label}의 모든 우선순위 예약이 실패했습니다.` });
          const error = new Error(`${profileEntry.label} 예약 실패`);
          error.statusRecorded = true;
          throw error;
        }
        completed.push({ profileIndex: profileEntry.index, room: success.room });
        profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "예약 완료", room: success.room, message: `${success.rank}순위 성공` };
        if (profiles[profileEntry.index + 1]) {
          profileStatuses[profileEntry.index + 1] = { ...profileStatuses[profileEntry.index + 1], state: "예약 진행 준비" };
        }
        await this.store.updateStatus({ profileStatuses, succeededRooms: completed.map((item) => item.room), message: `${profileEntry.label} 예약 완료 화면을 확인했습니다.` });
      }
      await this.store.updateStatus({
        state: "success",
        stage: profiles.length > 1 ? "profiles-complete" : "complete",
        profileStatuses,
        succeededRooms: completed.map((item) => item.room),
        message: profiles.length > 1 ? "예약자 1과 예약자 2의 순차 예약을 모두 완료했습니다." : "사이트에서 예약 완료 화면을 확인했습니다."
      });
      return completed;
    } finally {
      await this.close();
    }
  }

  async runProfilesSequential(config) {
    const profiles = activeProfiles(config);
    this.prioritySessions = profiles.map((profileEntry) => this.createPrioritySession(config, null, profileEntry));
    for (const session of this.prioritySessions) session.rank = 1;
    return this.runUnpreparedProfiles(config);
  }

  async runUnpreparedProfiles(config) {
    const profiles = activeProfiles(config);
    const profileStatuses = profiles.map((entry) => ({ index: entry.index, label: entry.label, state: entry.index ? "예약자 1 완료 대기 중" : "예약 진행 중" }));
    const completed = [];
    try {
      for (const profileEntry of profiles) {
        const session = this.prioritySessions.find((item) => item.profileIndex === profileEntry.index);
        await this.store.updateStatus({ state: "running", stage: "profile-running", profileStatuses, message: `${profileEntry.label} 예약을 시작합니다.` });
        let result;
        try {
          result = await session.engine.runSingle(session.config, { prepared: false, allowFallback: true });
        } catch (error) {
          profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "예약 실패" };
          await this.store.updateStatus({ state: "failed", stage: "profile-failed", profileStatuses, message: `${profileEntry.label} 예약 실패: ${userErrorMessage(error)}`, technicalMessage: error.message || String(error) });
          error.statusRecorded = true;
          throw error;
        }
        completed.push({ profileIndex: profileEntry.index, room: result?.room || session.status.selectedRoom || "선택 객실" });
        profileStatuses[profileEntry.index] = { ...profileStatuses[profileEntry.index], state: "예약 완료", room: completed.at(-1).room };
        if (profiles[profileEntry.index + 1]) profileStatuses[profileEntry.index + 1] = { ...profileStatuses[profileEntry.index + 1], state: "예약 진행 중" };
        await this.store.updateStatus({ profileStatuses, succeededRooms: completed.map((item) => item.room), message: `${profileEntry.label} 예약 완료 화면을 확인했습니다.` });
      }
      await this.store.updateStatus({ state: "success", stage: "profiles-complete", profileStatuses, succeededRooms: completed.map((item) => item.room), message: "예약자 1과 예약자 2의 순차 예약을 모두 완료했습니다." });
      return completed;
    } finally {
      await this.close();
    }
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
      engine: new ReservationEngine({ store: scopedStore, executablePath: this.executablePath, browserProvider: () => this.ensureBrowser() })
    };
  }

  createPrioritySession(config, room, profileEntry) {
    const status = {};
    const enabledRooms = config.roomPriority.filter((item) => item.enabled);
    const rank = room ? enabledRooms.findIndex((item) => item.name === room) + 1 : 1;
    const scopedStore = { updateStatus: async (patch) => Object.assign(status, patch) };
    const childConfig = {
      ...config,
      useSecondProfile: false,
      profile: { ...profileEntry.profile },
      profile1: { ...profileEntry.profile },
      roomPriority: room ? config.roomPriority.map((item) => ({ ...item, enabled: item.name === room })) : config.roomPriority.map((item) => ({ ...item }))
    };
    return {
      room,
      rank,
      profileIndex: profileEntry.index,
      status,
      config: childConfig,
      engine: new ReservationEngine({ store: scopedStore, executablePath: this.executablePath, browserProvider: () => this.ensureBrowser() })
    };
  }

  async close() {
    const children = this.childSessions.splice(0);
    const priority = this.prioritySessions.splice(0);
    await Promise.all([...children, ...priority].map((session) => session.engine.close().catch(() => {})));
    await this.closeMainPage();
  }

  async closeMainPage({ keepBrowser = false } = {}) {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
    this.selectedRoom = null;
    if (keepBrowser) return;
    if (this.ownsBrowser && this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
    this.browserPromise = null;
    this.ownsBrowser = false;
  }
}

function activeProfiles(config) {
  const profiles = [
    { index: 0, label: "예약자 1", profile: config.profile1 || config.profile }
  ];
  if (config.useSecondProfile) profiles.push({ index: 1, label: "예약자 2", profile: config.profile2 });
  return profiles;
}

function userErrorMessage(error) {
  const message = error?.message || String(error);
  if (/Target page, context or browser has been closed|locator\.evaluateAll/i.test(message)) {
    return "예약 준비 브라우저 연결이 종료되어 결과 확인이 필요합니다. 예약확인 결과를 확인한 뒤 다시 실행해 주세요.";
  }
  return message;
}

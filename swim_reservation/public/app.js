const API = (path) => new URL(`api/${path}`, document.baseURI).href;
const elements = Object.fromEntries([
  "startDate", "triggerAt", "nights", "bookingMode", "epochValue", "openAtValue", "reservationUrl", "roomList", "roomSectionTitle", "roomSectionHelp", "reserverName",
  "depositorName", "phone", "birthDate", "extraProfiles", "addProfileButton", "saveProfilesButton", "siteProfileSelect", "profilePriorities", "profileModeHelp", "multipleProfileField", "multipleProfileSelect",
  "historyList", "statusBadge", "statusText", "statusDetails", "profileStatusList", "siteClock", "siteTimeMeta", "siteTimeSyncButton",
  "diagnosticsPanel", "diagnosticsPreview", "copyDiagnosticsButton", "siteMapButton", "siteMapDialog", "siteMapCloseButton",
  "siteMapUploadButton", "siteMapFile", "siteMapImage", "siteMapMessage",
  "inspectButton", "reservationSiteButton", "reservationLookupButton", "reservationList", "saveButton", "stopButton", "runNowButton",
  "logList", "refreshLogsButton", "copyLogsButton", "saveLogsButton", "bookingHelpButton", "bookingHelpDialog", "bookingHelpCloseButton", "bookingHelpCurrent",
  "monthlyDialog", "monthlyCloseButton", "monthlyPrevButton", "monthlyNextButton", "monthlyMonth", "monthlyQueryButton", "monthlyStatus", "monthlyContent", "monthlySourceLink", "monthlyDayDetails", "monthlyCacheInterval", "monthlyCacheSave", "monthlyCacheHelp", "monthlyCacheMessage"
].map((id) => [id, document.getElementById(id)]));

let rooms = [];
let extraProfiles = [];
let savedSecondProfile = {};
let firstProfilePriority = [];
let roomDrag = null;
let busy = false;
let currentState = "idle";
let currentStage = "idle";
let availabilityTimer = null;
let availabilityRequest = 0;
let availabilityController = null;
let siteTimeBase = null;
let autoLookupCompletedKey = "";
let autoLookupRunning = false;
let lastAutoLookupAttempt = 0;
let currentLogText = "";
let monthlyController = null;
let monthlyRequest = 0;
let monthlyResult = null;
let selectedMonthlyDate = null;
const availabilityByRoom = new Map();
const STATE_LABELS = {
  idle: "설정 중", waiting: "예약 대기", running: "자동 실행 중",
  success: "예약 완료", failed: "확인 필요", stopped: "중지됨"
};
const STAGE_LABELS = {
  idle: "초기 상태", armed: "예약 대기 설정됨", prewarming: "사전 준비 중",
  "preparing-room": "객실 사전 선택", "final-ready": "최종 제출 대기",
  "multiple-final-ready": "복수 객실 최종 제출 대기", starting: "예약 시작",
  "starting-now": "즉시 예약 시작", "room-selected": "객실 선택 완료",
  "room-reselected": "다음 객실 선택 완료", "terms-accepted": "환불 규정 동의 완료",
  "final-submit": "최종 예약 제출", "retrying-next-room": "다음 순위 객실 재시도",
  complete: "예약 완료", "multiple-final-submit": "복수 객실 동시 제출",
  "multiple-complete": "복수 객실 예약 완료", "multiple-partial": "복수 예약 일부 성공",
  "multiple-failed": "복수 예약 실패", "reservation-error": "예약 처리 오류",
  "profiles-final-ready": "예약자별 최종 제출 대기", "profile-running": "예약자별 순차 예약 진행",
  "profiles-preparation-deferred": "예약 오픈 시 새로 진행 대기",
  "profile-failed": "예약자 예약 실패", "profile-uncertain": "예약 결과 확인 필요", "profiles-complete": "예약자 순차 예약 완료",
  "profiles-parallel-running": "예약자 동시 예약 진행", "profiles-parallel-complete": "예약자 동시 예약 완료", "profiles-parallel-partial": "예약자 동시 예약 일부 확인 필요",
  exception: "실행 예외", missed: "실행 시각 경과", stopped: "실행 중지", inspected: "객실 확인 완료", expired: "감시 종료"
};
const AVAILABILITY_LABELS = {
  available: "예약 가능", booked: "예약 완료", unavailable: "해당 박수 불가",
  checking: "확인 중", "checking-before-open": "확인 중 (예약 오픈 전)",
  "available-before-open": "예약 가능 (예약 오픈 전)", "unavailable-before-open": "예약 불가 (예약 오픈 전)",
  "before-open": "확인 불가 (예약 오픈 전)", "before-open-no-data": "예약 오픈 전 - 서버에서 예약 가능 여부 미제공", unknown: "미확인"
};

init().catch((error) => showMessage(error.message, true));

async function init() {
  const config = await request("config");
  loadConfig({ ...config, profiles: [{}], profile2: {}, useSecondProfile: false, multipleProfileIndex: 0, editorProfileIndex: 0 });
  bindEvents();
  initializeWorkspace();
  initializeBookingBook();
  await loadBookingBook().catch(error => showMessage(`예약자 정보 조회 실패: ${error.message}`, true));
  await refreshHistory();
  await refreshStatus();
  await refreshLogs();
  await refreshSiteTime(false);
  scheduleAvailabilityCheck(0);
  setInterval(refreshStatus, 1500);
  setInterval(renderSiteClock, 250);
  setInterval(() => refreshSiteTime(false), 30_000);
  setInterval(() => {
    if (currentState === "waiting" && currentStage !== "prewarming") scheduleAvailabilityCheck(0);
  }, 60_000);
}

function bindEvents() {
  elements.monthlyQueryButton.addEventListener("click", () => void loadMonthlyAvailability(true));
  elements.monthlyCacheSave.addEventListener("click", async () => {
    elements.monthlyCacheSave.disabled = true;
    try {
      const settings = await request("month-cache", { method: "PUT", body: JSON.stringify({ intervalMinutes: Number(elements.monthlyCacheInterval.value) }) });
      elements.monthlyCacheMessage.textContent = `${settings.targetMonth} 현황: ${settings.intervalMinutes ? `${settings.intervalMinutes}분 간격으로 미리 조회합니다.` : "자동 조회를 껐습니다. 조회 버튼으로 갱신할 수 있습니다."}`;
    } catch (error) { elements.monthlyCacheMessage.textContent = error.message; }
    finally { elements.monthlyCacheSave.disabled = false; }
  });
  elements.monthlyPrevButton.addEventListener("click", () => changeMonthlyMonth(-1));
  elements.monthlyNextButton.addEventListener("click", () => changeMonthlyMonth(1));
  elements.monthlyCloseButton.addEventListener("click", () => switchWorkspaceTab(elements.bookingMode.value, { keepEditor: true }));
  elements.monthlyDialog.addEventListener("click", event => {
    if (event.target !== elements.monthlyDialog) return;
    const rect = elements.monthlyDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) elements.monthlyDialog.close();
  });
  elements.monthlyDialog.addEventListener("close", () => {
    monthlyController?.abort();
    monthlyRequest++;
    const target = selectedMonthlyDate ? elements.startDate : document.querySelector('[data-workspace-tab="monthly"]');
    if (selectedMonthlyDate) switchWorkspaceTab(elements.bookingMode.value, { keepEditor: true });
    target.focus({ preventScroll: true });
    if (selectedMonthlyDate) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  elements.bookingHelpButton.addEventListener("click", () => {
    const helpMode = workspaceTab === "watch" ? "watch" : elements.bookingMode.value;
    elements.bookingHelpCurrent.textContent = `예약 방식: ${helpMode === "watch" ? "취소 자리 감시" : elements.bookingMode.selectedOptions[0]?.textContent || ""}`;
    for (const section of elements.bookingHelpDialog.querySelectorAll("[data-booking-help]")) section.open = section.dataset.bookingHelp === helpMode;
    elements.bookingHelpDialog.showModal();
    elements.bookingHelpDialog.scrollTop = 0;
  });
  elements.bookingHelpCloseButton.addEventListener("click", () => elements.bookingHelpDialog.close());
  elements.bookingHelpDialog.addEventListener("click", event => {
    if (event.target !== elements.bookingHelpDialog) return;
    const rect = elements.bookingHelpDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) elements.bookingHelpDialog.close();
  });
  elements.bookingHelpDialog.addEventListener("close", () => elements.bookingHelpButton.focus({ preventScroll: true }));
  elements.startDate.addEventListener("change", () => {
    updateGeneratedValues();
    elements.triggerAt.value = bookingOpenIso(elements.startDate.value);
    updateImmediateBookingVisibility();
    scheduleAvailabilityCheck();
  });
  elements.triggerAt.addEventListener("input", updateImmediateBookingVisibility);
  elements.triggerAt.addEventListener("change", updateImmediateBookingVisibility);
  elements.nights.addEventListener("change", () => scheduleAvailabilityCheck());
  elements.bookingMode.addEventListener("change", () => {
    renderRooms();
    if (workspaceTab !== "watch") switchWorkspaceTab(elements.bookingMode.value, { keepEditor: true });
  });
  for (const id of ["reserverName", "depositorName", "phone", "birthDate"]) elements[id].addEventListener("input", refreshSiteProfileSelector);
  elements.saveProfilesButton.addEventListener("click", () => perform(async () => {
    await saveBookingActor(0);
  }));
  elements.addProfileButton.addEventListener("click", () => {
    if (extraProfiles.length >= 4) return;
    extraProfiles.push({});
    editorGeneration++;
    renderExtraProfiles();
    renderRooms();
  });
  elements.siteTimeSyncButton.addEventListener("click", () => perform(async () => refreshSiteTime(true)));
  elements.saveButton.addEventListener("click", () => perform(async () => {
    await saveConfig();
    showMessage("설정을 HA 미니 PC에 저장했습니다.");
  }));
  elements.runNowButton.addEventListener("click", () => perform(async () => {
    await refreshSiteTime(true);
    if (!updateImmediateBookingVisibility()) throw new Error("미래 시각 예약과 취소 자리 감시는 여러 일정 진행에서 등록한 뒤 시작하세요. 서버 시간도 확인해 주세요.");
    const date = elements.startDate.value;
    const selectedRooms = elements.bookingMode.value === "profiles-parallel" ? readConfig().profiles.map((profile, index) => `예약자 ${index + 1}: ${(profile.roomPriority || []).filter(room => room.enabled).map(room => room.name).join(" → ") || "선택 없음"}`) : rooms.filter((room) => room.enabled).map((room) => room.name);
    const multiple = elements.bookingMode.value === "multiple";
    const modeText = elements.bookingMode.value === "profiles-parallel" ? `예약자 ${extraProfiles.length + 1}명 동시 예약 · 각자 우선순위` : multiple ? `여러 객실 동시 예약 (${selectedRooms.length}개) · ${elements.multipleProfileSelect.selectedOptions[0]?.textContent}`
      : `1개 예약 · ${elements.multipleProfileSelect.selectedOptions[0]?.textContent || "선택한 한 명"} · 우선순위 방식`;
    const approved = window.confirm(
      `${date}부터 ${elements.nights.value}박 예약을 지금 즉시 실행합니다.\n\n예약 방식: ${modeText}\n예약 대상: ${selectedRooms.join(", ") || "선택 없음"}\n\n환불 규정 동의와 최종 예약하기까지 자동 진행됩니다. 실행할까요?`
    );
    if (!approved) return;
    await saveConfig();
    await registerPlan("now", true);
    await refreshStatus();
  }));
  elements.stopButton.addEventListener("click", () => perform(async () => {
    clearTimeout(availabilityTimer);
    availabilityController?.abort();
    availabilityRequest += 1;
    await request("stop", { method: "POST" });
    await request("plans/stop-all", { method: "POST" });
    await refreshPlans();
    await refreshStatus();
  }));
  elements.inspectButton.addEventListener("click", () => perform(async () => {
    showMessage("미니 PC에서 예약 페이지에 연결하고 있습니다.");
    await refreshAvailability();
    await refreshStatus();
  }));
  elements.reservationLookupButton.addEventListener("click", () => perform(() => loadReservations()));
  elements.refreshLogsButton.addEventListener("click", () => perform(() => refreshLogs()));
  elements.copyLogsButton.addEventListener("click", () => perform(() => copyLogs()));
  elements.saveLogsButton.addEventListener("click", () => perform(() => saveLogs()));
  elements.reservationSiteButton.addEventListener("click", () => openReservationSite());
  elements.copyDiagnosticsButton.addEventListener("click", () => copyDiagnostics());
  elements.siteMapButton.addEventListener("click", () => {
    elements.siteMapImage.src = `${API("site-map")}?v=${Date.now()}`;
    elements.siteMapDialog.showModal();
  });
  elements.siteMapUploadButton.addEventListener("click", () => elements.siteMapFile.click());
  elements.siteMapFile.addEventListener("change", uploadSiteMap);
  elements.siteMapCloseButton.addEventListener("click", () => elements.siteMapDialog.close());
  elements.siteMapDialog.addEventListener("click", (event) => {
    if (event.target === elements.siteMapDialog) elements.siteMapDialog.close();
  });
}

async function uploadSiteMap() {
  const file = elements.siteMapFile.files?.[0];
  if (!file) return;
  elements.siteMapUploadButton.disabled = true;
  elements.siteMapMessage.textContent = "사진을 등록하고 있습니다…";
  let bitmap;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error("30MB 이하 사진을 선택해 주세요.");
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error("이 사진 형식을 읽을 수 없습니다. JPG, PNG 또는 WebP로 저장한 사진을 선택해 주세요."); }
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob || blob.size > 12 * 1024 * 1024) throw new Error("사진 용량이 너무 큽니다. 더 작은 사진을 선택해 주세요.");
    await request("site-map", { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
    elements.siteMapImage.src = `${API("site-map")}?v=${Date.now()}`;
    elements.siteMapMessage.textContent = "사진을 등록했습니다. 앱을 재시작하거나 업데이트해도 유지됩니다.";
  } catch (error) {
    elements.siteMapMessage.textContent = `등록 실패: ${error.message}`;
  } finally {
    bitmap?.close();
    elements.siteMapFile.value = "";
    elements.siteMapUploadButton.disabled = false;
  }
}

function changeMonthlyMonth(delta) {
  if (!/^\d{4}-\d{2}$/.test(elements.monthlyMonth.value)) return;
  const [year, month] = elements.monthlyMonth.value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) return;
  elements.monthlyMonth.value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  void loadMonthlyAvailability();
}

async function loadMonthlyAvailability(force = false) {
  const month = elements.monthlyMonth.value;
  monthlyController?.abort();
  const id = ++monthlyRequest;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    elements.monthlyStatus.textContent = "조회할 월을 선택해 주세요.";
    elements.monthlyQueryButton.disabled = false;
    return;
  }
  const controller = new AbortController();
  monthlyController = controller;
  selectedMonthlyDate = null;
  elements.monthlyQueryButton.disabled = true;
  const [year, number] = month.split("-").map(Number);
  const roomNames = rooms.map(room => room.name);
  let result = { month, opensAt: bookingOpenIso(`${month}-01`), beforeOpen: isBeforeOpen(`${month}-01`), roomNames, capturedAt: Date.now(), progressText: "월별 페이지 조회 중…", days: Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, queryState: "queued", rooms: roomNames.map(name => ({ name, status: "unknown" })) })) };
  renderMonthlyAvailability(result);
  const sourceUrl = `https://newpension.logosweb.or.kr/reservation/reservation2.php?id=swim&year=${month.slice(0, 4)}&month=${Number(month.slice(5))}`;
  elements.monthlySourceLink.href = sourceUrl;
  try {
    let cache;
    try { cache = await request("month-cache", { signal: controller.signal }); } catch { /* Older servers retain the existing on-demand view. */ }
    if (controller.signal.aborted || id !== monthlyRequest) return;
    if (cache?.targetMonth) {
      elements.monthlyCacheInterval.value = String(cache.intervalMinutes);
      elements.monthlyCacheHelp.textContent = `${cache.targetMonth}만 서버에서 미리 조회해 저장합니다. 기본 1시간 간격이며 예약 준비·실행 중에는 쉽니다. 그 이후 달은 기존처럼 열었을 때 조회합니다.`;
    }
    if (cache?.targetMonth === month && (cache.result || cache.intervalMinutes || force)) {
      if (force || !cache.result && !cache.running && cache.intervalMinutes) cache = await request("month-cache/refresh", { method: "POST", signal: controller.signal });
      while (!controller.signal.aborted && id === monthlyRequest) {
        result = cache.result || result;
        const finished = cache.finishedAt ? new Date(cache.finishedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "아직 전체 조회가 완료되지 않았습니다";
        renderMonthlyAvailability({ ...result, capturedAt: cache.result?.capturedAt || 0, progressText: `${cache.running ? result.progressText || "미리 조회 진행 중" : cache.message || "저장된 현황"} · 전체 갱신 ${finished}`, message: "저장된 현황입니다. 조회 버튼을 누르면 즉시 재조회하며 완료까지 시간이 걸릴 수 있습니다." });
        if (!cache.running) return;
        await new Promise(resolve => { const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); }; const timer = setTimeout(done, 2000); controller.signal.addEventListener("abort", done, { once: true }); });
        if (controller.signal.aborted || id !== monthlyRequest) return;
        cache = await request("month-cache", { signal: controller.signal });
        if (cache.targetMonth !== month) return;
      }
      return;
    }
    if (month < seoulToday().slice(0, 7)) {
      result.days.forEach(day => { day.queryState = "past"; day.rooms = []; });
      result.progressText = "지난 날짜는 조회하지 않습니다.";
      renderMonthlyAvailability(result);
      return;
    }
    try {
      const fetched = await request(`monthly-availability?month=${encodeURIComponent(month)}`, { signal: controller.signal });
      if (id !== monthlyRequest) return;
      if (fetched.month !== month) throw new Error("요청한 달과 다른 현황을 받았습니다.");
      result = fetched;
    } catch (error) {
      if (controller.signal.aborted || id !== monthlyRequest) return;
      if (error.code === "INSPECTION_BUSY") throw error;
      result.message = `월별 페이지 조회 실패: ${error.message}. 개별 날짜 링크로 확인합니다.`;
    }
    const today = seoulToday();
    const pending = result.days.filter(day => day.date >= today && (!day.rooms.length || day.rooms.some(room => room.status === "unknown")));
    for (const day of result.days) {
      day.queryState = day.date < today ? "past" : pending.includes(day) ? "queued" : "done";
      if (day.queryState === "past") day.rooms = [];
    }
    let completed = 0, failed = 0;
    result.progressText = pending.length ? `개별 날짜 확인 0/${pending.length}일` : "전체 현황 확인 완료";
    renderMonthlyAvailability(result);
    for (const day of pending) {
      if (controller.signal.aborted || id !== monthlyRequest || !elements.monthlyDialog.open) return;
      if (day.date < seoulToday()) { day.queryState = "past"; day.rooms = []; continue; }
      day.queryState = "checking";
      result.progressText = `개별 날짜 확인 ${completed}/${pending.length}일 · ${day.date} 조회 중`;
      renderMonthlyAvailability(result);
      try {
        const found = await request(`calendar-day?date=${encodeURIComponent(day.date)}`, { signal: controller.signal });
        if (controller.signal.aborted || id !== monthlyRequest) return;
        if (found.date !== day.date) throw new Error("다른 날짜의 현황이 반환되어 반영하지 않았습니다.");
        if (!found.rooms?.length) throw new Error("개별 날짜의 객실 현황이 없습니다.");
        for (const room of found.rooms) {
          const existing = day.rooms.find(item => item.name === room.name);
          if (!existing) day.rooms.push({ ...room });
          else if (existing.status === "unknown") existing.status = room.status;
          if (!result.roomNames.includes(room.name)) result.roomNames.push(room.name);
        }
        day.queryState = day.rooms.some(room => room.status === "unknown") ? "partial" : "done";
        day.sourceUrl = found.sourceUrl;
        day.capturedAt = found.capturedAt;
        if (day.queryState === "partial") day.error = "일부 객실은 개별 날짜 페이지에서도 확인할 수 없습니다.";
      } catch (error) {
        if (controller.signal.aborted || id !== monthlyRequest) return;
        if (error.code === "INSPECTION_BUSY") throw error;
        day.queryState = "error";
        day.error = error.message;
        failed++;
      }
      completed++;
      result.progressText = `개별 날짜 확인 ${completed}/${pending.length}일${failed ? ` · 조회 실패 ${failed}일` : ""}`;
      result.capturedAt = Date.now();
      renderMonthlyAvailability(result);
    }
    result.progressText = `조회 완료${pending.length ? ` · 개별 링크 ${completed}일 확인${failed ? ` · 조회 실패 ${failed}일` : ""}` : ""}`;
    result.message = "날짜별 현황은 조회 시점의 정보이며 연속 박수 예약이나 실제 예약 성공을 보장하지 않습니다.";
    renderMonthlyAvailability(result);
  } catch (error) {
    if (controller.signal.aborted || id !== monthlyRequest) return;
    result.progressText = `조회 중단: ${error.message}`;
    renderMonthlyAvailability(result);
  } finally {
    if (id === monthlyRequest) elements.monthlyQueryButton.disabled = false;
  }
}

function renderMonthlyAvailability(result) {
  const today = seoulToday();
  monthlyResult = result;
  const opened = result.beforeOpen ? "예약 오픈 전" : "예약 오픈 일시 경과";
  const opening = result.opensAt ? new Date(`${result.opensAt}+09:00`).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "미확인";
  const captured = new Date(result.capturedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  const captureLabel = result.month < today.slice(0, 7) ? "사이트 조회 안 함" : result.capturedAt ? `최근 확인 ${captured}` : "현황 확인 대기";
  elements.monthlyStatus.textContent = `${result.month} · ${opened} · 예약 오픈 ${opening} · ${result.progressText || ""} · ${captureLabel}. ${result.message || ""}`;
  const days = result.days || [];
  const table = document.createElement("table");
  table.className = "monthly-calendar";
  const caption = document.createElement("caption");
  caption.textContent = `${result.month} 전체 객실 날짜별 예약 현황${result.beforeOpen ? " (예약 오픈 전)" : ""}`;
  const head = document.createElement("thead");
  const header = document.createElement("tr");
  for (const name of ["일", "월", "화", "수", "목", "금", "토"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = name;
    header.append(th);
  }
  head.append(header);
  const body = document.createElement("tbody");
  const [year, month] = result.month.split("-").map(Number);
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells = [...Array(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  for (let index = 0; index < cells.length; index += 7) {
    const row = document.createElement("tr");
    for (const day of cells.slice(index, index + 7)) {
      const td = document.createElement("td");
      if (day) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `monthly-day${day.date === selectedMonthlyDate ? " selected" : ""}`;
        button.dataset.date = day.date;
        const past = day.date < today;
        button.disabled = past;
        button.classList.toggle("past", past);
        button.setAttribute("aria-label", past ? `${day.date} 지난 날짜 · 조회 제외` : `${day.date} 선택 후 예약 매크로 화면으로 이동`);
        const labels = { available: ["가", "예약 가능"], booked: ["완", "예약 완료"], pending: ["대", "예약 대기"], unavailable: ["불", "1박 불가"], unknown: ["?", "확인 불가"] };
        const badges = (past ? [] : day.rooms).map(room => {
          const status = labels[room.status] ? room.status : "unknown";
          const [mark, label] = labels[status];
          const name = String(room.name).split("_")[0].trim() || room.name;
          return `<span class="monthly-room-row" title="${escapeHtml(`${room.name} · ${label}`)}"><span class="monthly-room-mark ${status}" aria-label="${label}">${mark}</span><span class="monthly-room-name">${escapeHtml(name)}</span></span>`;
        }).join("");
        const states = { queued: "대기 중", checking: "조회 중", error: "조회 실패", partial: "일부 확인 불가", done: "확인됨" };
        button.innerHTML = `<span class="monthly-day-number">${Number(day.date.slice(-2))}</span><span class="monthly-day-rooms">${past ? '<span class="monthly-cell unknown">지난 날짜</span>' : badges || '<span class="monthly-cell unknown">미확인</span>'}</span><span class="monthly-day-state ${past ? "past" : day.queryState || "done"}">${past ? "조회 제외" : states[day.queryState] || "확인됨"}</span>`;
        button.addEventListener("click", () => {
          if (day.date < seoulToday()) return;
          selectedMonthlyDate = day.date;
          elements.startDate.value = day.date;
          elements.startDate.dispatchEvent(new Event("change", { bubbles: true }));
          elements.monthlyDialog.close();
        });
        td.append(button);
      }
      row.append(td);
    }
    body.append(row);
  }
  table.append(caption, head, body);
  elements.monthlyContent.replaceChildren(table);
  renderMonthlyDayDetails();
}

function renderMonthlyDayDetails() {
  elements.monthlyDayDetails.textContent = "날짜를 누르면 숙박 시작 날짜에 반영하고 달력을 닫아 예약 매크로 화면으로 이동합니다. 클릭만으로 예약이 실행되지는 않습니다.";
}

function loadConfig(config) {
  editorGeneration++;
  roomDrag?.cancel?.();
  elements.startDate.value = config.startDate || "";
  elements.triggerAt.value = (config.triggerAt || "").slice(0, 19);
  elements.nights.value = String(config.nights || 1);
  elements.bookingMode.value = ["multiple", "profiles-parallel"].includes(config.bookingMode) ? config.bookingMode : "priority";
  let profiles = config.profiles || [config.profile1 || config.profile || {}, ...(config.useSecondProfile ? [config.profile2 || {}] : [])];
  if (elements.bookingMode.value !== "profiles-parallel" && profiles.length > 1) profiles = [profiles[config.multipleProfileIndex || 0] || profiles[0]];
  const profile1 = profiles[0] || {};
  firstProfilePriority = profile1.roomPriority || [];
  savedSecondProfile = config.profile2 || {};
  elements.reserverName.value = profile1.reserverName || "";
  elements.depositorName.value = profile1.depositorName || "";
  elements.phone.value = profile1.phone || "";
  elements.birthDate.value = profile1.birthDate || "";
  extraProfiles = profiles.slice(1, 5).map(profile => ({ ...profile }));
  renderExtraProfiles();
  elements.multipleProfileSelect.value = "0";
  rooms = Array.isArray(config.roomPriority) ? config.roomPriority : [];
  renderRooms();
  updateBookingProfileVisibility();
  updateGeneratedValues();
}

function readConfig() {
  const profile1 = {
    reserverName: elements.reserverName.value.trim(),
    depositorName: elements.depositorName.value.trim(),
    phone: elements.phone.value.replace(/\D/g, ""),
    birthDate: elements.birthDate.value.replace(/\D/g, ""),
    roomPriority: firstProfilePriority
  };
  return {
    startDate: elements.startDate.value,
    triggerAt: elements.triggerAt.value,
    nights: Number(elements.nights.value),
    bookingMode: elements.bookingMode.value,
    multipleProfileIndex: Number(elements.multipleProfileSelect.value || 0),
    editorProfileIndex: Number(elements.multipleProfileSelect.value || 0),
    roomPriority: rooms,
    profile: profile1,
    profile1,
    profiles: [profile1, ...extraProfiles.map(profile => ({ ...profile }))],
    profile2: extraProfiles[0] || savedSecondProfile,
    useSecondProfile: extraProfiles.length > 0,
    autoFinalSubmit: true
  };
}

function renderExtraProfiles() {
  elements.extraProfiles.replaceChildren();
  extraProfiles.forEach((profile, index) => {
    const panel = document.createElement("div");
    panel.className = "second-profile-panel";
    panel.innerHTML = '<h3>예약자 ' + (index + 2) + '</h3><div class="grid two identity-fields"></div><div class="section-actions profile-panel-actions"><button type="button" class="secondary">이 일정에서 제외</button></div>';
    for (const [key, label] of [["reserverName", "예약자명"], ["depositorName", "입금자명"], ["phone", "휴대폰 번호"], ["birthDate", "생년월일"]]) {
      const field = document.createElement("label");
      field.textContent = label;
      const input = document.createElement("input");
      input.id = key + (index + 2);
      input.value = profile[key] || "";
      input.autocomplete = "off";
      if (key === "phone" || key === "birthDate") input.inputMode = "numeric";
      if (key === "birthDate") { input.maxLength = 8; input.placeholder = "YYYYMMDD"; }
      input.addEventListener("input", () => { profile[key] = input.value; refreshSiteProfileSelector(); });
      field.append(input);
      panel.querySelector(".grid").append(field);
    }
    panel.querySelector("button").addEventListener("click", () => {
      if (!window.confirm("예약자 " + (index + 2) + "를 현재 입력 중인 일정에서 제외할까요? 저장된 예약자 정보와 등록 일정은 유지됩니다.")) return;
      extraProfiles.splice(index, 1);
      editorGeneration++;
      savedSecondProfile = {};
      renderExtraProfiles();
      renderRooms();
    });
    mountExtraBookingSelector(panel, index + 1);
    elements.extraProfiles.append(panel);
  });
  elements.addProfileButton.disabled = extraProfiles.length >= 4;
  elements.addProfileButton.textContent = extraProfiles.length >= 4 ? "최대 5명" : "+ 예약자 추가";
  elements.addProfileButton.title = extraProfiles.length >= 4 ? "예약자는 최대 5명까지 진행할 수 있습니다." : "이 일정에 사용할 예약자 입력란 추가";
  refreshSiteProfileSelector();
}

function refreshSiteProfileSelector() {
  const multipleSelected = elements.multipleProfileSelect.value;
  elements.multipleProfileSelect.replaceChildren(...readConfig().profiles.map((profile, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `예약자 ${index + 1}${profile.reserverName ? ` · ${profile.reserverName}` : ""}`;
    return option;
  }));
  elements.multipleProfileSelect.value = Number(multipleSelected) <= extraProfiles.length ? multipleSelected || "0" : "0";
  if (workspaceTab === "watch") refreshWatchProfileSelector();
  updateBookingProfileVisibility();
  renderBookingProfileSelectors();
}

function renderProfilePriorities() {
  const parallel = elements.bookingMode.value === "profiles-parallel";
  const multiple = elements.bookingMode.value === "multiple";
  elements.multipleProfileField.hidden = parallel || workspaceTab === "watch";
  elements.profilePriorities.hidden = !parallel;
  updateBookingProfileVisibility();
  elements.profilePriorities.replaceChildren();
  if (!parallel) return;
  const profiles = readConfig().profiles;
  profiles.forEach((profile, profileIndex) => {
    const priority = profileIndex ? (extraProfiles[profileIndex - 1].roomPriority ||= []) : firstProfilePriority;
    if (!priority.length) priority.push(...rooms.map(room => ({ name: room.name, enabled: room.enabled })));
    for (const room of rooms) if (!priority.some(item => item.name === room.name)) priority.push({ name: room.name, enabled: false });
    const panel = document.createElement("div");
    panel.className = "second-profile-panel";
    const title = document.createElement("h3");
    title.textContent = `예약자 ${profileIndex + 1}${profile.reserverName ? ` · ${profile.reserverName}` : ""} 객실 우선순위`;
    panel.append(title);
    const list = document.createElement("div");
    list.className = "room-list";
    list.dataset.profileIndex = String(profileIndex);
    let rank = 0;
    priority.forEach((room, index) => {
      if (room.enabled) rank++;
      const row = document.createElement("div");
      row.className = `room-row${room.enabled ? " enabled" : ""}`;
      const availability = availabilityByRoom.get(room.name) || "unknown";
      row.innerHTML = `<label class="room-toggle"><input type="checkbox" ${room.enabled ? "checked" : ""} aria-label="예약자 ${profileIndex + 1} ${escapeHtml(room.name)} 선택"></label><div class="room-name"><span class="room-rank">${room.enabled ? `${rank}순위` : "—"}</span>${escapeHtml(room.name)}<span class="availability ${availability}">${AVAILABILITY_LABELS[availability]}</span></div><button class="room-drag-handle" type="button" aria-label="예약자 ${profileIndex + 1} ${escapeHtml(room.name)} 순서 이동"><span class="drag-bars" aria-hidden="true"></span></button>`;
      row.querySelector("input").addEventListener("change", event => { room.enabled = event.target.checked; renderProfilePriorities(); });
      const handle = row.querySelector("button");
      handle.addEventListener("pointerdown", event => startRoomDrag(event, row, index, list, priority, renderProfilePriorities));
      handle.addEventListener("keydown", event => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const target = index + (event.key === "ArrowUp" ? -1 : 1);
        if (target < 0 || target >= priority.length) return;
        priority.splice(target, 0, ...priority.splice(index, 1));
        editorGeneration++;
        renderProfilePriorities();
        elements.profilePriorities.querySelector(`[data-profile-index="${profileIndex}"]`).children[target].querySelector("button").focus();
      });
      list.append(row);
    });
    panel.append(list);
    elements.profilePriorities.append(panel);
  });
}

async function saveConfig() {
  const result = await request("config", { method: "PUT", body: JSON.stringify(readConfig()) });
  loadConfig(result.config);
  await refreshHistory();
}

async function refreshHistory() {
  const result = await request("history");
  renderHistory(result.entries || []);
}

function renderHistory(entries) {
  elements.historyList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "아직 저장된 예약 설정이 없습니다.";
    elements.historyList.append(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "history-row";
    const savedAt = new Date(entry.savedAt).toLocaleString("ko-KR");
    const multiple = entry.bookingMode === "multiple";
    const roomsText = entry.enabledRooms?.length ? entry.enabledRooms.join(multiple ? " + " : " → ") : "선택된 객실 없음";
    const roomSummary = entry.bookingMode === "profiles-parallel"
      ? entry.profilePriorities?.length ? entry.profilePriorities.map(profile => {
        const label = `예약자 ${profile.index + 1}${profile.reserverName ? ` · ${profile.reserverName}` : ""}`;
        const priority = profile.enabledRooms?.length ? profile.enabledRooms.map((name, index) => `${index + 1}순위 ${name}`).join(" → ") : "선택된 객실 없음";
        return `<div class="history-profile-priority"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(priority)}</span></div>`;
      }).join("") : "예약자별 우선순위 정보를 확인할 수 없습니다. 설정을 불러와 확인해 주세요."
      : `${multiple && entry.multipleProfileName ? `<strong>예약자 · ${escapeHtml(entry.multipleProfileName)}</strong><br>` : ""}${escapeHtml(roomsText)}`;
    row.innerHTML = `
      <div class="history-key"><strong>${escapeHtml(entry.startDate)} · ${entry.nights}박</strong><small>${entry.bookingMode === "profiles-parallel" ? `예약자 ${entry.profileCount || 1}명 동시 우선순위 예약` : multiple ? `동시 ${entry.enabledRooms.length}개 예약` : (entry.profileCount || (entry.useSecondProfile ? 2 : 1)) > 1 ? `예약자 ${entry.profileCount || 2}명 순차 예약` : "1개 우선순위 예약"} · ${escapeHtml(savedAt)} 저장</small></div>
      <div class="history-rooms">${roomSummary}</div>
      <div class="history-actions"><button class="load" type="button">불러오기</button><button class="delete" type="button">삭제</button></div>`;
    row.querySelector(".load").addEventListener("click", () => perform(async () => {
      const result = await request(`history/${encodeURIComponent(entry.id)}/load`, { method: "POST" });
      availabilityByRoom.clear();
      loadConfig(result.config);
      await refreshAvailability();
      showMessage(`${entry.startDate} · ${entry.nights}박 설정과 객실 정보를 불러왔습니다.`);
    }));
    row.querySelector(".delete").addEventListener("click", () => perform(async () => {
      const approved = window.confirm(`${entry.startDate} · ${entry.nights}박 저장 이력을 삭제할까요?\n\n현재 화면에 불러온 설정은 삭제되지 않습니다.`);
      if (!approved) return;
      await request(`history/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      await refreshHistory();
      showMessage("저장 이력을 삭제했습니다.");
    }));
    elements.historyList.append(row);
  }
}

function renderRooms() {
  if (roomDrag) return;
  if (workspaceTab === "watch") { renderWatchRooms(); return; }
  const parallel = elements.bookingMode.value === "profiles-parallel";
  renderProfilePriorities();
  const multiple = elements.bookingMode.value === "multiple";
  elements.roomSectionTitle.textContent = parallel ? "예약자별 객실 우선순위" : multiple ? "동시 예약할 객실" : "객실 우선순위";
  elements.roomList.hidden = parallel;
  document.getElementById("roomDragHelp").hidden = parallel || multiple;
  elements.roomSectionHelp.textContent = parallel ? "위에서 입력한 각 예약자의 객실을 체크하고 손잡이로 순위를 정하세요. 한 사람당 객실 하나를 동시에 예약합니다." : multiple
    ? "체크한 객실(최대 5개)을 각각 별도 예약으로 준비하고 같은 시각에 최종 제출합니다."
    : "체크된 객실 중 위에 있는 객실부터 하나가 성공할 때까지 시도합니다.";
  elements.roomList.replaceChildren();
  let rank = 0;
  rooms.forEach((room, index) => {
    if (room.enabled) rank += 1;
    const row = document.createElement("div");
    row.className = `room-row${room.enabled ? " enabled" : ""}`;
    const availability = availabilityByRoom.get(room.name);
    const availabilityLabel = AVAILABILITY_LABELS[availability] || AVAILABILITY_LABELS.unknown;
    row.innerHTML = `
      <label class="room-toggle"><input type="checkbox" ${room.enabled ? "checked" : ""} aria-label="${escapeHtml(room.name)} 선택"></label>
      <div class="room-name">${multiple ? "" : `<span class="room-rank">${room.enabled ? `${rank}순위` : "—"}</span>`}${escapeHtml(room.name)}${room.newlyDetected ? '<span class="room-detected">신규 자동 추가</span>' : ""}<span class="availability ${availability || "unknown"}">${availabilityLabel}</span></div>
      ${multiple ? "" : `<button class="room-drag-handle" type="button" aria-label="${escapeHtml(room.name)} 순서 이동" title="누른 채 드래그하여 이동 · 키보드 위아래 방향키" aria-describedby="roomDragHelp"><span class="drag-bars" aria-hidden="true"></span></button>`}`;
    row.querySelector("input").addEventListener("change", (event) => { room.enabled = event.target.checked; renderRooms(); });
    const handle = row.querySelector(".room-drag-handle");
    handle?.addEventListener("pointerdown", event => startRoomDrag(event, row, index));
    handle?.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key) || roomDrag) return;
      event.preventDefault();
      moveRoom(index, event.key === "ArrowUp" ? -1 : 1);
    });
    elements.roomList.append(row);
  });
}

function moveRoom(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= rooms.length) return;
  [rooms[index], rooms[target]] = [rooms[target], rooms[index]];
  editorGeneration++;
  renderRooms();
  elements.roomList.children[target]?.querySelector(".room-drag-handle").focus({ preventScroll: true });
  document.getElementById("roomDragStatus").textContent = `${rooms[target].name}, ${target + 1}번째로 이동했습니다. 설정 저장을 눌러 주세요.`;
}

function startRoomDrag(event, row, index, list = elements.roomList, items = rooms, render = renderRooms) {
  if (roomDrag || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  let y = event.clientY, moved = false, target = index, frame;
  const initialY = y;
  roomDrag = { index };
  handle.setPointerCapture(pointerId);
  row.classList.add("dragging");
  const rows = [...list.children];
  const mark = () => {
    rows.forEach(item => item.classList.remove("drop-before", "drop-after"));
    const boundary = rows.findIndex(item => {
      const rect = item.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    const insertion = boundary < 0 ? rows.length : boundary;
    target = insertion > index ? insertion - 1 : insertion;
    if (target !== index) {
      if (insertion === rows.length) rows.at(-1).classList.add("drop-after");
      else rows[insertion].classList.add("drop-before");
    }
  };
  const scroll = () => {
    if (moved) {
      const edge = 70;
      const delta = y < edge ? -12 : y > window.innerHeight - edge ? 12 : 0;
      if (delta) window.scrollBy(0, delta);
      mark();
    }
    frame = requestAnimationFrame(scroll);
  };
  const move = e => {
    if (e.pointerId !== pointerId) return;
    y = e.clientY;
    moved ||= Math.abs(y - initialY) > 5;
    if (moved) mark();
  };
  const finish = (commit) => {
    cancelAnimationFrame(frame);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    handle.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("keydown", escape);
    window.removeEventListener("blur", cancel);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    const changed = commit && moved && target !== index;
    if (changed) { items.splice(target, 0, ...items.splice(index, 1)); editorGeneration++; }
    roomDrag = null;
    const profileIndex = list.dataset.profileIndex;
    render();
    const position = changed ? target : index;
    const currentList = profileIndex === undefined ? elements.roomList : elements.profilePriorities.querySelector(`[data-profile-index="${profileIndex}"]`);
    currentList?.children[position]?.querySelector(".room-drag-handle").focus({ preventScroll: true });
    if (changed) document.getElementById("roomDragStatus").textContent = `${items[position].name}, ${position + 1}번째로 이동했습니다. 설정 저장을 눌러 주세요.`;
  };
  const up = e => { if (e.pointerId === pointerId) finish(true); };
  const cancel = () => finish(false);
  roomDrag.cancel = cancel;
  const escape = e => { if (e.key === "Escape") finish(false); };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  window.addEventListener("keydown", escape);
  window.addEventListener("blur", cancel);
  frame = requestAnimationFrame(scroll);
}

function updateGeneratedValues() {
  updateImmediateBookingVisibility();
  updateWatchDeadlineHint();
  const date = elements.startDate.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    elements.epochValue.textContent = "—";
    elements.openAtValue.textContent = "—";
    elements.reservationUrl.value = "";
    return;
  }
  const epoch = Math.floor(Date.parse(`${date}T00:00:00+09:00`) / 1000);
  elements.epochValue.textContent = String(epoch);
  elements.openAtValue.textContent = formatOpeningTime(date);
  elements.reservationUrl.value = `https://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim&adaystart=${epoch}`;
}

function bookingOpenIso(startDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 3, 1));
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01T00:00:00`;
}

function bookingOpenEpoch(startDate) {
  return Date.parse(`${bookingOpenIso(startDate)}+09:00`);
}

function isBeforeOpen(startDate) {
  const opensAt = bookingOpenEpoch(startDate);
  const siteNow = currentSiteTime();
  return Number.isFinite(opensAt) && opensAt > (Number.isFinite(siteNow) ? siteNow : Date.now());
}

function formatOpeningTime(startDate) {
  const opensAt = bookingOpenEpoch(startDate);
  if (!Number.isFinite(opensAt)) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(new Date(opensAt));
}

async function openReservationSite() {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  try {
    const profile = lookupProfilesDraft[Number(elements.siteProfileSelect.value) - 1];
    const result = await request("reservation-check-url", { method: "POST", body: JSON.stringify({ profile }) });
    if (popup) popup.location.replace(result.url);
    else window.location.href = result.url;
  } catch (error) {
    popup?.close();
    showMessage(`예약확인 사이트 이동 실패: ${error.message}`, true);
  }
}

async function refreshSiteTime(force) {
  try {
    const status = await request(force ? "site-time/sync" : "site-time", force ? { method: "POST" } : {});
    if (!status.synced) throw new Error(status.error || "동기화 실패");
    siteTimeBase = { serverNowMs: status.serverNowMs, receivedAt: performance.now() };
    const offsetSeconds = Math.round(status.offsetMs / 1000);
    const offsetText = `${offsetSeconds >= 0 ? "+" : ""}${offsetSeconds}초`;
    const syncedAt = new Date(status.lastSyncedAt).toLocaleTimeString("ko-KR", { hour12: false });
    elements.siteTimeMeta.textContent = `마지막 동기화 ${syncedAt} · 시간 차이 ${offsetText} · RTT ${Math.round(status.rttMs)}ms · ${status.stale ? "재동기화 필요" : "정상 (초 단위)"}`;
    renderSiteClock();
  } catch (error) {
    siteTimeBase = null;
    elements.siteClock.textContent = "서버 시간 동기화 실패";
    elements.siteTimeMeta.textContent = error.message;
  }
}

function currentSiteTime() {
  return siteTimeBase ? siteTimeBase.serverNowMs + performance.now() - siteTimeBase.receivedAt : NaN;
}

function updateImmediateBookingVisibility() {
  const now = currentSiteTime();
  const trigger = Date.parse(`${elements.triggerAt.value}+09:00`);
  const opening = Date.parse(`${bookingOpenIso(elements.startDate.value)}+09:00`);
  const allowed = !editingPlan && ["priority", "multiple", "profiles-parallel"].includes(workspaceTab) &&
    Number.isFinite(now) && Number.isFinite(trigger) && Number.isFinite(opening) && trigger <= now && opening <= now;
  elements.runNowButton.hidden = !allowed;
  return allowed;
}

function renderSiteClock() {
  updateImmediateBookingVisibility();
  const now = currentSiteTime();
  if (!Number.isFinite(now)) return;
  elements.siteClock.textContent = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(new Date(now));
}

async function refreshStatus() {
  try {
    const status = await request("status");
    renderStatus(status);
    void maybeAutoLookupReservations(status);
  } catch (error) {
    if (!busy) showMessage(`상태 확인 실패: ${error.message}`, true);
  }
}

async function maybeAutoLookupReservations(status) {
  if (!["success", "failed"].includes(status.state) || autoLookupRunning) return;
  const key = `${status.state}:${status.stage}:${status.updatedAt}`;
  if (key === autoLookupCompletedKey || Date.now() - lastAutoLookupAttempt < 5_000) return;
  lastAutoLookupAttempt = Date.now();
  autoLookupRunning = true;
  try {
    const result = await loadReservations();
    if (!result.lookupErrors?.length) autoLookupCompletedKey = key;
    await refreshLogs();
  } catch (error) {
    elements.reservationList.hidden = false;
    elements.reservationList.innerHTML = `<strong>예약확인</strong><p>자동 예약확인 실패: ${escapeHtml(error.message)}</p>`;
  } finally {
    autoLookupRunning = false;
  }
}

async function loadReservations() {
  const result = await request("reservations");
  renderReservations(result.reservations || []);
  if (result.lookupStatuses?.length === 0 && !result.reservations?.length && !result.lookupErrors?.length) {
    elements.reservationList.textContent = "저장된 조회 대상이 없습니다. 예약자명과 휴대폰 번호를 조회용으로 저장하세요.";
  }
  if (result.lookupErrors?.length) {
    const warning = document.createElement("p");
    warning.className = "error";
    warning.textContent = result.lookupErrors.map(item => `${item.profileLabel}: ${item.message}`).join(" · ");
    elements.reservationList.prepend(warning);
    if (!result.reservations?.length) elements.reservationList.querySelector(".reservation-empty")?.remove();
  }
  if (result.lookupStatuses?.length) {
    const summary = document.createElement("p");
    summary.textContent = result.lookupStatuses.map(item => `${item.profileLabel}: ${item.error ? "조회 실패" : `${item.count}건`}`).join(" · ");
    elements.reservationList.prepend(summary);
  }
  return result;
}

function renderStatus(status) {
  const state = status.state || "idle";
  currentState = state;
  currentStage = status.stage || "idle";
  elements.statusBadge.className = `badge ${state}`;
  elements.statusBadge.textContent = STATE_LABELS[state] || state;
  renderPlanBadge();
  elements.statusText.textContent = status.message || "상태 정보가 없습니다.";
  elements.statusText.hidden = state === "idle";
  elements.statusDetails.hidden = state === "idle";
  const details = [];
  if (status.startDate) details.push(["숙박 시작 날짜", status.startDate]);
  if (status.prepareAt) details.push(["브라우저 준비 시각", new Date(status.prepareAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })]);
  if (status.targetAt) details.push(["예약 요청 시작 시각", new Date(status.targetAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })]);
  if (status.selectedRoom) details.push(["선택된 객실", status.selectedRoom]);
  if (status.selectedRooms?.length) details.push(["동시 예약 대상", status.selectedRooms.join(" · ")]);
  if (status.succeededRooms?.length) details.push(["예약 성공 객실", status.succeededRooms.join(" · ")]);
  if (status.failedRooms?.length) details.push(["예약 실패 객실", status.failedRooms.join(" · ")]);
  if (status.stage) details.push(["진행 단계", STAGE_LABELS[status.stage] || status.stage]);
  if (status.updatedAt) details.push(["최근 갱신", new Date(status.updatedAt).toLocaleString("ko-KR")]);
  elements.statusDetails.replaceChildren(...details.flatMap(([term, value]) => {
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd"); dd.textContent = value;
    return [dt, dd];
  }));
  renderProfileStatuses(status.profileStatuses || []);
  const diagnosticText = status.diagnostics ? JSON.stringify(status.diagnostics, null, 2) : "";
  elements.diagnosticsPanel.hidden = !diagnosticText;
  elements.diagnosticsPreview.textContent = diagnosticText;
}

function renderProfileStatuses(statuses) {
  elements.profileStatusList.hidden = !statuses.length;
  elements.profileStatusList.replaceChildren(...statuses.map((status) => {
    const row = document.createElement("div");
    row.className = "profile-status-row";
    row.innerHTML = `<strong>${escapeHtml(status.label || `예약자 ${Number(status.index) + 1}`)}</strong><span>${escapeHtml(status.message || status.state || "대기")}${status.room ? ` · ${escapeHtml(status.room)}` : ""}</span>`;
    return row;
  }));
}

async function copyDiagnostics() {
  const text = elements.diagnosticsPreview.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(elements.diagnosticsPreview);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    selection.removeAllRanges();
  }
  showMessage("진단 정보를 복사했습니다. 이 대화에 그대로 붙여 넣어 주세요.");
}

function renderInspection(result, { beforeOpen = false, addedRooms = [] } = {}) {
  const existingNames = new Set(rooms.map((room) => room.name));
  for (const found of result) {
    const name = String(found?.name || "").trim();
    if (!name || existingNames.has(name)) continue;
    existingNames.add(name);
    rooms.push({ name, enabled: false, newlyDetected: true });
  }
  const addedSet = new Set(addedRooms);
  for (const room of rooms) if (addedSet.has(room.name)) room.newlyDetected = true;
  const returned = new Map(result.map((room) => [room.name, room]));
  const source = beforeOpen ? rooms.map((configured) => returned.get(configured.name) || { name: configured.name, serverProvided: false }) : result;
  const displayed = source.map((room) => ({
    ...room,
    displayStatus: beforeOpen
      ? room.serverProvided === false ? "before-open-no-data" : room.available ? "available-before-open" : "unavailable-before-open"
      : room.status || (room.available ? "available" : "unavailable")
  }));
  for (const room of displayed) availabilityByRoom.set(room.name, room.displayStatus);
  renderRooms();
}

function renderReservations(reservations) {
  elements.reservationList.hidden = false;
  elements.reservationList.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "예약 확인 및 취소";
  elements.reservationList.append(heading);
  if (!reservations.length) {
    const empty = document.createElement("p");
    empty.className = "reservation-empty";
    empty.textContent = "예약 내역이 없습니다. 저장된 예약자명과 휴대폰 번호가 실제 예약 정보와 같은지 확인해 주세요.";
    elements.reservationList.append(empty);
    return;
  }
  for (const reservation of reservations) {
    const row = document.createElement("div");
    row.className = "reservation-row";
    row.innerHTML = `
      <div><strong>${escapeHtml(reservation.profileLabel ? `${reservation.profileLabel} · ${reservation.room}` : reservation.room)}</strong><span>${escapeHtml(reservation.stayDate)} · ${escapeHtml(reservation.nights)}</span></div>
      <div><span>결제 금액</span><strong>${escapeHtml(reservation.total)}</strong></div>
      <div><span>예약 상태</span><strong>${escapeHtml(reservation.status)}</strong></div>
      ${reservation.cancelable ? '<button type="button" class="reservation-cancel-button danger">예약 취소</button>' : '<span class="cancel-disabled">사이트에서 취소 불가</span>'}`;
    const cancelButton = row.querySelector(".reservation-cancel-button");
    cancelButton?.addEventListener("click", () => perform(async () => {
      const approved = window.confirm(
        `${reservation.room}\n${reservation.stayDate} · ${reservation.nights}\n결제 금액 ${reservation.total}\n\n이 예약을 실제로 취소할까요? 취소한 예약은 자동으로 복구할 수 없습니다.`
      );
      if (!approved) return;
      const result = await request(`reservations/${encodeURIComponent(reservation.id)}/cancel`, {
        method: "POST", body: JSON.stringify({ confirmed: true, profileIndex: reservation.profileIndex || 0 })
      });
      await loadReservations();
      showMessage(`${reservation.room} 예약 취소가 완료되었습니다.`, false, "예약 취소 완료");
    }));
    elements.reservationList.append(row);
  }
}

function scheduleAvailabilityCheck(delay = 500) {
  availabilityController?.abort();
  availabilityRequest += 1;
  clearTimeout(availabilityTimer);
  availabilityTimer = setTimeout(() => refreshAvailability(), delay);
}

async function refreshAvailability() {
  availabilityController?.abort();
  const controller = new AbortController();
  availabilityController = controller;
  const startDate = elements.startDate.value;
  const nights = Number(elements.nights.value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(nights)) return;
  const requestId = ++availabilityRequest;
  availabilityByRoom.clear();
  const beforeOpen = isBeforeOpen(startDate);
  if (currentState === "running") {
    if (beforeOpen) for (const room of rooms) availabilityByRoom.set(room.name, "before-open");
    renderRooms();
    return;
  }
  for (const room of rooms) availabilityByRoom.set(room.name, beforeOpen ? "checking-before-open" : "checking");
  renderRooms();
  try {
    const result = await request("inspect", { method: "POST", signal: controller.signal, body: JSON.stringify({ startDate, nights }) });
    if (requestId !== availabilityRequest) return;
    renderInspection(result.rooms || [], { beforeOpen, addedRooms: result.addedRooms || [] });
  } catch (error) {
    if (controller.signal.aborted || ["INSPECTION_CANCELED", "INSPECTION_BUSY"].includes(error.code)) return;
    if (requestId !== availabilityRequest) return;
    availabilityByRoom.clear();
    if (beforeOpen) for (const room of rooms) availabilityByRoom.set(room.name, "before-open");
    renderRooms();
    showMessage(`객실 가능 여부 확인 실패: ${error.message}`, true);
  }
}

async function perform(action) {
  if (busy) return;
  busy = true;
  setButtonsDisabled(true);
  try {
    await action();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    busy = false;
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  for (const button of [elements.inspectButton, elements.reservationSiteButton, elements.reservationLookupButton, elements.siteTimeSyncButton, elements.saveButton, elements.stopButton, elements.runNowButton, elements.refreshLogsButton, elements.copyLogsButton, elements.saveLogsButton]) button.disabled = disabled;
  renderBookingProfileSelectors();
  for (const button of elements.reservationList.querySelectorAll("button")) button.disabled = disabled;
}

async function refreshLogs() {
  const result = await request("logs?limit=300");
  const entries = result.entries || [];
  currentLogText = entries.slice().reverse().map(formatLogEntry).join("\n");
  elements.logList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "저장된 실행 로그가 없습니다.";
    elements.logList.append(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `log-row ${entry.level || "info"}`;
    const time = new Date(entry.timestamp).toLocaleString("ko-KR");
    row.innerHTML = `<time>${escapeHtml(time)}</time><strong>${entry.level === "error" ? "오류" : "정보"}</strong><span>${escapeHtml(entry.message || entry.event || "")}</span>`;
    elements.logList.append(row);
  }
}

function formatLogEntry(entry) {
  const time = new Date(entry.timestamp).toLocaleString("ko-KR");
  const details = entry.details && Object.keys(entry.details).length ? ` | ${JSON.stringify(entry.details)}` : "";
  return `[${time}] [${entry.level === "error" ? "오류" : "정보"}] ${entry.message || entry.event || ""}${details}`;
}

async function copyLogs() {
  if (!currentLogText) await refreshLogs();
  const text = currentLogText || "저장된 실행 로그가 없습니다.";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showMessage("실행 로그를 복사했습니다.");
}

async function saveLogs() {
  const response = await fetch(API("logs/download"));
  if (!response.ok) throw new Error(`로그 파일 저장 실패 (${response.status})`);
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  link.download = `swim-reservation-log-${day}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  showMessage("실행 로그 파일을 저장했습니다.");
}

function showMessage(message, error = false, successLabel = "저장 완료") {
  document.getElementById("workspaceMessage").textContent = message;
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = error ? "확인 필요" : successLabel;
  elements.statusBadge.className = `badge ${error ? "failed" : "success"}`;
}

async function request(path, options = {}) {
  const response = await fetch(API(path), { headers: { "Content-Type": "application/json" }, ...options });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || `요청 실패 (${response.status})`), { code: value.code });
  return value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

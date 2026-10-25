const API = (path) => new URL(`api/${path}`, document.baseURI).href;
const CLIENT_VERSION = "2.15.0";
let serverVersion = null;
// Display-only: keep full site room identifiers in requests, saved data and raw diagnostics.
function shortRoomText(value) { return String(value ?? "").replace(/[_\s-]*(?:하늘존|산맥존)/g, "").replace(/(\d+)순위/g, (_, rank) => rankSymbol(Number(rank))); }
function rankSymbol(rank) { return Number.isInteger(rank) && rank >= 1 && rank <= 20 ? String.fromCodePoint(0x2460 + rank - 1) : `(${rank})`; }
function roomSummaryText(names = [], ranked = true, separator = ranked ? " → " : ", ") {
  return names.map((name, index) => `${ranked ? `${rankSymbol(index + 1)} ` : ""}${shortRoomText(name)}`).join(separator);
}
function bookingGuestLimit() { return Math.max(1, new Set(rooms.map(room => room.name)).size); }
function updateGuestAddButton() {
  const limit = bookingGuestLimit(), full = extraProfiles.length + 1 >= limit;
  elements.addProfileButton.disabled = full;
  elements.addProfileButton.textContent = full ? `최대 ${limit}명` : "+ 예약자 추가";
  elements.addProfileButton.title = `객실 수 기준 최대 ${limit}명까지 추가할 수 있습니다.`;
}
function applyGuestColor(element, index) {
  element.dataset.guestColor = String(index);
  if (index >= 5) {
    const hue = Math.round(index * 137.5) % 360;
    element.style.backgroundColor = `hsl(${hue} 55% 95%)`;
    element.style.borderColor = `hsl(${hue} 35% 76%)`;
  }
}
function canSelectRoom(name) { return availabilityContext === `${elements.startDate.value}/${Number(elements.nights.value)}` && ["available", "available-before-open", "before-open-no-data"].includes(availabilityByRoom.get(name)); }
function setRoomSelection(items, enabled) {
  items.forEach(room => { if (!enabled || canSelectRoom(room.name) || workspaceTab === "watch") room.enabled = enabled; });
  editorGeneration++;
  renderRooms();
}
function renderRoomSelectionControls() {
  const groups = workspaceTab !== "watch" && elements.bookingMode.value === "profiles-parallel" ? [firstProfilePriority, ...extraProfiles.map(profile => profile.roomPriority || [])] : [rooms];
  document.getElementById("watchSelectAll").hidden = false;
  document.getElementById("watchSelectAll").disabled = workspaceTab !== "watch" && !groups.some(items => items.some(room => canSelectRoom(room.name) && !room.enabled));
  document.getElementById("watchDeselectAll").hidden = !groups.some(items => items.some(room => room.enabled));
}
const elements = Object.fromEntries([
  "startDate", "triggerAt", "nights", "bookingMode", "epochValue", "openAtValue", "reservationUrl", "roomList", "roomSectionTitle", "roomSectionHelp", "reserverName",
  "depositorName", "phone", "birthDate", "extraProfiles", "addProfileButton", "saveProfilesButton", "siteProfileSelect", "profilePriorities", "profileModeHelp", "multipleProfileField", "multipleProfileSelect",
  "historyList", "statusBadge", "statusText", "statusDetails", "profileStatusList", "siteClock", "siteTimeMeta", "siteTimeSyncButton",
  "diagnosticsPanel", "diagnosticsPreview", "copyDiagnosticsButton", "siteMapButton", "siteMapDialog", "siteMapCloseButton",
  "siteMapUploadButton", "siteMapFile", "siteMapImage", "siteMapMessage",
  "inspectButton", "reservationSiteButton", "reservationLookupButton", "reservationList", "saveButton", "stopButton", "runNowButton",
  "logList", "refreshLogsButton", "copyLogsButton", "saveLogsButton", "bookingHelpButton", "bookingHelpDialog", "bookingHelpCloseButton", "bookingHelpCurrent",
  "monthlyDialog", "monthlyPrevButton", "monthlyNextButton", "monthlyMonth", "monthlyQueryButton", "monthlyStatus", "monthlyContent", "monthlySourceLink", "monthlyDayDetails", "monthlyCacheInterval", "monthlyCacheSave", "monthlyCacheHelp", "monthlyCacheMessage"
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
let availabilityContext = "";
let availabilityController = null;
let siteTimeBase = null;
let autoLookupCompletedKey = "";
let autoLookupRunning = false;
let lastAutoLookupAttempt = 0;
let autoLookupCooldown = 5000;
let currentLogText = "";
let rawDiagnosticText = "";
let statusRequestInFlight = false, statusFailures = 0, nextStatusCheck = 0;
let cancelAuditPending = [], cancelAuditFlushing = false, cancelAuditRetryAt = 0;
try { const saved = JSON.parse(localStorage.getItem("swim-cancel-audit") || "[]"); if (Array.isArray(saved)) cancelAuditPending = saved.slice(-50); } catch { /* Storage can be unavailable in private mode. */ }
function persistCancelAudit() { try { localStorage.setItem("swim-cancel-audit", JSON.stringify(cancelAuditPending)); } catch {} }
function recordCancelEvent(event, reservationId) {
  const id = globalThis.crypto?.randomUUID?.() || Array.from({ length: 36 }, (_, index) => [8, 13, 18, 23].includes(index) ? "-" : Math.floor(Math.random() * 16).toString(16)).join("");
  cancelAuditPending.push({ id, event, reservationId: String(reservationId), occurredAt: Date.now() });
  cancelAuditPending = cancelAuditPending.slice(-50); persistCancelAudit(); void flushCancelAudit();
}
async function flushCancelAudit() {
  if (cancelAuditFlushing || !cancelAuditPending.length || Date.now() < cancelAuditRetryAt) return;
  cancelAuditFlushing = true;
  try {
    while (cancelAuditPending.length) {
      const entry = cancelAuditPending[0];
      await request("cancel-events", { method: "POST", timeoutMs: 5000, body: JSON.stringify(entry) });
      cancelAuditPending = cancelAuditPending.filter(item => item.id !== entry.id); persistCancelAudit();
    }
  } catch { cancelAuditRetryAt = Date.now() + 30_000; }
  finally { cancelAuditFlushing = false; }
}
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
  complete: "예약 완료", "multiple-final-submit": "복수 객실 간격 제출",
  "multiple-complete": "복수 객실 예약 완료", "multiple-partial": "복수 예약 일부 성공",
  "multiple-failed": "복수 예약 실패", "reservation-error": "예약 처리 오류",
  "profiles-final-ready": "예약자별 최종 제출 대기", "profile-running": "예약자별 순차 예약 진행",
  "profiles-preparation-deferred": "예약 오픈 시 새로 진행 대기",
  "profile-failed": "예약자 예약 실패", "profile-uncertain": "예약 결과 확인 필요", "profiles-complete": "예약자 순차 예약 완료",
  "profiles-parallel-running": "예약자 동시 예약 진행", "profiles-parallel-complete": "예약자 동시 예약 완료", "profiles-parallel-partial": "예약자 동시 예약 일부 확인 필요",
  exception: "실행 예외", missed: "실행 시각 경과", stopped: "실행 중지", inspected: "객실 확인 완료", expired: "취소 대기 종료"
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
  await initializeUiSettings();
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
  const reconnect = () => { nextStatusCheck = 0; void refreshStatus(); };
  document.getElementById("reconnectButton").addEventListener("click", reconnect);
  window.addEventListener("online", reconnect);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reconnect(); });
  initializeDatePicker();
  const timeDialog = document.getElementById("serverTimeDialog");
  document.getElementById("serverTimeButton").addEventListener("click", () => timeDialog.showModal());
  document.getElementById("serverTimeClose").addEventListener("click", () => timeDialog.close());
  timeDialog.addEventListener("close", () => document.getElementById("serverTimeButton").focus({ preventScroll: true }));
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
  elements.monthlyDialog.addEventListener("click", event => {
    if (event.target !== elements.monthlyDialog) return;
    const rect = elements.monthlyDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) elements.monthlyDialog.close();
  });
  elements.monthlyDialog.addEventListener("close", () => {
    monthlyController?.abort();
    monthlyRequest++;
    setMonthlyLoading(false);
    const target = selectedMonthlyDate ? elements.startDate : document.querySelector('[data-workspace-tab="monthly"]');
    if (selectedMonthlyDate) switchWorkspaceTab(elements.bookingMode.value, { keepEditor: true });
    target.focus({ preventScroll: true });
    if (selectedMonthlyDate) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  elements.bookingHelpButton.addEventListener("click", () => {
    const helpMode = workspaceTab === "watch" ? "watch" : elements.bookingMode.value;
    elements.bookingHelpCurrent.textContent = `예약 방식: ${helpMode === "watch" ? "취소 대기" : elements.bookingMode.selectedOptions[0]?.textContent || ""}`;
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
  elements.nights.addEventListener("change", () => { updateStayFields(); scheduleAvailabilityCheck(); });
  document.getElementById("checkoutDate").addEventListener("change", event => {
    const nights = (Date.parse(`${event.target.value}T00:00:00Z`) - Date.parse(`${elements.startDate.value}T00:00:00Z`)) / 86400000;
    if (!Number.isInteger(nights) || nights < 1 || nights > 6) { updateStayFields(true); showMessage("퇴실일은 입실일 다음 날부터 최대 6박까지 선택할 수 있습니다.", true); return; }
    elements.nights.value = String(nights);
    elements.nights.dispatchEvent(new Event("change", { bubbles: true }));
  });
  elements.bookingMode.addEventListener("change", () => {
    renderRooms();
    if (workspaceTab !== "watch") switchWorkspaceTab(elements.bookingMode.value, { keepEditor: true });
  });
  for (const id of ["reserverName", "depositorName", "phone", "birthDate"]) elements[id].addEventListener("input", refreshSiteProfileSelector);
  elements.saveProfilesButton.addEventListener("click", () => perform(async () => {
    await saveBookingActor(0);
  }));
  elements.addProfileButton.addEventListener("click", () => {
    if (extraProfiles.length + 1 >= bookingGuestLimit()) return;
    extraProfiles.push({});
    editorGeneration++;
    renderExtraProfiles();
    renderRooms();
  });
  document.getElementById("excludeFirstProfile").addEventListener("click", () => {
    if (!extraProfiles.length || !window.confirm("첫 예약자를 현재 일정에서 제외할까요? 저장된 예약자와 등록 일정은 유지됩니다.")) return;
    const config = readConfig();
    config.profiles = config.profiles.slice(1);
    loadConfig(config);
    renderBookingProfileSelectors();
  });
  elements.siteTimeSyncButton.addEventListener("click", () => perform(async () => refreshSiteTime(true)));
  elements.saveButton.addEventListener("click", () => perform(async () => {
    await saveConfig();
    showMessage("설정을 HA 미니 PC에 저장했습니다.");
  }));
  elements.runNowButton.addEventListener("click", () => perform(async () => {
    await refreshSiteTime(true);
    if (!updateImmediateBookingVisibility()) throw new Error("미래 시각 예약과 취소 대기는 저장 이력에서 등록한 뒤 시작하세요. 서버 시간도 확인해 주세요.");
    const date = elements.startDate.value;
    const selectedRooms = elements.bookingMode.value === "profiles-parallel" ? readConfig().profiles.map((profile, index) => `예약자 ${index + 1}: ${roomSummaryText((profile.roomPriority || []).filter(room => room.enabled).map(room => room.name)) || "선택 없음"}`) : rooms.filter((room) => room.enabled).map((room, index) => `${elements.bookingMode.value === "multiple" ? "" : `${rankSymbol(index + 1)} `}${shortRoomText(room.name)}`);
    const multiple = elements.bookingMode.value === "multiple";
    const modeText = elements.bookingMode.value === "profiles-parallel" ? `다인 예약 · ${extraProfiles.length + 1}명 · 각자 우선순위` : multiple ? `다중 예약 (${selectedRooms.length}개) · ${elements.reserverName.value || "선택한 한 명"}`
      : `단독 예약 · ${elements.reserverName.value || "선택한 한 명"}`;
    const approved = window.confirm(
      `${date}부터 ${elements.nights.value}박 예약을 지금 즉시 실행합니다.\n\n예약 방식: ${modeText}\n예약 대상: ${selectedRooms.join(", ") || "선택 없음"}\n\n환불 규정 동의와 최종 예약하기까지 자동 진행됩니다. 실행할까요?`
    );
    if (!approved) return;
    await saveConfig();
    await registerPlan("now", true);
    await refreshStatus();
  }));
  elements.stopButton.addEventListener("click", () => batchPlanAction("stop", true).catch(error => showMessage(error.message, true)));
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
    void loadMapGallery().catch(error => { elements.siteMapMessage.textContent = `사진 이력 조회 실패: ${error.message}`; });
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
  if (!file || galleryBusy) return;
  galleryBusy = true;
  renderMapGallery();
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
    await loadMapGallery().catch(error => { elements.siteMapMessage.textContent += ` 사진 이력 조회 실패: ${error.message}`; });
  } catch (error) {
    elements.siteMapMessage.textContent = `등록 실패: ${error.message}`;
  } finally {
    bitmap?.close();
    elements.siteMapFile.value = "";
    galleryBusy = false;
    renderMapGallery();
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
    setMonthlyLoading(false);
    return;
  }
  const controller = new AbortController();
  monthlyController = controller;
  selectedMonthlyDate = null;
  setMonthlyLoading(true);
  const [year, number] = month.split("-").map(Number);
  const roomNames = rooms.map(room => room.name);
  let result = { month, opensAt: bookingOpenIso(`${month}-01`), beforeOpen: isBeforeOpen(`${month}-01`), roomNames, capturedAt: Date.now(), progressText: "월별 페이지 조회 중…", days: Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, queryState: "queued", rooms: roomNames.map(name => ({ name, status: "unknown" })) })) };
  renderMonthlyAvailability(result);
  const sourceUrl = 'https://www.swimozicamp.com/camp/';
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
      if (result.countsOnly) { renderMonthlyAvailability(result); return; }
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
    if (id === monthlyRequest) setMonthlyLoading(false);
  }
}

function renderMonthlyAvailability(result) {
  const today = seoulToday();
  monthlyResult = result;
  const opened = result.beforeOpen ? "예약 오픈 전" : "예약 오픈 일시 경과";
  const opening = result.opensAt ? new Date(`${result.opensAt}+09:00`).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "미확인";
  const captured = new Date(result.capturedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  const captureLabel = result.month < today.slice(0, 7) ? "사이트 조회 안 함" : result.capturedAt ? `최근 확인 ${captured}` : "현황 확인 대기";
  elements.monthlyStatus.textContent = shortRoomText(`${result.month} · ${opened} · 예약 오픈 ${opening} · ${result.progressText || ""} · ${captureLabel}. ${result.message || ""}`);
  const days = result.days || [];
  const table = document.createElement("table");
  table.className = "monthly-calendar";
  const caption = document.createElement("caption");
  caption.setAttribute("aria-label", `${result.month} 예약 현황`);
  const monthControls = document.querySelector(".monthly-controls");
  const monthFocused = document.activeElement === elements.monthlyMonth;
  caption.append(monthControls);
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
        const badges = result.countsOnly ? `<span class="monthly-cell">${day.beforeOpen ? "오픈 전" : Number.isInteger(day.availableCount) ? `${day.availableCount}곳 가능` : "미확인"}</span>` : (past ? [] : day.rooms).map(room => {
          const status = labels[room.status] ? room.status : "unknown";
          const [mark, label] = labels[status];
          const name = shortRoomText(room.name);
          return `<span class="monthly-room-row" title="${escapeHtml(`${name} · ${label}`)}"><span class="monthly-room-mark ${status}" aria-label="${label}">${mark}</span><span class="monthly-room-name">${escapeHtml(name)}</span></span>`;
        }).join("");
        if (day.queryState === "error") button.setAttribute("aria-label", `${day.date} · 조회 실패 · 날짜 선택 후 다시 확인`);
        button.innerHTML = `<span class="monthly-day-number">${Number(day.date.slice(-2))}</span><span class="monthly-day-rooms">${past ? '<span class="monthly-cell unknown">지난 날짜</span>' : badges || '<span class="monthly-cell unknown">미확인</span>'}</span><span hidden aria-hidden="true" class="monthly-day-state ${past ? "past" : day.queryState || "done"}"></span>`;
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
  if (monthFocused) elements.monthlyMonth.focus({ preventScroll: true });
  renderMonthlyDayDetails();
}

function renderMonthlyDayDetails() {
  elements.monthlyDayDetails.textContent = "";
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
  document.getElementById("campAdults").value = String(config.adults || 2);
  document.getElementById("campArrival").value = config.arrivalTime || "";
  document.getElementById("campRequest").value = config.request || "";
  elements.phone.value = profile1.phone || "";
  elements.birthDate.value = profile1.birthDate || "";
  extraProfiles = profiles.slice(1).map(profile => ({ ...profile }));
  renderExtraProfiles();
  elements.multipleProfileSelect.value = "0";
  rooms = Array.isArray(config.roomPriority) ? config.roomPriority : [];
  renderRooms();
  updateBookingProfileVisibility();
  updateGeneratedValues();
  updateStayFields(true);
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
    adults: Number(document.getElementById("campAdults").value),
    arrivalTime: document.getElementById("campArrival").value,
    request: document.getElementById("campRequest").value,
    paymentMethod: "bank",
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
    applyGuestColor(panel, index + 1);
    panel.innerHTML = '<h3>예약자 ' + (index + 2) + '</h3><div class="grid two identity-fields"></div><div class="section-actions profile-panel-actions"><button type="button" class="secondary">예약자 제외</button></div>';
    for (const [key, label] of [["reserverName", "예약자명"], ["depositorName", "입금자명"], ["phone", "휴대폰 번호"]]) {
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
  updateGuestAddButton();
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
  elements.profilePriorities.classList.toggle("single-profile", profiles.length === 1);
  profiles.forEach((profile, profileIndex) => {
    const priority = profileIndex ? (extraProfiles[profileIndex - 1].roomPriority ||= []) : firstProfilePriority;
    if (!priority.length) priority.push(...rooms.map(room => ({ name: room.name, enabled: room.enabled })));
    for (const room of rooms) if (!priority.some(item => item.name === room.name)) priority.push({ name: room.name, enabled: false });
    const panel = document.createElement("div");
    panel.className = "second-profile-panel";
    if (profiles.length > 1) applyGuestColor(panel, profileIndex);
    const title = document.createElement("h3");
    title.textContent = `${profile.reserverName || `예약자 ${profileIndex + 1}`} · 객실 선택`;
    panel.append(title);
    const toolbar = document.createElement("div");
    toolbar.className = "section-actions room-actions profile-room-actions";
    const selectAll = document.createElement("button"), clearAll = document.createElement("button");
    for (const button of [selectAll, clearAll]) { button.type = "button"; button.className = "secondary"; }
    selectAll.textContent = "전체 선택"; selectAll.disabled = !priority.some(room => canSelectRoom(room.name) && !room.enabled);
    clearAll.textContent = "전체 해제"; clearAll.hidden = !priority.some(room => room.enabled);
    selectAll.addEventListener("click", () => setRoomSelection(priority, true));
    clearAll.addEventListener("click", () => setRoomSelection(priority, false));
    toolbar.append(selectAll, clearAll); panel.append(toolbar);
    const list = document.createElement("div");
    list.className = "room-list";
    list.dataset.profileIndex = String(profileIndex);
    let rank = 0;
    priority.forEach((room, index) => {
      if (room.enabled) rank++;
      const row = document.createElement("div");
      row.className = `room-row${room.enabled ? " enabled" : ""}`;
      const availability = availabilityByRoom.get(room.name) || "unknown";
      row.innerHTML = `<label class="room-toggle"><input type="checkbox" ${room.enabled ? "checked" : ""} ${canSelectRoom(room.name) ? "" : "disabled"} aria-label="예약자 ${profileIndex + 1} ${escapeHtml(room.name)} 선택"></label><div class="room-name"><span class="room-rank">${room.enabled ? `${rank}순위` : "—"}</span>${escapeHtml(room.name)}<span class="availability ${availability}">${AVAILABILITY_LABELS[availability]}</span></div><button class="room-drag-handle" type="button" aria-label="예약자 ${profileIndex + 1} ${escapeHtml(room.name)} 순서 이동"><span class="drag-bars" aria-hidden="true"></span></button>`;
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
  renderRoomSelectionControls();
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
  for (const entry of entries) {
    const row = document.createElement("div"); row.className = "execution-plan legacy-history-row";
    const button = document.createElement("button"); button.type = "button"; button.className = "plan-detail-open"; button.style.gridColumn = "1 / -1";
    button.textContent = `${entry.startDate} · ${entry.nights}박 · 이전 저장 설정`;
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", () => openLegacyHistory(entry));
    row.append(button); elements.historyList.append(row);
  }
}
function openLegacyHistory(entry) {
  selectedDetailPlan = null;
  const dialog = document.getElementById("planDetailsDialog"), list = document.getElementById("planList");
  document.getElementById("planDetailsTitle").textContent = "이전 저장 설정";
  list.replaceChildren();
  document.getElementById("planDetailsMessage").textContent = "이전 버전에서 저장한 설정입니다. 불러온 뒤 일정 등록으로 실행 목록에 추가하세요.";
  const title = document.createElement("strong"); title.textContent = `${entry.startDate} · ${entry.nights}박 · ${bookingModeName({ config: entry })}`;
  const summary = document.createElement("p");
  summary.textContent = entry.bookingMode === "profiles-parallel" ? (entry.profilePriorities || []).map(profile => `${profile.reserverName || "예약자"}: ${roomSummaryText(profile.enabledRooms || [])}`).join(" / ") : roomSummaryText(entry.enabledRooms || [], entry.bookingMode !== "multiple");
  const actions = document.createElement("div"); actions.className = "section-actions";
  const load = document.createElement("button"), remove = document.createElement("button");
  for (const button of [load, remove]) { button.type = "button"; button.className = "secondary"; }
  load.textContent = "불러오기"; remove.textContent = "삭제";
  load.addEventListener("click", () => perform(async () => {
    const result = await request(`history/${encodeURIComponent(entry.id)}/load`, { method: "POST" });
    dialog.close();
    loadConfig(result.config);
    switchWorkspaceTab(result.config.bookingMode, { keepEditor: true });
    await refreshAvailability();
    showMessage("이전 저장 설정을 불러왔습니다. 일정 이름을 입력하고 등록하세요.");
  }));
  remove.addEventListener("click", () => perform(async () => {
    if (!window.confirm(`${entry.startDate} · ${entry.nights}박 이전 저장 설정을 삭제할까요? 실제 예약과 등록 일정은 변경되지 않습니다.`)) return;
    await request(`history/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    dialog.close(); await refreshHistory();
  }));
  actions.append(load, remove); list.append(title, summary, actions);
  if (!dialog.open) dialog.showModal();
}

function renderRooms() {
  if (roomDrag) return;
  if (workspaceTab === "watch") { renderWatchRooms(); return; }
  const parallel = elements.bookingMode.value === "profiles-parallel";
  updateGuestAddButton();
  renderProfilePriorities();
  renderRoomSelectionControls();
  const multiple = elements.bookingMode.value === "multiple";
  elements.roomSectionTitle.textContent = "객실 선택";
  elements.roomList.hidden = parallel;
  document.getElementById("roomDragHelp").hidden = parallel || multiple;
  elements.roomSectionHelp.textContent = parallel ? "위에서 입력한 각 예약자의 객실을 체크하고 손잡이로 순위를 정하세요. 한 사람당 객실 하나를 예약하며, 최종 제출은 설정한 간격으로 진행합니다." : multiple
    ? "체크한 객실(최대 5개)을 각각 별도 예약으로 준비하고 최종 제출은 설정한 간격으로 진행합니다."
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
      <label class="room-toggle"><input type="checkbox" ${room.enabled ? "checked" : ""} ${canSelectRoom(room.name) ? "" : "disabled"} aria-label="${escapeHtml(room.name)} 선택"></label>
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
  document.getElementById("roomDragStatus").textContent = `${rooms[target].name}, ${target + 1}번째로 이동했습니다. 일정을 등록해 주세요.`;
}

function startRoomDrag(event, row, index, list = elements.roomList, items = rooms, render = renderRooms) {
  if (roomDrag || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  let y = event.clientY, x = event.clientX, moved = false, target = index, frame;
  const initialY = y;
  const initialX = x;
  roomDrag = { index };
  handle.setPointerCapture(pointerId);
  row.classList.add("dragging");
  const rows = [...list.children];
  const mark = () => {
    rows.forEach(item => item.classList.remove("drop-before", "drop-after"));
    const boundary = rows.findIndex(item => {
      const rect = item.getBoundingClientRect();
      const columns = getComputedStyle(list).gridTemplateColumns.split(" ").length;
      return columns > 1 ? y < rect.top || y <= rect.bottom && x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2;
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
    x = e.clientX;
    moved ||= Math.abs(y - initialY) > 5 || Math.abs(x - initialX) > 5;
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
    if (changed) document.getElementById("roomDragStatus").textContent = `${items[position].name}, ${position + 1}번째로 이동했습니다. 일정을 등록해 주세요.`;
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
    elements.reservationUrl.removeAttribute("href");
    elements.reservationUrl.setAttribute("aria-disabled", "true");
    elements.reservationUrl.textContent = "입실일을 먼저 선택해 주세요.";
    return;
  }
  const epoch = Math.floor(Date.parse(`${date}T00:00:00+09:00`) / 1000);
  elements.epochValue.textContent = String(epoch);
  elements.openAtValue.textContent = formatOpeningTime(date);
  const checkout = new Date(Date.parse(`${date}T00:00:00Z`) + Number(elements.nights.value || 1) * 86400000).toISOString().slice(0, 10);
  const url = `https://www.swimozicamp.com/camp/?ci=${date}&co=${checkout}&ad=${document.getElementById("campAdults").value}&ch=0&in=0`;
  elements.reservationUrl.href = url;
  elements.reservationUrl.textContent = url;
  elements.reservationUrl.removeAttribute("aria-disabled");
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
    elements.siteClock.textContent = "미확인";
    document.getElementById("serverTimeValue").textContent = "서버 시간 미확인";
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
  document.getElementById("triggerDetails").hidden = workspaceTab === "watch" || allowed || !elements.triggerAt.value;
  elements.triggerAt.closest("label").hidden = workspaceTab === "watch" || allowed;
  applyUiVisibility();
  updateStayFields();
  return allowed;
}

function renderSiteClock() {
  updateImmediateBookingVisibility();
  const now = currentSiteTime();
  if (!Number.isFinite(now)) return;
  elements.siteClock.textContent = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(new Date(now));
  document.getElementById("serverTimeValue").textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(now));
}

async function refreshStatus() {
  if (statusRequestInFlight || Date.now() < nextStatusCheck) return;
  statusRequestInFlight = true;
  try {
    const status = await request("status", { timeoutMs: 6000 });
    if (!Object.hasOwn(STATE_LABELS, status.state)) throw Object.assign(new Error("정상적인 상태 응답을 확인하지 못했습니다."), { code: "CONNECTION_LOST" });
    statusFailures = 0; nextStatusCheck = 0;
    serverVersion = status.appVersion || null;
    document.getElementById("installedAppVersion").textContent = `앱 버전: ${serverVersion || "확인 중"} · 화면 버전: ${CLIENT_VERSION}`;
    const versionMismatch = serverVersion && serverVersion !== CLIENT_VERSION;
    document.getElementById("screenUpdateNotice").hidden = !versionMismatch;
    document.getElementById("screenUpdateMessage").textContent = versionMismatch ? `앱이 업데이트되었습니다 (화면 ${CLIENT_VERSION} / 서버 ${serverVersion}). 저장하지 않은 입력을 확인한 뒤 화면을 새로 열어 주세요.` : "";
    document.getElementById("connectionNotice").hidden = true;
    void flushCancelAudit();
    renderStatus(status);
    void maybeAutoLookupReservations(status);
  } catch (error) {
    statusFailures++;
    nextStatusCheck = Date.now() + Math.min(30_000, 3000 * 2 ** Math.min(statusFailures - 1, 4));
    document.getElementById("connectionNotice").hidden = false;
    document.getElementById("connectionMessage").textContent = error.code === "AUTH_REQUIRED" ? error.message : "앱 연결이 잠시 끊겼습니다. 자동으로 다시 연결합니다. 마지막 확인 상태는 유지됩니다.";
  } finally {
    statusRequestInFlight = false;
  }
}

async function maybeAutoLookupReservations(status) {
  if (!["success", "failed"].includes(status.state) || autoLookupRunning) return;
  const key = `${status.state}:${status.stage}:${status.updatedAt}`;
  if (key === autoLookupCompletedKey || Date.now() - lastAutoLookupAttempt < autoLookupCooldown) return;
  lastAutoLookupAttempt = Date.now();
  autoLookupRunning = true;
  try {
    const result = await loadReservations();
    if (!result.lookupErrors?.length) { autoLookupCompletedKey = key; autoLookupCooldown = 5000; }
    else autoLookupCooldown = Math.min(60_000, autoLookupCooldown * 2);
    await refreshLogs();
  } catch (error) {
    autoLookupCooldown = 60_000;
    elements.reservationList.hidden = false;
    elements.reservationList.innerHTML = `<strong>예약확인</strong><p>자동 예약확인 실패: ${escapeHtml(error.message)}</p>`;
  } finally {
    autoLookupRunning = false;
  }
}

let savedLookupRequest = 0;
let savedLookupPending = 0;
function setReservationLookupLoading(delta) {
  savedLookupPending = Math.max(0, savedLookupPending + delta);
  const loading = savedLookupPending > 0;
  const spinner = document.getElementById("reservationLookupSpinner");
  if (spinner) spinner.hidden = !loading;
  elements.reservationList.setAttribute("aria-busy", String(loading));
}
async function loadReservations() {
  const id = ++savedLookupRequest;
  const profiles = bookingBook.map(bookingIdentity);
  setReservationLookupLoading(1);
  try {
    const result = await request("reservations");
    if (id !== savedLookupRequest) return result;
    const queried = result.lookupStatuses?.length ? result.lookupStatuses.map(item => item.profile || profiles[item.profileIndex]) : profiles;
    renderReservations(result.reservations || [], { profiles: queried, errors: result.lookupErrors || [] });
    return result;
  } finally { setReservationLookupLoading(-1); }
}

function renderStatus(status) {
  const state = status.state || "idle";
  currentState = state;
  currentStage = status.stage || "idle";
  renderExecutionPlans();
  elements.statusBadge.className = `badge ${state}`;
  elements.statusBadge.textContent = STATE_LABELS[state] || state;
  renderPlanBadge();
  elements.statusText.textContent = shortRoomText(status.message || "상태 정보가 없습니다.");
  elements.statusText.hidden = state === "idle";
  elements.statusDetails.hidden = state === "idle";
  const details = [];
  if (status.startDate) details.push(["입실일", status.startDate]);
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
    const dd = document.createElement("dd"); dd.textContent = shortRoomText(value);
    return [dt, dd];
  }));
  renderProfileStatuses(status.profileStatuses || []);
  const diagnosticText = status.diagnostics ? JSON.stringify(status.diagnostics, null, 2) : "";
  elements.diagnosticsPanel.hidden = !diagnosticText;
  rawDiagnosticText = diagnosticText;
  elements.diagnosticsPreview.textContent = shortRoomText(diagnosticText);
}

function renderProfileStatuses(statuses) {
  elements.profileStatusList.hidden = !statuses.length;
  elements.profileStatusList.replaceChildren(...statuses.map((status) => {
    const row = document.createElement("div");
    row.className = "profile-status-row";
    row.innerHTML = `<strong>${escapeHtml(status.label || `예약자 ${Number(status.index) + 1}`)}</strong><span>${escapeHtml(shortRoomText(status.message || status.state || "대기"))}${status.room ? ` · ${escapeHtml(shortRoomText(status.room))}` : ""}</span>`;
    return row;
  }));
}

async function copyDiagnostics() {
  const text = rawDiagnosticText;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showMessage("진단 정보를 복사했습니다. 이 대화에 그대로 붙여 넣어 주세요.");
}

function renderInspection(result, { beforeOpen = false, addedRooms = [] } = {}) {
  availabilityContext = `${elements.startDate.value}/${Number(elements.nights.value)}`;
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

function renderReservations(reservations, { container = elements.reservationList, profiles = bookingBook, errors = [], reload = loadReservations } = {}) {
  container.hidden = false;
  container.replaceChildren();
  if (!profiles.length) {
    const empty = document.createElement("p");
    empty.className = "reservation-empty";
    empty.textContent = "저장된 예약자가 없습니다. 예약자 정보 메뉴에서 추가하세요.";
    container.append(empty);
    return;
  }
  profiles.forEach((profile, profileIndex) => {
    const group = document.createElement("section"); group.className = "reservation-person-group"; applyGuestColor(group, profileIndex);
    const title = document.createElement("h3"); title.textContent = `${profile.reserverName} · ${profile.phone}`;
    group.append(title);
    const found = reservations.filter(item => (item.profileIndex || 0) === profileIndex);
    const failure = errors.find(item => item.profileIndex === profileIndex);
    if (failure || !found.length) {
      const message = document.createElement("p"); message.textContent = failure ? `조회 실패: ${failure.message}` : "내역 없음";
      if (failure) message.className = "error";
      group.append(message);
    }
    for (const reservation of found) {
    const row = document.createElement("div");
    row.className = "reservation-row";
    row.innerHTML = `
      <div><strong>${escapeHtml(shortRoomText(reservation.room))}</strong><span>${escapeHtml(reservation.stayDate)} · ${escapeHtml(reservation.nights)}</span>${reservation.cancelPolicy === 'contact' ? `<span>예약번호 ${escapeHtml(reservation.id)}</span>` : ''}</div>
      <div><span>예약 금액</span><strong>${escapeHtml(reservation.total)}</strong></div>
      <div><span>예약 상태</span><strong>${escapeHtml(reservation.status)}</strong>${reservation.depositDeadline ? `<span>입금 기한 ${escapeHtml(reservation.depositDeadline)}</span>` : ''}</div>
      ${reservation.cancelable ? '<button type="button" class="reservation-cancel-button danger">예약 취소</button>' : `<span class="cancel-disabled">${reservation.cancelPolicy === 'contact' ? '취소는 캠핑장에 문의해 주세요' : '사이트에서 취소 불가'}</span>`}`;
    const cancelButton = row.querySelector(".reservation-cancel-button");
    cancelButton?.addEventListener("click", () => {
      recordCancelEvent("clicked", reservation.id);
      if (serverVersion && serverVersion !== CLIENT_VERSION) { showMessage("화면과 서버 버전이 다릅니다. 화면을 새로 열고 예약 내역을 다시 조회한 뒤 취소해 주세요. 취소는 실행되지 않았습니다.", true); return; }
      if (busy) { recordCancelEvent("busy", reservation.id); showMessage("다른 작업을 처리 중입니다. 완료된 뒤 예약 취소를 다시 눌러 주세요.", true); return; }
      return perform(async () => {
      const approved = window.confirm(
        `${shortRoomText(reservation.room)}\n${reservation.stayDate} · ${reservation.nights}\n결제 금액 ${reservation.total}\n\n이 예약을 실제로 취소할까요? 취소한 예약은 자동으로 복구할 수 없습니다.`
      );
      if (!approved) { recordCancelEvent("dismissed", reservation.id); return; }
      recordCancelEvent("confirmed", reservation.id);
      try {
      const result = await request(`reservations/${encodeURIComponent(reservation.id)}/cancel`, {
        method: "POST", timeoutMs: 90_000, body: JSON.stringify({ confirmed: true, profileIndex, profile: reservation.profile || bookingIdentity(profile), expected: { room: reservation.room, stayDate: reservation.stayDate, nights: reservation.nights } })
      });
      recordCancelEvent("response-ok", reservation.id);
      await reload();
      showMessage(`${reservation.room} 예약 취소가 완료되었습니다.`, false, "예약 취소 완료");
      } catch (error) { recordCancelEvent(error.code === "CONNECTION_LOST" ? "connection-lost" : "response-error", reservation.id); throw error; }
    }); });
    group.append(row);
    }
    container.append(group);
  });
}

function scheduleAvailabilityCheck(delay = 500) {
  availabilityController?.abort();
  availabilityRequest += 1;
  clearTimeout(availabilityTimer);
  availabilityByRoom.clear();
  renderRooms();
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
  updateBookEditor();
  refreshLookupSiteSelector();
  updateOneOffLookupButton();
  for (const button of elements.reservationList.querySelectorAll("button")) button.disabled = disabled;
  renderExecutionPlans();
}

async function refreshLogs() {
  const result = await request("logs?limit=300");
  const entries = result.entries || [];
  currentLogText = entries.slice().reverse().map(formatLogEntry).join("\n");
  elements.logList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "저장된 로그가 없습니다.";
    elements.logList.append(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `log-row ${entry.level || "info"}`;
    const time = new Date(entry.timestamp).toLocaleString("ko-KR");
    row.innerHTML = `<time>${escapeHtml(time)}</time><strong>${entry.level === "error" ? "오류" : "정보"}</strong><span>${escapeHtml(shortRoomText(entry.message || entry.event || ""))}</span>`;
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
  const text = currentLogText || "저장된 로그가 없습니다.";
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
  showMessage("로그를 복사했습니다.");
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
  showMessage("로그 파일을 저장했습니다.");
}

function showMessage(message, error = false, successLabel = "저장 완료") {
  document.getElementById("workspaceMessage").textContent = shortRoomText(message);
  elements.statusText.textContent = shortRoomText(message);
  elements.statusBadge.textContent = error ? "확인 필요" : successLabel;
  elements.statusBadge.className = `badge ${error ? "failed" : "success"}`;
}

async function request(path, options = {}) {
  const { timeoutMs = 120_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(API(path), { ...fetchOptions, headers: { "Content-Type": "application/json", ...fetchOptions.headers, "X-Swim-Client-Version": CLIENT_VERSION }, signal: controller.signal });
    if ([401, 403].includes(response.status)) throw Object.assign(new Error("HA 접속 권한 또는 로그인 세션을 확인하고 앱을 다시 열어 주세요."), { code: "AUTH_REQUIRED" });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw Object.assign(new Error("앱 응답을 확인할 수 없습니다. HA에서 앱을 다시 열어 주세요."), { code: "CONNECTION_LOST" });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || `요청 실패 (${response.status})`), { code: value.code, status: response.status });
    return value;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof TypeError || error instanceof SyntaxError || error.name === "AbortError") {
      const changing = !["GET", "HEAD"].includes(String(options.method || "GET").toUpperCase());
      throw Object.assign(new Error(changing ? "서버 응답을 확인하지 못했습니다. 처리 결과를 먼저 조회해 주세요. 같은 요청을 자동 재전송하지 않습니다." : "앱 연결이 끊겼거나 응답이 지연되었습니다. 잠시 후 다시 확인해 주세요."), { code: "CONNECTION_LOST" });
    }
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

// One calendar across desktop/mobile; only committing dispatches editor changes.
function initializeDatePicker() {
  const dialog = document.getElementById("datePickerDialog");
  const get = name => document.getElementById(`datePicker${name}`);
  let target = null, month = "", selected = "", rangeMode = false, rangeStart = "", rangeEnd = "", rangePhase = "start";
  const eligible = input => input instanceof HTMLInputElement && ["date", "datetime-local", "month"].includes(input.type) && !input.disabled && !input.readOnly;
  const shift = delta => {
    const [year, number] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, number - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const allowedMonth = value => value >= (target.min.slice(0, 7) || "0001-01") && value <= (target.max.slice(0, 7) || "9999-12");
  function render() {
    const [year, number] = month.split("-").map(Number);
    get("Month").textContent = `${year}년 ${number}월`;
    get("Prev").disabled = !allowedMonth(shift(-1));
    get("Next").disabled = !allowedMonth(shift(1));
    get("Days").hidden = target.type === "month";
    get("TimeField").hidden = target.type !== "datetime-local";
    get("Error").textContent = "";
    get("Range").hidden = !rangeMode;
    if (rangeMode) {
      get("Title").textContent = rangePhase === "start" ? "입실일 선택" : "퇴실일 선택";
      for (const [key, label, value] of [["Checkin", "입실일", rangeStart], ["Checkout", "퇴실일", rangeEnd]]) {
        const date = document.createElement("strong"); date.textContent = value || "선택";
        get(key).replaceChildren(document.createTextNode(label), date);
      }
      get("Checkin").setAttribute("aria-pressed", String(rangePhase === "start"));
      get("Checkout").setAttribute("aria-pressed", String(rangePhase === "end"));
      get("Checkout").disabled = !rangeStart;
      get("Nights").textContent = rangeStart && rangeEnd ? `${(Date.parse(rangeEnd) - Date.parse(rangeStart)) / 86400000}박` : "—";
    }
    get("Apply").disabled = target.type !== "month" && !selected;
    get("Days").replaceChildren();
    if (target.type === "month") return;
    for (const label of ["일", "월", "화", "수", "목", "금", "토"]) {
      const cell = document.createElement("span"); cell.textContent = label; get("Days").append(cell);
    }
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    for (let index = 0; index < offset; index++) get("Days").append(document.createElement("span"));
    const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    for (let day = 1; day <= count; day++) {
      const value = `${month}-${String(day).padStart(2, "0")}`;
      const button = document.createElement("button");
      button.type = "button"; button.className = "date-picker-day"; button.textContent = day;
      button.dataset.date = value; button.setAttribute("aria-label", `${year}년 ${number}월 ${day}일`);
      button.setAttribute("aria-pressed", String(value === selected));
      if (rangeMode) {
        button.setAttribute("aria-pressed", String(value === rangeStart || value === rangeEnd));
        button.classList.toggle("range-start", value === rangeStart);
        button.classList.toggle("range-end", value === rangeEnd);
        button.classList.toggle("in-range", Boolean(rangeStart && rangeEnd && value > rangeStart && value < rangeEnd));
      }
      button.disabled = Boolean(target.min && value < target.min.slice(0, 10) || target.max && value > target.max.slice(0, 10));
      if (rangeMode && rangePhase === "end") button.disabled ||= value <= rangeStart || value > stayEndDate(rangeStart, 6);
      button.addEventListener("click", () => {
        if (rangeMode) {
          if (rangePhase === "start") { rangeStart = value; rangeEnd = ""; rangePhase = "end"; render(); get("Checkout").focus(); return; }
          rangeEnd = value;
          const nights = (Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86400000;
          if (!Number.isInteger(nights) || nights < 1 || nights > 6) return;
          elements.nights.value = String(nights);
          const previous = elements.startDate.value;
          elements.startDate.value = rangeStart;
          if (previous !== rangeStart) {
            elements.startDate.dispatchEvent(new Event("input", { bubbles: true }));
            elements.startDate.dispatchEvent(new Event("change", { bubbles: true }));
          }
          elements.nights.dispatchEvent(new Event("input", { bubbles: true }));
          elements.nights.dispatchEvent(new Event("change", { bubbles: true }));
          updateStayFields(); dialog.close(); return;
        }
        selected = value;
        if (target.type === "date") { get("Apply").disabled = false; get("Apply").click(); }
        else { render(); get("Days").querySelector(`[data-date="${value}"]`).focus(); }
      });
      get("Days").append(button);
    }
  }
  function open(input) {
    if (dialog.open) return;
    target = input;
    rangeMode = uiSettings.stayRange && ["startDate", "checkoutDate"].includes(input.id);
    rangeStart = elements.startDate.value;
    rangeEnd = document.getElementById("checkoutDate").value;
    rangePhase = input.id === "checkoutDate" && rangeStart ? "end" : "start";
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    selected = input.type === "month" ? "" : input.value.slice(0, 10);
    month = (input.value || today).slice(0, 7);
    if (input.min && month < input.min.slice(0, 7)) month = input.min.slice(0, 7);
    if (input.max && month > input.max.slice(0, 7)) month = input.max.slice(0, 7);
    get("Title").textContent = input.type === "month" ? "월 선택" : input.type === "datetime-local" ? "날짜·시각 선택" : "날짜 선택";
    get("Time").value = input.value.split("T")[1] || "00:00:00";
    get("Apply").hidden = input.type === "date";
    render(); dialog.showModal();
    (get("Days").querySelector('[aria-pressed="true"]:not(:disabled)') || get("Next")).focus();
  }
  // Suppress the OS picker even when its indicator is clicked; retain typed input.
  document.addEventListener("pointerdown", event => { if (eligible(event.target)) event.preventDefault(); });
  document.addEventListener("click", event => { if (eligible(event.target)) { event.preventDefault(); open(event.target); } });
  document.addEventListener("keydown", event => {
    if (eligible(event.target) && (event.key === " " || event.key === "ArrowDown" && event.altKey)) { event.preventDefault(); open(event.target); }
  });
  get("Prev").addEventListener("click", () => { month = shift(-1); render(); });
  get("Next").addEventListener("click", () => { month = shift(1); render(); });
  get("Cancel").addEventListener("click", () => dialog.close());
  get("Checkin").addEventListener("click", () => { rangePhase = "start"; render(); });
  get("Checkout").addEventListener("click", () => { if (rangeStart) { rangePhase = "end"; render(); } });
  get("Apply").addEventListener("click", () => {
    let value = target.type === "month" ? month : selected;
    if (target.type === "datetime-local") {
      if (!get("Time").value || !get("Time").checkValidity()) { get("Error").textContent = "올바른 시각을 입력해 주세요."; return; }
      value += `T${get("Time").value}`;
    }
    const previous = target.value;
    target.value = value;
    if (!target.checkValidity()) { target.value = previous; get("Error").textContent = "선택할 수 있는 날짜·시각 범위를 확인해 주세요."; return; }
    if (previous !== target.value) {
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    dialog.close();
  });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => target?.focus({ preventScroll: true }));
}

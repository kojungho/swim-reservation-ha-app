const API = (path) => new URL(`api/${path}`, document.baseURI).href;
const elements = Object.fromEntries([
  "startDate", "triggerAt", "nights", "bookingMode", "epochValue", "openAtValue", "reservationUrl", "roomList", "roomSectionTitle", "roomSectionHelp", "reserverName",
  "depositorName", "phone", "birthDate", "historyList", "statusBadge", "statusText", "statusDetails", "inspectResult",
  "diagnosticsPanel", "diagnosticsPreview", "copyDiagnosticsButton", "siteMapButton", "siteMapDialog", "siteMapCloseButton",
  "inspectButton", "reservationLookupButton", "reservationList", "saveButton", "stopButton", "runNowButton", "startButton"
].map((id) => [id, document.getElementById(id)]));

let rooms = [];
let busy = false;
let currentState = "idle";
let availabilityTimer = null;
let availabilityRequest = 0;
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
  exception: "실행 예외", missed: "실행 시각 경과", stopped: "실행 중지", inspected: "객실 확인 완료"
};
const AVAILABILITY_LABELS = {
  available: "예약 가능", booked: "예약 완료", unavailable: "해당 박수 불가",
  checking: "확인 중", "checking-before-open": "확인 중 (예약 오픈 전)",
  "available-before-open": "예약 가능 (예약 오픈 전)", "unavailable-before-open": "예약 불가 (예약 오픈 전)",
  "before-open": "확인 불가 (예약 오픈 전)", unknown: "미확인"
};

init().catch((error) => showMessage(error.message, true));

async function init() {
  const config = await request("config");
  loadConfig(config);
  bindEvents();
  await refreshHistory();
  await refreshStatus();
  scheduleAvailabilityCheck(0);
  setInterval(refreshStatus, 1500);
}

function bindEvents() {
  elements.startDate.addEventListener("change", () => {
    updateGeneratedValues();
    elements.triggerAt.value = bookingOpenIso(elements.startDate.value);
    scheduleAvailabilityCheck();
  });
  elements.nights.addEventListener("change", () => scheduleAvailabilityCheck());
  elements.bookingMode.addEventListener("change", () => renderRooms());
  elements.saveButton.addEventListener("click", () => perform(async () => {
    await saveConfig();
    showMessage("설정을 HA 미니 PC에 저장했습니다.");
  }));
  elements.startButton.addEventListener("click", () => perform(async () => {
    if (elements.bookingMode.value === "multiple") {
      const selectedRooms = rooms.filter((room) => room.enabled).map((room) => room.name);
      const approved = window.confirm(
        `여러 객실 동시 예약을 대기시킵니다.\n\n숙박: ${elements.startDate.value}부터 ${elements.nights.value}박\n실제 예약 객실 ${selectedRooms.length}개: ${selectedRooms.join(", ") || "선택 없음"}\n\n지정 시각에 각 객실이 별도 예약으로 최종 제출됩니다. 계속할까요?`
      );
      if (!approved) return;
    }
    await saveConfig();
    await request("start", { method: "POST" });
    await refreshStatus();
  }));
  elements.runNowButton.addEventListener("click", () => perform(async () => {
    const date = elements.startDate.value;
    const selectedRooms = rooms.filter((room) => room.enabled).map((room) => room.name);
    const multiple = elements.bookingMode.value === "multiple";
    const modeText = multiple ? `여러 객실 동시 예약 (${selectedRooms.length}개)` : "1개 예약 · 우선순위 방식";
    const approved = window.confirm(
      `${date}부터 ${elements.nights.value}박 예약을 지금 즉시 실행합니다.\n\n예약 방식: ${modeText}\n예약 대상: ${selectedRooms.join(", ") || "선택 없음"}\n\n환불 규정 동의와 최종 예약하기까지 자동 진행됩니다. 실행할까요?`
    );
    if (!approved) return;
    await saveConfig();
    await request("run-now", { method: "POST" });
    await refreshStatus();
  }));
  elements.stopButton.addEventListener("click", () => perform(async () => {
    await request("stop", { method: "POST" });
    await refreshStatus();
  }));
  elements.inspectButton.addEventListener("click", () => perform(async () => {
    await saveConfig();
    showMessage("미니 PC에서 예약 페이지에 연결하고 있습니다.");
    const result = await request("inspect", { method: "POST", body: JSON.stringify({ startDate: elements.startDate.value, nights: Number(elements.nights.value) }) });
    renderInspection(result.rooms, { beforeOpen: isBeforeOpen(elements.startDate.value) });
    await refreshStatus();
  }));
  elements.reservationLookupButton.addEventListener("click", () => perform(async () => {
    const result = await request("reservations");
    renderReservations(result.reservations || []);
  }));
  elements.copyDiagnosticsButton.addEventListener("click", () => copyDiagnostics());
  elements.siteMapButton.addEventListener("click", () => elements.siteMapDialog.showModal());
  elements.siteMapCloseButton.addEventListener("click", () => elements.siteMapDialog.close());
  elements.siteMapDialog.addEventListener("click", (event) => {
    if (event.target === elements.siteMapDialog) elements.siteMapDialog.close();
  });
}

function loadConfig(config) {
  elements.startDate.value = config.startDate || "";
  elements.triggerAt.value = (config.triggerAt || "").slice(0, 19);
  elements.nights.value = String(config.nights || 1);
  elements.bookingMode.value = config.bookingMode === "multiple" ? "multiple" : "priority";
  elements.reserverName.value = config.profile?.reserverName || "";
  elements.depositorName.value = config.profile?.depositorName || "";
  elements.phone.value = config.profile?.phone || "";
  elements.birthDate.value = config.profile?.birthDate || "";
  rooms = Array.isArray(config.roomPriority) ? config.roomPriority : [];
  renderRooms();
  updateGeneratedValues();
}

function readConfig() {
  return {
    startDate: elements.startDate.value,
    triggerAt: elements.triggerAt.value,
    nights: Number(elements.nights.value),
    bookingMode: elements.bookingMode.value,
    roomPriority: rooms,
    profile: {
      reserverName: elements.reserverName.value.trim(),
      depositorName: elements.depositorName.value.trim(),
      phone: elements.phone.value.replace(/\D/g, ""),
      birthDate: elements.birthDate.value.replace(/\D/g, "")
    },
    autoFinalSubmit: true
  };
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
    row.innerHTML = `
      <div class="history-key"><strong>${escapeHtml(entry.startDate)} · ${entry.nights}박</strong><small>${multiple ? `동시 ${entry.enabledRooms.length}개 예약` : "1개 우선순위 예약"} · ${escapeHtml(savedAt)} 저장</small></div>
      <div class="history-rooms">${escapeHtml(roomsText)}</div>
      <div class="history-actions"><button class="load" type="button">불러오기</button><button class="delete" type="button">삭제</button></div>`;
    row.querySelector(".load").addEventListener("click", () => perform(async () => {
      const result = await request(`history/${encodeURIComponent(entry.id)}/load`, { method: "POST" });
      loadConfig(result.config);
      showMessage(`${entry.startDate} · ${entry.nights}박 설정을 불러왔습니다.`);
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
  const multiple = elements.bookingMode.value === "multiple";
  elements.roomSectionTitle.textContent = multiple ? "동시 예약할 객실" : "객실 우선순위";
  elements.roomSectionHelp.textContent = multiple
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
      <div class="room-name"><span class="room-rank">${room.enabled ? (multiple ? "예약" : `${rank}순위`) : "—"}</span>${escapeHtml(room.name)}<span class="availability ${availability || "unknown"}">${availabilityLabel}</span></div>
      <div class="move-buttons"><button type="button" data-move="up" ${index === 0 ? "disabled" : ""} aria-label="위로 이동">↑</button><button type="button" data-move="down" ${index === rooms.length - 1 ? "disabled" : ""} aria-label="아래로 이동">↓</button></div>`;
    row.querySelector("input").addEventListener("change", (event) => { room.enabled = event.target.checked; renderRooms(); });
    row.querySelector('[data-move="up"]').addEventListener("click", () => moveRoom(index, -1));
    row.querySelector('[data-move="down"]').addEventListener("click", () => moveRoom(index, 1));
    elements.roomList.append(row);
  });
}

function moveRoom(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= rooms.length) return;
  [rooms[index], rooms[target]] = [rooms[target], rooms[index]];
  renderRooms();
}

function updateGeneratedValues() {
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
  elements.reservationUrl.value = `http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim&adaystart=${epoch}`;
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
  return Number.isFinite(opensAt) && opensAt > Date.now();
}

function formatOpeningTime(startDate) {
  const opensAt = bookingOpenEpoch(startDate);
  if (!Number.isFinite(opensAt)) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(new Date(opensAt));
}

async function refreshStatus() {
  try {
    renderStatus(await request("status"));
  } catch (error) {
    if (!busy) showMessage(`상태 확인 실패: ${error.message}`, true);
  }
}

function renderStatus(status) {
  const state = status.state || "idle";
  currentState = state;
  elements.statusBadge.className = `badge ${state}`;
  elements.statusBadge.textContent = STATE_LABELS[state] || state;
  elements.statusText.textContent = status.message || "상태 정보가 없습니다.";
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
  const diagnosticText = status.diagnostics ? JSON.stringify(status.diagnostics, null, 2) : "";
  elements.diagnosticsPanel.hidden = !diagnosticText;
  elements.diagnosticsPreview.textContent = diagnosticText;
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

function renderInspection(result, { beforeOpen = false } = {}) {
  const displayed = result.map((room) => ({
    ...room,
    displayStatus: beforeOpen ? (room.available ? "available-before-open" : "unavailable-before-open")
      : room.status || (room.available ? "available" : "unavailable")
  }));
  for (const room of displayed) availabilityByRoom.set(room.name, room.displayStatus);
  renderRooms();
  elements.inspectResult.hidden = false;
  const opening = beforeOpen ? `<small>예약 가능 시작: ${escapeHtml(formatOpeningTime(elements.startDate.value))}</small><br>` : "";
  elements.inspectResult.innerHTML = `<strong>객실 확인 결과</strong><br>${opening}${displayed.map((room) => {
    const status = room.displayStatus;
    const label = ["available-before-open", "unavailable-before-open", "before-open", "booked"].includes(status)
      ? AVAILABILITY_LABELS[status]
      : room.available ? `${elements.nights.value}박 가능` : `${elements.nights.value}박 불가`;
    return `<span class="${escapeHtml(status)}">${escapeHtml(room.name)}: ${label}</span>`;
  }).join(" · ")}`;
}

function renderReservations(reservations) {
  elements.reservationList.hidden = false;
  elements.reservationList.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "예약 확인 및 취소";
  elements.reservationList.append(heading);
  if (!reservations.length) {
    const empty = document.createElement("p");
    empty.textContent = "예약 내역이 없습니다. 저장된 예약자명과 휴대폰 번호가 실제 예약 정보와 같은지 확인해 주세요.";
    elements.reservationList.append(empty);
    return;
  }
  for (const reservation of reservations) {
    const row = document.createElement("div");
    row.className = "reservation-row";
    row.innerHTML = `
      <div><strong>${escapeHtml(reservation.room)}</strong><span>${escapeHtml(reservation.stayDate)} · ${escapeHtml(reservation.nights)}</span></div>
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
        method: "POST", body: JSON.stringify({ confirmed: true })
      });
      renderReservations(result.reservations || []);
      showMessage(`${reservation.room} 예약 취소가 완료되었습니다.`, false, "예약 취소 완료");
    }));
    elements.reservationList.append(row);
  }
}

function scheduleAvailabilityCheck(delay = 500) {
  clearTimeout(availabilityTimer);
  availabilityTimer = setTimeout(() => refreshAvailability(), delay);
}

async function refreshAvailability() {
  const startDate = elements.startDate.value;
  const nights = Number(elements.nights.value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(nights)) return;
  const requestId = ++availabilityRequest;
  availabilityByRoom.clear();
  const beforeOpen = isBeforeOpen(startDate);
  if (["waiting", "running"].includes(currentState)) {
    if (beforeOpen) for (const room of rooms) availabilityByRoom.set(room.name, "before-open");
    renderRooms();
    return;
  }
  for (const room of rooms) availabilityByRoom.set(room.name, beforeOpen ? "checking-before-open" : "checking");
  renderRooms();
  try {
    const result = await request("inspect", { method: "POST", body: JSON.stringify({ startDate, nights }) });
    if (requestId !== availabilityRequest) return;
    renderInspection(result.rooms || [], { beforeOpen });
  } catch (error) {
    if (requestId !== availabilityRequest) return;
    availabilityByRoom.clear();
    if (beforeOpen) for (const room of rooms) availabilityByRoom.set(room.name, "before-open");
    renderRooms();
    if (!busy) showMessage(`객실 가능 여부 확인 실패: ${error.message}`, true);
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
  for (const button of [elements.inspectButton, elements.reservationLookupButton, elements.saveButton, elements.stopButton, elements.runNowButton, elements.startButton]) button.disabled = disabled;
  for (const button of elements.reservationList.querySelectorAll("button")) button.disabled = disabled;
}

function showMessage(message, error = false, successLabel = "저장 완료") {
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = error ? "확인 필요" : successLabel;
  elements.statusBadge.className = `badge ${error ? "failed" : "success"}`;
}

async function request(path, options = {}) {
  const response = await fetch(API(path), { headers: { "Content-Type": "application/json" }, ...options });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `요청 실패 (${response.status})`);
  return value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

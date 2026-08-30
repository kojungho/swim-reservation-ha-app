const API = (path) => new URL(`api/${path}`, document.baseURI).href;
const elements = Object.fromEntries([
  "startDate", "triggerAt", "nights", "epochValue", "reservationUrl", "roomList", "reserverName",
  "depositorName", "phone", "birthDate", "historyList", "statusBadge", "statusText", "statusDetails", "inspectResult",
  "diagnosticsPanel", "diagnosticsPreview", "copyDiagnosticsButton", "inspectButton", "saveButton", "stopButton", "runNowButton", "startButton"
].map((id) => [id, document.getElementById(id)]));

let rooms = [];
let busy = false;

init().catch((error) => showMessage(error.message, true));

async function init() {
  const config = await request("config");
  loadConfig(config);
  bindEvents();
  await refreshHistory();
  await refreshStatus();
  setInterval(refreshStatus, 1500);
}

function bindEvents() {
  elements.startDate.addEventListener("change", () => {
    updateGeneratedValues();
    elements.triggerAt.value = bookingOpenIso(elements.startDate.value);
  });
  elements.saveButton.addEventListener("click", () => perform(async () => {
    await saveConfig();
    showMessage("설정을 HA 미니 PC에 저장했습니다.");
  }));
  elements.startButton.addEventListener("click", () => perform(async () => {
    await saveConfig();
    await request("start", { method: "POST" });
    await refreshStatus();
  }));
  elements.runNowButton.addEventListener("click", () => perform(async () => {
    const date = elements.startDate.value;
    const selected = rooms.filter((room) => room.enabled).map((room) => room.name).join(", ");
    const approved = window.confirm(
      `${date}부터 ${elements.nights.value}박 예약을 지금 즉시 실행합니다.\n\n객실 우선순위: ${selected || "선택 없음"}\n\n환불 규정 동의와 최종 예약하기까지 자동 진행됩니다. 실행할까요?`
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
    const result = await request("inspect", { method: "POST" });
    renderInspection(result.rooms);
    await refreshStatus();
  }));
  elements.copyDiagnosticsButton.addEventListener("click", () => copyDiagnostics());
}

function loadConfig(config) {
  elements.startDate.value = config.startDate || "";
  elements.triggerAt.value = (config.triggerAt || "").slice(0, 19);
  elements.nights.value = String(config.nights || 1);
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
    const roomsText = entry.enabledRooms?.length ? entry.enabledRooms.join(" → ") : "선택된 객실 없음";
    row.innerHTML = `
      <div class="history-key"><strong>${escapeHtml(entry.startDate)} · ${entry.nights}박</strong><small>${escapeHtml(savedAt)} 저장</small></div>
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
  elements.roomList.replaceChildren();
  let rank = 0;
  rooms.forEach((room, index) => {
    if (room.enabled) rank += 1;
    const row = document.createElement("div");
    row.className = `room-row${room.enabled ? " enabled" : ""}`;
    row.innerHTML = `
      <label class="room-toggle"><input type="checkbox" ${room.enabled ? "checked" : ""} aria-label="${escapeHtml(room.name)} 선택"></label>
      <div class="room-name"><span class="room-rank">${room.enabled ? `${rank}순위` : "—"}</span>${escapeHtml(room.name)}</div>
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
    elements.reservationUrl.value = "";
    return;
  }
  const epoch = Math.floor(Date.parse(`${date}T00:00:00+09:00`) / 1000);
  elements.epochValue.textContent = String(epoch);
  elements.reservationUrl.value = `http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim&adaystart=${epoch}`;
}

function bookingOpenIso(startDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 3, 1));
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01T00:00:00`;
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
  const labels = { idle: "설정 중", waiting: "예약 대기", running: "자동 실행 중", success: "예약 완료", failed: "확인 필요", stopped: "중지됨" };
  elements.statusBadge.className = `badge ${state}`;
  elements.statusBadge.textContent = labels[state] || state;
  elements.statusText.textContent = status.message || "상태 정보가 없습니다.";
  const details = [];
  if (status.targetAt) details.push(["예약 실행 시각", new Date(status.targetAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })]);
  if (status.selectedRoom) details.push(["선택된 객실", status.selectedRoom]);
  if (status.stage) details.push(["진행 단계", status.stage]);
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

function renderInspection(result) {
  elements.inspectResult.hidden = false;
  elements.inspectResult.innerHTML = `<strong>객실 확인 결과</strong><br>${result.map((room) => `<span class="${room.available ? "available" : "unavailable"}">${escapeHtml(room.name)}: ${room.available ? `${elements.nights.value}박 가능` : `${elements.nights.value}박 불가`}</span>`).join(" · ")}`;
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
  for (const button of [elements.inspectButton, elements.saveButton, elements.stopButton, elements.runNowButton, elements.startButton]) button.disabled = disabled;
}

function showMessage(message, error = false) {
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = error ? "확인 필요" : "저장 완료";
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

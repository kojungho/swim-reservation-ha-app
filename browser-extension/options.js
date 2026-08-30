const ROOM_NAMES = [
  "해_하늘존", "달_하늘존", "별_하늘존", "빛_하늘존", "강_하늘존", "산_하늘존", "들_하늘존",
  "숲_하늘존", "샘_산맥존", "숨_산맥존", "꿈_산맥존", "솔_산맥존", "결_산맥존"
];

const elements = Object.fromEntries([
  "startDate", "targetUrl", "targetAt", "nights", "reserverName", "depositorName", "phone", "birthDate",
  "autoFinalSubmit", "roomList", "statusBadge", "statusText", "statusDetails",
  "saveButton", "startButton", "stopButton"
].map((id) => [id, document.getElementById(id)]));

let rooms = ROOM_NAMES.map((name) => ({ name, enabled: false }));

init();

async function init() {
  elements.saveButton.addEventListener("click", saveOnly);
  elements.startButton.addEventListener("click", startWaiting);
  elements.stopButton.addEventListener("click", stopWaiting);
  elements.startDate.addEventListener("change", () => {
    updateUrlFromStartDate();
    const suggested = bookingOpenTime(elements.startDate.value);
    if (suggested) elements.targetAt.value = toLocalInput(suggested);
  });
  if (!globalThis.chrome?.storage?.local) {
    elements.targetAt.value = toLocalInput(nextMonthStart());
    renderRooms();
    renderStatus({ state: "idle", message: "확장 프로그램으로 설치하면 설정 저장과 예약 실행이 활성화됩니다." });
    elements.saveButton.disabled = true;
    elements.startButton.disabled = true;
    elements.stopButton.disabled = true;
    return;
  }
  const { reservationConfig, reservationRun } = await chrome.storage.local.get(["reservationConfig", "reservationRun"]);
  if (reservationConfig) loadConfig(reservationConfig);
  else elements.targetAt.value = toLocalInput(nextMonthStart());
  renderRooms();
  renderStatus(reservationRun || { state: "idle", message: "설정을 저장한 뒤 예약 대기를 시작하세요." });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.reservationRun) renderStatus(changes.reservationRun.newValue || {});
  });
}

function loadConfig(config) {
  elements.targetUrl.value = config.targetUrl || "";
  elements.startDate.value = config.startDate || startDateFromUrl(config.targetUrl) || "";
  elements.targetAt.value = config.targetAt ? toLocalInput(new Date(Number(config.targetAt))) : toLocalInput(nextMonthStart());
  elements.nights.value = String(config.nights || 1);
  elements.reserverName.value = config.profile?.reserverName || "";
  elements.depositorName.value = config.profile?.depositorName || "";
  elements.phone.value = config.profile?.phone || "";
  elements.birthDate.value = config.profile?.birthDate || "";
  elements.autoFinalSubmit.checked = config.autoFinalSubmit !== false;
  if (Array.isArray(config.roomPriority) && config.roomPriority.length) {
    const known = new Map(config.roomPriority.map((room) => [room.name, room]));
    rooms = config.roomPriority
      .filter((room) => ROOM_NAMES.includes(room.name))
      .map((room) => ({ name: room.name, enabled: Boolean(room.enabled) }));
    for (const name of ROOM_NAMES) if (!known.has(name)) rooms.push({ name, enabled: false });
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
      <label class="room-toggle" title="우선순위에 포함">
        <input type="checkbox" ${room.enabled ? "checked" : ""} aria-label="${room.name} 선택">
      </label>
      <div class="room-name"><span class="room-rank">${room.enabled ? `${rank}순위` : "—"}</span>${room.name}</div>
      <div class="move-buttons">
        <button type="button" data-move="up" ${index === 0 ? "disabled" : ""} aria-label="위로 이동">↑</button>
        <button type="button" data-move="down" ${index === rooms.length - 1 ? "disabled" : ""} aria-label="아래로 이동">↓</button>
      </div>`;
    row.querySelector("input").addEventListener("change", (event) => {
      room.enabled = event.target.checked;
      renderRooms();
    });
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

function readConfig() {
  const phone = elements.phone.value.replace(/\D/g, "");
  const birthDate = elements.birthDate.value.replace(/\D/g, "");
  return {
    startDate: elements.startDate.value,
    targetUrl: normalizeUrl(elements.targetUrl.value.trim()),
    targetAt: new Date(elements.targetAt.value).getTime(),
    nights: Number(elements.nights.value),
    roomPriority: rooms.map((room) => ({ ...room })),
    profile: {
      reserverName: elements.reserverName.value.trim(),
      depositorName: elements.depositorName.value.trim(),
      phone,
      birthDate
    },
    autoFinalSubmit: elements.autoFinalSubmit.checked
  };
}

function validate(config, forStart = false) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate)) errors.push("숙박 시작 날짜");
  try {
    const url = new URL(config.targetUrl);
    if (url.hostname !== "newpension.logosweb.or.kr" || !url.pathname.endsWith("/reservation1.php")) throw new Error();
  } catch (_) {
    errors.push("시작일 예약 링크");
  }
  if (!config.roomPriority.some((room) => room.enabled)) errors.push("우선순위 객실");
  if (!config.profile.reserverName) errors.push("예약자명");
  if (!config.profile.depositorName) errors.push("입금자명");
  if (!/^01\d{8,9}$/.test(config.profile.phone)) errors.push("휴대폰 번호");
  if (!/^\d{8}$/.test(config.profile.birthDate)) errors.push("생년월일 8자리");
  if (forStart && (!Number.isFinite(config.targetAt) || config.targetAt <= Date.now())) errors.push("현재 이후의 실행 시각");
  return errors;
}

async function saveOnly() {
  const config = readConfig();
  const errors = validate(config, false);
  if (errors.length) return showLocalMessage(`확인할 항목: ${errors.join(", ")}`, true);
  await chrome.storage.local.set({ reservationConfig: config });
  showLocalMessage("설정을 이 컴퓨터에 저장했습니다.");
}

async function startWaiting() {
  const config = readConfig();
  const errors = validate(config, true);
  if (errors.length) return showLocalMessage(`확인할 항목: ${errors.join(", ")}`, true);
  await chrome.storage.local.set({ reservationConfig: config });
  const result = await chrome.runtime.sendMessage({ type: "ARM", config });
  if (!result?.ok) showLocalMessage(result?.error || "예약 대기를 시작하지 못했습니다.", true);
}

async function stopWaiting() {
  await chrome.runtime.sendMessage({ type: "STOP" });
}

function renderStatus(run) {
  const state = run.state || "idle";
  const labels = {
    idle: "설정 중", waiting: "예약 대기", running: "자동 실행 중", success: "예약 완료",
    failed: "확인 필요", stopped: "중지됨", "ready-manual": "마지막 확인 필요"
  };
  elements.statusBadge.className = `badge ${state}`;
  elements.statusBadge.textContent = labels[state] || state;
  elements.statusText.textContent = run.message || "상태 정보가 없습니다.";
  const details = [];
  if (run.targetAt) details.push(["예약 실행 시각", new Date(run.targetAt).toLocaleString("ko-KR")]);
  if (run.selectedRoom) details.push(["선택된 객실", run.selectedRoom]);
  if (run.stage) details.push(["진행 단계", run.stage]);
  if (run.lastDialog) details.push(["사이트 메시지", run.lastDialog]);
  if (run.updatedAt) details.push(["최근 갱신", new Date(run.updatedAt).toLocaleString("ko-KR")]);
  elements.statusDetails.replaceChildren(...details.flatMap(([term, description]) => {
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd"); dd.textContent = description;
    return [dt, dd];
  }));
}

function showLocalMessage(message, error = false) {
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = error ? "확인 필요" : "저장 완료";
  elements.statusBadge.className = `badge ${error ? "failed" : "success"}`;
}

function normalizeUrl(value) {
  if (value && !/^https?:\/\//i.test(value)) return `http://${value}`;
  return value;
}

function updateUrlFromStartDate() {
  const date = elements.startDate.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    elements.targetUrl.value = "";
    return;
  }
  const epochSeconds = Math.floor(Date.parse(`${date}T00:00:00+09:00`) / 1000);
  elements.targetUrl.value = `http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim&adaystart=${epochSeconds}`;
}

function startDateFromUrl(value) {
  try {
    const seconds = Number(new URL(value).searchParams.get("adaystart"));
    if (!Number.isFinite(seconds)) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(seconds * 1000));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_) {
    return "";
  }
}

function bookingOpenTime(startDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 3, 1, 0, 0, 0, 0);
}

function nextMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

function toLocalInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

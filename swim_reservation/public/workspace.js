let workspaceTab = "priority";
let editorGeneration = 0;
let planRegistrationPending = false;
let editingPlan = null;
let defaultRoomOrder = [];
let planEntries = [];
let planRefreshPending = false;
let planBatchPending = false;
const selectedExecutionPlans = new Set();
let lookupProfilesDraft = [];
let lookupProfilesInitialized = false;
let lookupProfilesLoading = null;

function initializeWorkspace() {
  defaultRoomOrder = rooms.map(room => room.name);
  document.addEventListener("input", event => {
    if (event.target.closest("#planCard,#roomList,#profilePriorities") || event.target.closest("section") === elements.reserverName.closest("section") || event.target.closest("section") === elements.startDate.closest("section")) editorGeneration++;
  });
  elements.monthlyDialog.classList.add("monthly-page");
  document.querySelector("main.shell").insertBefore(elements.monthlyDialog, document.querySelector("main.shell > aside"));
  const profilePage = elements.reserverName.closest("section");
  const roomPage = elements.roomList.closest("section");
  roomPage.before(profilePage);
  elements.runNowButton.closest("section").after(document.getElementById("planCard"));
  const logCard = document.getElementById("logCard");
  logCard.querySelector(".section-title").after(elements.statusDetails, elements.profileStatusList, elements.diagnosticsPanel);
  profilePage.querySelector("h3").before(elements.multipleProfileField, document.getElementById("watchProfileField"));
  const actions = document.createElement("div");
  actions.className = "actions lookup-site-controls";
  actions.append(elements.siteProfileSelect.closest("label"), elements.reservationSiteButton, elements.reservationLookupButton);
  document.getElementById("lookupCard").append(actions, elements.reservationList);
  elements.multipleProfileSelect.addEventListener("change", updateBookingProfileVisibility);
  document.getElementById("watchProfileSelect").addEventListener("change", updateBookingProfileVisibility);
  document.getElementById("addLookupProfileButton").addEventListener("click", () => {
    if (lookupProfilesDraft.length < 5) { lookupProfilesDraft.push({ reserverName: "", phone: "" }); renderLookupProfiles(); }
  });
  document.getElementById("saveLookupProfilesButton").addEventListener("click", () => perform(async () => {
    const profiles = lookupProfilesDraft.filter(profile => profile.reserverName.trim() || profile.phone.trim());
    const result = await request("lookup-profiles", { method: "PUT", body: JSON.stringify({ profiles }) });
    lookupProfilesDraft = result.profiles || [];
    lookupProfilesInitialized = true;
    renderLookupProfiles();
    document.getElementById("lookupMessage").textContent = "조회용 정보만 저장했습니다. 예약용 정보와 진행 중인 일정은 바뀌지 않습니다.";
    await loadReservations();
  }));
  document.getElementById("loadLookupProfilesButton").addEventListener("click", () => perform(async () => { await loadLookupProfiles(); await loadReservations(); }));
  document.querySelectorAll("[data-workspace-tab]").forEach(button => button.addEventListener("click", () => switchWorkspaceTab(button.dataset.workspaceTab)));
  const menuButton = document.getElementById("workspaceMenuButton");
  menuButton.addEventListener("click", () => setWorkspaceMenuOpen(menuButton.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("click", event => { if (!event.target.closest(".workspace-menu-floating")) setWorkspaceMenuOpen(false); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") { setWorkspaceMenuOpen(false); menuButton.focus(); } });
  document.getElementById("addPlanButton").addEventListener("click", () => registerPlan(workspaceTab === "watch" ? "watch" : "scheduled", false).catch(error => planMessage(error.message)));
  document.getElementById("cancelPlanEdit").addEventListener("click", () => { resetPlanEditor(); planMessage("수정을 취소했습니다. 저장된 일정은 변경되지 않았습니다."); });
  for (const [id, action, all] of [["startAllPlans", "start", true], ["startSelectedPlans", "start", false], ["stopSelectedPlans", "stop", false]]) {
    document.getElementById(id).addEventListener("click", () => batchPlanAction(action, all).catch(error => showMessage(error.message, true)));
  }
  document.getElementById("watchEndsAt").addEventListener("input", updateWatchDeadlineHint);
  for (const [id, enabled] of [["watchSelectAll", true], ["watchDeselectAll", false]]) document.getElementById(id).addEventListener("click", () => {
    const groups = workspaceTab !== "watch" && elements.bookingMode.value === "profiles-parallel" ? [firstProfilePriority, ...extraProfiles.map(profile => profile.roomPriority || [])] : [rooms];
    groups.forEach(items => items.forEach(room => { if (!enabled || canSelectRoom(room.name) || workspaceTab === "watch") room.enabled = enabled; }));
    editorGeneration++;
    renderRooms();
  });
  workspaceTab = elements.bookingMode.value;
  switchWorkspaceTab(workspaceTab, { keepEditor: true });
  void refreshPlans();
  setInterval(() => void refreshPlans(), 2500);
}

function seoulCurrentMonth() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
}
function setWorkspaceMenuOpen(open) {
  document.getElementById("workspaceMenu").hidden = !open;
  document.getElementById("workspaceMenuButton").setAttribute("aria-expanded", String(open));
  document.getElementById("workspaceMenuButton").setAttribute("aria-label", `${open ? "메뉴 닫기" : "메뉴 열기"} · ${document.getElementById("workspaceMenuLabel").textContent}`);
}

function seoulToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function switchWorkspaceTab(tab, { keepEditor = false } = {}) {
  const modes = ["priority", "multiple", "profiles-parallel"];
  if (![...modes, "watch", "people", "monthly", "book", "logs"].includes(tab)) return;
  const entering = workspaceTab !== tab;
  workspaceTab = tab;
  if (entering && !keepEditor) resetPlanEditor(tab);
  if (modes.includes(tab)) { elements.bookingMode.value = tab; renderRooms(); }
  if (tab === "watch") {
    elements.bookingMode.value = "priority";
    refreshWatchProfileSelector();
    renderWatchRooms();
  }
  document.querySelectorAll("[data-workspace-tab]").forEach(button => {
    const selected = button.dataset.workspaceTab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (selected) { button.setAttribute("aria-current", "page"); document.getElementById("workspaceMenuLabel").textContent = button.textContent; }
    else button.removeAttribute("aria-current");
  });
  setWorkspaceMenuOpen(false);
  const booking = modes.includes(tab) || tab === "watch";
  const profilePage = elements.reserverName.closest("section");
  for (const section of document.querySelectorAll("main.shell > section.card")) section.hidden = !booking;
  profilePage.hidden = !booking;
  document.getElementById("lookupCard").hidden = tab !== "people";
  document.getElementById("bookingBookCard").hidden = tab !== "book";
  document.getElementById("logCard").hidden = tab !== "logs";
  if (tab === "logs" && entering) void refreshLogs().catch(error => showMessage(`로그 조회 실패: ${error.message}`, true));
  document.getElementById("planCard").hidden = !booking;
  document.getElementById("planCard").classList.toggle("watch-mode", tab === "watch");
  document.getElementById("watchHelp").hidden = tab !== "watch";
  document.getElementById("watchInterval").closest("label").hidden = tab !== "watch";
  document.getElementById("watchEndsAtField").hidden = tab !== "watch";
  document.getElementById("watchProfileField").hidden = true;
  renderRoomSelectionControls();
  if (tab === "watch") elements.historyList.closest("section").hidden = true;
  elements.bookingMode.closest(".booking-mode-field").hidden = true;
  elements.triggerAt.closest("label").hidden = tab === "watch";
  document.getElementById("reservationConnectionDetails").hidden = tab === "watch";
  elements.siteClock.closest(".site-time-panel").hidden = tab === "watch";
  elements.startDate.closest("section").querySelector("h2").textContent = tab === "watch" ? "숙박 조건" : "예약 날짜와 시각";
  elements.startDate.closest("section").querySelector(".section-title p").textContent = tab === "watch" ? "감시할 숙박 시작 날짜와 박수를 지정하세요. 조건에 맞는 자리를 발견하면 바로 예약을 시도합니다." : "숙박 날짜·박수와 최종 예약을 제출할 시각을 지정하세요. 예약 모드는 상단 탭에서 선택합니다.";
  document.getElementById("addPlanButton").textContent = tab === "watch" ? "감시 일정 등록" : "예약 일정 등록";
  document.getElementById("addPlanButton").setAttribute("aria-label", tab === "watch" ? "현재 조건으로 취소 자리 감시 등록" : "현재 설정으로 예약 일정 등록");
  renderPlanEditMode();
  updateImmediateBookingVisibility();
  if (tab === "monthly") {
    if (!elements.monthlyDialog.open) {
      selectedMonthlyDate = null;
      elements.monthlyMonth.value = seoulCurrentMonth();
      elements.monthlyDialog.setAttribute("open", "");
      void loadMonthlyAvailability();
    }
  } else if (elements.monthlyDialog.open) elements.monthlyDialog.close();
  updateBookingProfileVisibility();
  document.querySelectorAll("main.shell > section.card:not([hidden]) .section-title > span").forEach((span, index) => { span.textContent = String(index + 1); });
  if (tab === "people" && entering) void (async () => {
    if (!lookupProfilesInitialized) await loadLookupProfiles();
    else refreshLookupSiteSelector();
    await loadReservations();
  })().catch(error => {
    elements.reservationList.hidden = false;
    elements.reservationList.textContent = `예약조회 실패: ${error.message}`;
  });
}

function updateBookingProfileVisibility() {
  const one = workspaceTab !== "profiles-parallel";
  const index = 0;
  elements.multipleProfileField.hidden = true;
  document.getElementById("firstBookingProfileTitle").hidden = one;
  document.getElementById("firstBookingProfileFields").hidden = one && index !== 0;
  [...elements.extraProfiles.children].forEach((panel, extraIndex) => { panel.hidden = one && index !== extraIndex + 1; panel.querySelector("button").hidden = one; });
  elements.addProfileButton.hidden = one;
  elements.profileModeHelp.textContent = workspaceTab === "profiles-parallel" ? "저장된 예약자를 사람별로 선택하거나 직접 입력하세요. 필요한 사람만 추가하며 최대 5명까지 각자의 객실 하나를 동시에 예약합니다. 새 사람은 예약자 저장으로 목록에 추가할 수 있습니다." : "저장된 예약자를 한 명 선택하거나 직접 입력하세요. 새 사람은 예약자 저장으로 목록에 추가할 수 있습니다. 목록은 자동으로 표시되지만 선택 전에는 정보를 입력하지 않습니다.";
}

async function loadLookupProfiles() {
  if (lookupProfilesLoading) return lookupProfilesLoading;
  lookupProfilesLoading = (async () => {
    const result = await request("lookup-profiles");
    lookupProfilesDraft = result.profiles || [];
    lookupProfilesInitialized = true;
    renderLookupProfiles();
  })();
  try { await lookupProfilesLoading; } finally { lookupProfilesLoading = null; }
}

function renderLookupProfiles() {
  if (!lookupProfilesDraft.length) lookupProfilesDraft = [{ reserverName: "", phone: "" }];
  const list = document.getElementById("lookupProfileList");
  list.replaceChildren();
  lookupProfilesDraft.forEach((profile, index) => {
    const panel = document.createElement("div");
    panel.className = "second-profile-panel lookup-profile-panel";
    const title = document.createElement("h3");
    title.textContent = `조회 대상 ${index + 1}`;
    const grid = document.createElement("div"); grid.className = "grid two lookup-fields";
    for (const [key, label] of [["reserverName", "예약자명"], ["phone", "휴대폰 번호"]]) {
      const field = document.createElement("label"); field.textContent = label;
      const input = document.createElement("input");
      input.id = `lookup${key}${index + 1}`;
      input.autocomplete = "off";
      if (key === "phone") input.inputMode = "numeric";
      input.value = profile[key] || "";
      input.addEventListener("input", () => { profile[key] = input.value; refreshLookupSiteSelector(); });
      field.append(input); grid.append(field);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary"; remove.textContent = "삭제";
    remove.setAttribute("aria-label", `조회 대상 ${index + 1} 삭제`);
    remove.addEventListener("click", () => { lookupProfilesDraft.splice(index, 1); renderLookupProfiles(); document.getElementById("lookupMessage").textContent = "저장·조회를 눌러 삭제 내용을 반영하세요. 실제 예약은 취소되지 않습니다."; });
    const header = document.createElement("div"); header.className = "profile-panel-heading";
    header.append(title, remove);
    panel.append(header, grid); list.append(panel);
  });
  document.getElementById("addLookupProfileButton").disabled = lookupProfilesDraft.length >= 5;
  refreshLookupSiteSelector();
}

function refreshLookupSiteSelector() {
  const select = elements.siteProfileSelect, previous = select.value;
  select.replaceChildren(...lookupProfilesDraft.map((profile, index) => {
    const option = document.createElement("option"); option.value = String(index + 1);
    option.textContent = `${index + 1}. ${profile.reserverName || "미입력"}`;
    return option;
  }));
  select.value = Number(previous) <= lookupProfilesDraft.length && previous ? previous : "1";
}

function planMessage(text) { document.getElementById("planMessage").textContent = shortRoomText(text); }
function renderPlanEditMode() {
  const button = document.getElementById("addPlanButton");
  button.textContent = editingPlan ? "수정 저장" : workspaceTab === "watch" ? "감시 일정 등록" : "예약 일정 등록";
  button.setAttribute("aria-label", editingPlan ? "기존 일정 수정 저장" : workspaceTab === "watch" ? "현재 조건으로 취소 자리 감시 등록" : "현재 설정으로 예약 일정 등록");
  document.getElementById("planEditNotice").hidden = !editingPlan;
  updateImmediateBookingVisibility();
}

function updateWatchDeadlineHint() {
  const custom = document.getElementById("watchEndsAt").value;
  document.getElementById("watchDeadlineHint").textContent = custom ? `직접 지정한 ${custom.replace("T", " ")}에 종료합니다 (한국 시간). 숙박 시작일 기본 마감보다 우선합니다.` : `기본 마감: ${elements.startDate.value ? `${elements.startDate.value} 00:00:00` : "숙박 시작일 00시"}. 당일 감시는 하지 않습니다. 당일 예약을 원하면 마감을 직접 지정하세요.`;
}

function resetPlanEditor(tab = workspaceTab) {
  editorGeneration++;
  editingPlan = null;
  renderPlanEditMode();
  roomDrag?.cancel?.();
  clearTimeout(availabilityTimer);
  availabilityController?.abort();
  availabilityRequest++;
  availabilityByRoom.clear();
  const names = [...new Set([...defaultRoomOrder, ...rooms.map(room => room.name)])];
  const mode = ["priority", "multiple", "profiles-parallel"].includes(tab) ? tab : elements.bookingMode.value;
  loadConfig({ startDate: "", triggerAt: "", nights: 1, bookingMode: mode, profiles: [{}], multipleProfileIndex: 0, editorProfileIndex: 0, roomPriority: names.map(name => ({ name, enabled: false })) });
  document.getElementById("planName").value = "";
  document.getElementById("watchInterval").value = "60";
  document.getElementById("watchEndsAt").value = "";
  updateWatchDeadlineHint();
  document.getElementById("watchProfileSelect").value = "0";
  document.getElementById("roomDragStatus").textContent = "";
  if (tab === "watch") refreshWatchProfileSelector();
  updateBookingProfileVisibility();
}

async function registerPlan(kind, start) {
  if (planRegistrationPending) throw new Error("일정을 등록 중입니다. 잠시 기다려 주세요.");
  const generation = editorGeneration, tab = workspaceTab, edit = editingPlan;
  if (edit && kind !== "watch") kind = edit.kind;
  const button = document.getElementById("addPlanButton");
  planRegistrationPending = true;
  button.disabled = true;
  try {
    let config = readConfig();
    if (config.bookingMode !== "profiles-parallel" || kind === "watch") {
      const index = kind === "watch" ? Number(document.getElementById("watchProfileSelect").value || 0) : config.multipleProfileIndex;
      const selected = { ...config.profiles[index], roomPriority: [] };
      config = { ...config, profiles: [selected], profile: selected, profile1: selected, profile2: {}, useSecondProfile: false, multipleProfileIndex: 0 };
    }
    const result = await request(edit ? `plans/${edit.id}` : "plans", { method: edit ? "PUT" : "POST", body: JSON.stringify({ name: document.getElementById("planName").value, kind, watchProfileIndex: 0, intervalSeconds: document.getElementById("watchInterval").value, watchEndsAt: kind === "watch" ? document.getElementById("watchEndsAt").value : "", config }) });
    if (!result.id) throw new Error("일정 등록 결과를 확인하지 못했습니다.");
    const cleared = generation === editorGeneration && tab === workspaceTab && !roomDrag;
    if (cleared) resetPlanEditor();
    if (start) {
      try { await request(`plans/${result.id}/start`, { method: "POST" }); }
      catch (error) { await refreshPlans(); throw new Error(`일정은 등록했지만 시작하지 못했습니다: ${error.message}. 목록에서 설정을 확인하세요.`); }
    }
    planMessage(`${edit ? "기존 일정 수정을 저장했습니다. 목록에서 시작을 눌러 다시 실행하세요." : start ? "독립 일정으로 실행했습니다." : "일정을 등록했습니다. 목록에서 시작을 누르면 실행됩니다."} ${cleared ? "입력란을 초기화했습니다." : "새로 편집한 입력 내용은 유지했습니다."}`);
    await refreshPlans();
  } finally { planRegistrationPending = false; button.disabled = false; }
}

async function refreshPlans() {
  if (planRefreshPending) return;
  planRefreshPending = true;
  try {
    const result = await request("plans");
    planEntries = result.entries || [];
    renderExecutionPlans();
    renderPlanBadge();
    const list = document.getElementById("planList");
    list.replaceChildren();
    if (!planEntries.length) { list.textContent = "등록된 일정이 없습니다."; return; }
    const modes = { priority: "1개 우선순위", multiple: "여러 객실 동시", "profiles-parallel": "예약자별 동시" };
    for (const entry of planEntries) {
      const row = document.createElement("div");
      row.className = "plan-entry";
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${entry.name} · ${entry.config.startDate} / ${entry.config.nights}박`;
      const info = document.createElement("p");
      info.textContent = `${entry.kind === "watch" ? `취소 자리 감시 (${entry.intervalSeconds}초) · 조건 일치 시 객실 하나 예약` : `${entry.kind === "now" ? "즉시 예약" : `예약 대기 ${entry.config.triggerAt.replace("T", " ")}`} · ${modes[entry.config.bookingMode]}`} · ${entry.enabled ? "진행 중" : "중지/종료"}`;
      if (entry.kind === "watch") info.textContent += ` · 마감 ${(entry.watchDeadlineAt || entry.watchEndsAt || `${entry.config.startDate}T00:00:00`).replace("T", " ")} (${entry.watchEndsAt ? "직접 지정" : "기본"})`;
      const status = document.createElement("p");
      status.textContent = shortRoomText(`${entry.status.message || "설정 완료"}${entry.status.lastCheckedAt ? ` · 마지막 확인 ${new Date(entry.status.lastCheckedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}`);
      const targets = document.createElement("div");
      targets.className = "plan-profile-targets";
      const profiles = entry.config.profiles || [entry.config.profile1 || entry.config.profile || {}];
      profiles.forEach((profile, index) => {
        const line = document.createElement("p");
        const candidates = entry.config.bookingMode === "profiles-parallel" && entry.kind !== "watch" ? profile.roomPriority || [] : entry.config.roomPriority;
        const names = roomSummaryText(candidates.filter(room => room.enabled).map(room => room.name), entry.kind !== "watch" && entry.config.bookingMode !== "multiple");
        line.textContent = `${profile.reserverName || `예약자 ${index + 1}`} : ${names || "선택된 객실 없음"}`;
        targets.append(line);
      });
      detail.append(title, info, targets, status);
      const controls = document.createElement("div");
      controls.className = "section-actions";
      for (const [action, label] of [["start", "시작"], ["stop", "중지"], ["edit", "수정"], ["load", "설정 불러오기"], ["delete", "목록 삭제"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = label;
        button.disabled = action === "start" && (entry.enabled || entry.status.stage === "expired" || ["failed", "success", "running"].includes(entry.status.state)) || ["load", "delete"].includes(action) && entry.enabled;
        if (action === "edit") button.disabled = entry.enabled || !["idle", "stopped"].includes(entry.status.state);
        if (action === "start" && editingPlan?.id === entry.id) button.disabled = true;
        if (planBatchPending) button.disabled = true;
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            if (action === "load" || action === "edit") {
              editorGeneration++;
              editingPlan = null;
              loadConfig(entry.config);
              switchWorkspaceTab(entry.kind === "watch" ? "watch" : entry.config.bookingMode, { keepEditor: true });
              editingPlan = action === "edit" ? { id: entry.id, kind: entry.kind } : null;
              renderPlanEditMode();
              document.getElementById("planName").value = entry.name;
              document.getElementById("watchEndsAt").value = entry.kind === "watch" ? entry.watchEndsAt || "" : "";
              document.getElementById("watchInterval").value = entry.intervalSeconds || 60;
              updateWatchDeadlineHint();
              scheduleAvailabilityCheck();
              planMessage(action === "edit" ? `${entry.name}: 입력 내용을 변경하고 수정 저장을 누르세요. 기존 일정만 갱신되며 자동 시작하지 않습니다.` : "새 일정 등록용으로 설정을 불러왔습니다.");
              elements.startDate.closest("section").scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
              if (action === "start" && !window.confirm(`${entry.name}\n${entry.config.startDate}부터 ${entry.config.nights}박 · ${entry.kind === "watch" ? "체크한 객실 중 조건에 맞는 하나 예약" : modes[entry.config.bookingMode]}\n${entry.kind === "watch" ? "조건이 맞는 자리가 나오면" : "지정 시각에"} 환불 규정 동의와 최종 예약 제출까지 자동 진행합니다. 다른 일정과 중복되는지 확인하셨나요?`)) return;
              if (action === "delete" && !window.confirm("이 일정을 목록에서 삭제할까요? 실제 예약은 취소되지 않습니다.")) return;
              const result = await request(`plans/${entry.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST", ...(action === "start" ? { body: JSON.stringify({ expectedRevision: entry.revision }) } : {}) });
              if (action === "delete" && editingPlan?.id === entry.id) resetPlanEditor();
              planMessage(result.status?.stage === "expired" ? result.status.message : `${entry.name}: ${label} 완료`);
            }
          } catch (error) { planMessage(error.message); }
          finally { await refreshPlans(); button.disabled = false; }
        });
        controls.append(button);
      }
      row.append(detail, controls);
      list.append(row);
    }
  } catch (error) { planMessage(`일정 조회 실패: ${error.message}`); }
  finally { planRefreshPending = false; }
}

function renderPlanBadge() {
  const active = planEntries.filter(entry => entry.enabled);
  if (!active.length) return;
  const running = active.some(entry => entry.status.state === "running");
  elements.statusBadge.className = `badge ${running ? "running" : "waiting"}`;
  elements.statusBadge.textContent = `${active.length}개 일정 ${running ? "실행 중" : "대기·감시 중"}`;
}
function planCanStart(entry) {
  return !entry.enabled && ["idle", "stopped"].includes(entry.status?.state || "idle") && entry.status?.stage !== "expired" && editingPlan?.id !== entry.id;
}
function planIsActive(entry) { return entry.enabled || ["running", "waiting"].includes(entry.status?.state); }
function renderExecutionPlans() {
  const list = document.getElementById("executionPlanList");
  if (!list) return;
  const knownIds = new Set(planEntries.map(entry => entry.id));
  for (const id of selectedExecutionPlans) if (!knownIds.has(id)) selectedExecutionPlans.delete(id);
  const focusId = list.contains(document.activeElement) ? document.activeElement.dataset.planId : null;
  list.replaceChildren();
  if (!planEntries.length) list.textContent = "등록된 일정이 없습니다. 아래에서 일정을 등록해 주세요.";
  for (const entry of planEntries) {
    const label = document.createElement("label"); label.className = `execution-plan${planIsActive(entry) ? " active-plan" : ""}`;
    const input = document.createElement("input"); input.type = "checkbox"; input.dataset.planId = entry.id;
    input.checked = selectedExecutionPlans.has(entry.id); input.disabled = planBatchPending;
    input.setAttribute("aria-label", `${entry.name} · ${entry.config.startDate} · ${entry.config.nights}박 선택`);
    input.addEventListener("change", () => { if (input.checked) selectedExecutionPlans.add(entry.id); else selectedExecutionPlans.delete(entry.id); renderExecutionPlans(); });
    const text = document.createElement("span");
    text.textContent = `${entry.name} · ${entry.config.startDate} / ${entry.config.nights}박`;
    const state = document.createElement("small"); state.textContent = planIsActive(entry) ? "진행 중" : entry.status?.state === "success" ? "완료" : entry.status?.state === "failed" ? "확인 필요" : "중지";
    label.append(input, text, state); list.append(label);
  }
  if (focusId) [...list.querySelectorAll("input")].find(input => input.dataset.planId === focusId)?.focus({ preventScroll: true });
  const blocked = busy || planBatchPending;
  const capacity = Math.max(0, 5 - planEntries.filter(planIsActive).length);
  document.getElementById("startAllPlans").disabled = blocked || !capacity || !planEntries.some(planCanStart);
  document.getElementById("startSelectedPlans").disabled = blocked || !capacity || !planEntries.some(entry => selectedExecutionPlans.has(entry.id) && planCanStart(entry));
  elements.stopButton.disabled = blocked || !planEntries.some(planIsActive) && !["waiting", "running"].includes(currentState);
  document.getElementById("stopSelectedPlans").disabled = blocked || !planEntries.some(entry => selectedExecutionPlans.has(entry.id) && planIsActive(entry));
}
async function batchPlanAction(action, all) {
  if (planBatchPending || busy) return;
  planBatchPending = true; renderExecutionPlans();
  try {
    const snapshot = (await request("plans")).entries || [];
    planEntries = snapshot; renderExecutionPlans();
    let targets = snapshot.filter(entry => (all || selectedExecutionPlans.has(entry.id)) && (action === "start" ? planCanStart(entry) : planIsActive(entry)));
    let limited = 0;
    if (action === "start") {
      const capacity = Math.max(0, 5 - planEntries.filter(planIsActive).length);
      limited = Math.max(0, targets.length - capacity); targets = targets.slice(0, capacity);
      if (!targets.length) return;
      const names = targets.map(entry => `${entry.name} · ${entry.config.startDate} / ${entry.config.nights}박`).join("\n");
      if (!window.confirm(`${names}\n\n위 ${targets.length}개 일정을 시작할까요? 예약 시각 또는 감시 조건이 맞으면 환불 규정 동의와 최종 예약까지 자동 진행합니다.${limited ? `\n동시 진행은 최대 5개여서 나머지 ${limited}개는 시작하지 않습니다.` : ""}`)) return;
    }
    let succeeded = 0; const failures = [];
    let legacyStop = Promise.resolve();
    if (action === "stop" && all) {
      clearTimeout(availabilityTimer); availabilityController?.abort(); availabilityRequest++;
      legacyStop = request("stop", { method: "POST" }).catch(error => failures.push(`기존 실행: ${error.message}`));
    }
    const runEntry = async entry => {
      try {
        const result = await request(`plans/${entry.id}/${action}`, { method: "POST", ...(action === "start" ? { body: JSON.stringify({ expectedRevision: entry.revision }) } : {}) });
        if (action === "start" && result.status && !["waiting", "running", "success"].includes(result.status.state)) failures.push(`${entry.name}: ${result.status.message || "일정이 시작되지 않았습니다. 최신 상태를 확인해 주세요."}`);
        else succeeded++;
      } catch (error) { failures.push(`${entry.name}: ${error.message}`); }
    };
    if (action === "stop") await Promise.all([legacyStop, ...targets.map(runEntry)]);
    else for (const entry of targets) await runEntry(entry);
    const message = `${action === "start" ? "시작" : "중지"} 완료 ${succeeded}개${limited ? ` · 동시 진행 제한으로 제외 ${limited}개` : ""}${failures.length ? ` · 실패 ${failures.length}개: ${failures.join(" / ")}` : ""}`;
    document.getElementById("executionBatchMessage").textContent = shortRoomText(message);
    await refreshPlans(); await refreshStatus();
    if (action === "stop" && all) scheduleAvailabilityCheck(0);
  } finally { planBatchPending = false; renderExecutionPlans(); }
}

function refreshWatchProfileSelector() {
  const select = document.getElementById("watchProfileSelect"), previous = select.value;
  select.replaceChildren(...readConfig().profiles.map((profile, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `예약자 ${index + 1}${profile.reserverName ? ` · ${profile.reserverName}` : ""}`;
    return option;
  }));
  select.value = [...select.options].some(option => option.value === previous) ? previous : "0";
}

function renderWatchRooms() {
  renderRoomSelectionControls();
  elements.roomSectionTitle.textContent = "감시할 객실";
  elements.roomSectionHelp.textContent = "원하는 객실을 체크만 하세요. 순위 없이 조건에 맞는 자리가 나오면 객실 하나를 예약합니다.";
  elements.roomList.hidden = false;
  elements.profilePriorities.hidden = true;
  elements.multipleProfileField.hidden = true;
  document.getElementById("roomDragHelp").hidden = true;
  document.getElementById("roomDragStatus").textContent = "";
  elements.roomList.replaceChildren();
  for (const room of rooms) {
    const row = document.createElement("div");
    row.className = `room-row${room.enabled ? " enabled" : ""}`;
    const state = availabilityByRoom.get(room.name) || "unknown";
    row.innerHTML = `<label class="room-toggle"><input type="checkbox" ${room.enabled ? "checked" : ""} aria-label="${escapeHtml(room.name)} 감시 대상"></label><div class="room-name">${escapeHtml(room.name)}<span class="availability ${state}">${AVAILABILITY_LABELS[state] || AVAILABILITY_LABELS.unknown}</span></div>`;
    row.querySelector("input").addEventListener("change", event => { room.enabled = event.target.checked; renderWatchRooms(); });
    elements.roomList.append(row);
  }
}

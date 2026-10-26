let workspaceTab = "priority";
let editorGeneration = 0;
let planRegistrationPending = false;
let editingPlan = null;
let defaultRoomOrder = [];
let planEntries = [];
let planRefreshPending = false;
let planBatchPending = false;
let selectedDetailPlan = null;
let planDetailPending = false;
const selectedExecutionPlans = new Set();
let lookupProfilesDraft = [];

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
  const historyCard = document.getElementById("historyCard");
  historyCard.querySelector(".section-title p").textContent = "일정을 등록한 뒤 선택해 시작·중지하세요. 일정명을 누르면 상세 내용과 수정·불러오기·삭제를 볼 수 있습니다. 최대 20개 저장, 5개 동시 진행.";
  historyCard.querySelector(".section-title").after(document.getElementById("planCard"));
  historyCard.append(elements.runNowButton.closest(".actions"), document.getElementById("executionPlanList"), document.getElementById("executionBatchMessage"));
  historyCard.append(elements.historyList);
  document.getElementById("executionCard").hidden = true;
  const logCard = document.getElementById("logCard");
  logCard.querySelector(".log-help").after(elements.statusDetails, elements.profileStatusList, elements.diagnosticsPanel);
  document.getElementById('firstBookingProfileTitle').closest('.profile-panel-heading').before(elements.multipleProfileField, document.getElementById("watchProfileField"));
  const actions = document.createElement("div");
  actions.className = "actions lookup-site-controls";
  const lookupControl = document.createElement("div"); lookupControl.className = "lookup-request-control";
  const spinner = document.createElement("span"); spinner.id = "reservationLookupSpinner"; spinner.className = "query-spinner"; spinner.hidden = true; spinner.setAttribute("role", "status"); spinner.setAttribute("aria-label", "예약 조회 중");
  lookupControl.append(elements.reservationLookupButton, spinner);
  actions.append(elements.siteProfileSelect.closest("label"), elements.reservationSiteButton, lookupControl);
  document.getElementById("savedLookupArea").append(actions, elements.reservationList);
  elements.multipleProfileSelect.addEventListener("change", updateBookingProfileVisibility);
  document.getElementById("watchProfileSelect").addEventListener("change", updateBookingProfileVisibility);
  initializeReservationLookup();
  document.getElementById("planDetailsClose").addEventListener("click", () => document.getElementById("planDetailsDialog").close());
  document.getElementById("planDetailsDialog").addEventListener("close", () => { if (!document.getElementById("planDetailsDialog").open) selectedDetailPlan = null; });
  document.getElementById("deleteSelectedPlans").addEventListener("click", () => deleteSelectedPlans().catch(error => showMessage(error.message, true)));
  document.querySelectorAll("[data-workspace-tab]").forEach(button => button.addEventListener("click", () => switchWorkspaceTab(button.dataset.workspaceTab)));
  const menuButton = document.getElementById("workspaceMenuButton");
  menuButton.addEventListener("click", () => setWorkspaceMenuOpen(menuButton.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("click", event => { if (!event.target.closest(".workspace-menu-floating")) setWorkspaceMenuOpen(false); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") { setWorkspaceMenuOpen(false); menuButton.focus(); } });
  document.getElementById("addPlanButton").addEventListener("click", () => registerPlan(workspaceTab === "watch" ? "watch" : "scheduled", false).catch(error => planMessage(error.message,true)));
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
  if (![...modes, "watch", "people", "monthly", "book", "logs", "settings"].includes(tab)) return;
  const entering = workspaceTab !== tab;
  if (entering && !keepEditor && typeof captureEditorDraft === 'function') captureEditorDraft();
  workspaceTab = tab;
  if (entering && !keepEditor && ["priority", "multiple", "profiles-parallel", "watch"].includes(tab)) {
    if (typeof draftsReady !== 'undefined' && draftsReady) restoreEditorDraft(tab);
    else resetPlanEditor(tab);
  }
  if (typeof updateEditorResetVisibility === 'function') updateEditorResetVisibility();
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
  document.getElementById("executionCard").hidden = true;
  profilePage.hidden = !booking;
  document.getElementById("lookupCard").hidden = tab !== "people";
  document.getElementById("bookingBookCard").hidden = tab !== "book";
  document.getElementById("logCard").hidden = tab !== "logs";
  document.getElementById("settingsCard").hidden = tab !== "settings";
  if (tab === "logs" && entering) void refreshLogs().catch(error => showMessage(`로그 조회 실패: ${error.message}`, true));
  document.getElementById("planCard").hidden = !booking;
  document.getElementById("planCard").classList.toggle("watch-mode", tab === "watch");
  document.getElementById("watchHelp").hidden = tab !== "watch";
  document.getElementById("watchInterval").closest("label").hidden = tab !== "watch";
  document.getElementById("watchEndsAtField").hidden = tab !== "watch";
  document.querySelector(".watch-settings-row").hidden = tab !== "watch";
  document.getElementById("watchProfileField").hidden = true;
  renderRoomSelectionControls();
  elements.bookingMode.closest(".booking-mode-field").hidden = true;
  elements.triggerAt.closest("label").hidden = tab === "watch";
  document.getElementById("reservationConnectionDetails").hidden = tab === "watch";
  elements.startDate.closest("section").querySelector("h2").textContent = tab === "watch" ? "숙박 조건" : "예약 날짜와 시각";
  elements.startDate.closest("section").querySelector(".section-title p").textContent = tab === "watch" ? "감시할 입실일과 숙박 기간을 지정하세요. 조건에 맞는 자리를 발견하면 바로 예약을 시도합니다." : "입실일·숙박 기간과 최종 예약을 제출할 시각을 지정하세요. 예약 모드는 상단 메뉴에서 선택합니다.";
  document.getElementById("addPlanButton").textContent = "일정 등록";
  document.getElementById("addPlanButton").setAttribute("aria-label", tab === "watch" ? "현재 조건으로 취소 대기 등록" : "현재 설정으로 일정 등록");
  renderPlanEditMode();
  updateImmediateBookingVisibility();
  if (typeof persistDrafts === 'function') persistDrafts();
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
    setReservationLookupLoading(1);
    try { await loadBookingBook(); refreshLookupSiteSelector(); await loadReservations(); }
    finally { setReservationLookupLoading(-1); }
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
  document.getElementById("firstBookingProfileTitle").textContent = elements.reserverName.value || "예약자 1";
  const firstPanel = document.getElementById("firstBookingProfilePanel");
  firstPanel.classList.toggle("second-profile-panel", !one);
  firstPanel.dataset.guestColor = !one ? "0" : "";
  document.getElementById("excludeFirstProfile").hidden = one || !extraProfiles.length;
  document.getElementById("firstBookingProfileFields").hidden = one && index !== 0;
  [...elements.extraProfiles.children].forEach((panel, extraIndex) => { panel.hidden = one && index !== extraIndex + 1; applyGuestColor(panel, extraIndex + 1); panel.querySelector(".profile-remove-button").hidden = one; });
  elements.addProfileButton.hidden = one;
  elements.profileModeHelp.textContent = workspaceTab === "profiles-parallel" ? `예약자 저장 목록에서 사람별로 선택하거나 직접 입력하세요. 객실 수 기준 최대 ${bookingGuestLimit()}명까지 각자의 객실 하나를 동시에 예약합니다. 인원·후보가 많으면 준비 시간과 메모리 사용량이 늘 수 있습니다.` : "저장된 예약자를 한 명 선택하거나 직접 입력하세요. 새 사람은 예약자 저장으로 목록에 추가할 수 있습니다. 목록은 자동으로 표시되지만 선택 전에는 정보를 입력하지 않습니다.";
}


function refreshLookupSiteSelector() {
  const select = elements.siteProfileSelect, previous = select.value;
  lookupProfilesDraft = bookingBook.map(bookingIdentity);
  select.replaceChildren(...lookupProfilesDraft.map((profile, index) => {
    const option = document.createElement("option"); option.value = String(index + 1);
    option.textContent = profile.reserverName || "미입력";
    return option;
  }));
  select.value = Number(previous) <= lookupProfilesDraft.length && previous ? previous : "1";
  elements.reservationSiteButton.disabled = !lookupProfilesDraft.length;
}

let oneOffLookupRequest = 0;
let oneOffLookupRunning = false;
function updateOneOffLookupButton() {
  document.getElementById("oneOffLookupButton").disabled = busy || oneOffLookupRunning || !document.getElementById("oneOffName").value.trim() || !/^01\d{8,9}$/.test(document.getElementById("oneOffPhone").value.replace(/\D/g, ""));
}
function initializeReservationLookup() {
  for (const id of ["oneOffName", "oneOffPhone"]) document.getElementById(id).addEventListener("input", updateOneOffLookupButton);
  document.getElementById("oneOffLookupButton").addEventListener("click", () => {
    const profile = { reserverName: document.getElementById("oneOffName").value.trim(), phone: document.getElementById("oneOffPhone").value.replace(/\D/g, "") };
    void lookupOneOff(profile);
  });
}
async function lookupOneOff(profile) {
  const id = ++oneOffLookupRequest;
  const container = document.getElementById("oneOffReservations");
  container.hidden = false; container.textContent = `${profile.reserverName} 조회 중…`;
  oneOffLookupRunning = true; updateOneOffLookupButton();
  try {
    const result = await request("reservations", { method: "POST", body: JSON.stringify({ profiles: [profile] }) });
    if (id !== oneOffLookupRequest) return;
    renderReservations(result.reservations || [], { container, profiles: [profile], errors: result.lookupErrors || [], reload: () => lookupOneOff(profile) });
  } catch (error) { if (id === oneOffLookupRequest){container.textContent="";window.showFloatingMessage?.(`조회 실패: ${error.message}`,{error:true});} }
  finally { if (id === oneOffLookupRequest) { oneOffLookupRunning = false; updateOneOffLookupButton(); } }
}

function planMessage(text,error=false) { const node=document.getElementById("planMessage");node.textContent=shortRoomText(text);node.hidden=error;if(error)window.showFloatingMessage?.(shortRoomText(text),{error:true}); }
function renderPlanEditMode() {
  const button = document.getElementById("addPlanButton");
  button.textContent = editingPlan ? "수정 저장" : "일정 등록";
  button.setAttribute("aria-label", editingPlan ? "기존 일정 수정 저장" : workspaceTab === "watch" ? "현재 조건으로 취소 대기 등록" : "현재 설정으로 일정 등록");
  document.getElementById("planEditNotice").hidden = !editingPlan;
  updateImmediateBookingVisibility();
}

function updateWatchDeadlineHint() {
  const custom = document.getElementById("watchEndsAt").value;
  document.getElementById("watchDeadlineHint").textContent = custom ? `직접 지정한 ${custom.replace("T", " ")}에 종료합니다 (한국 시간). 입실일 기본 마감보다 우선합니다.` : `기본 마감: ${elements.startDate.value ? `${elements.startDate.value} 00:00:00` : "입실일 00시"}. 당일 감시는 하지 않습니다. 당일 예약을 원하면 마감을 직접 지정하세요.`;
}

function resetPlanEditor(tab = workspaceTab) {
  document.getElementById("reservationConnectionDetails").open = false;
  document.getElementById("watchEndsAtDetails").open = false;
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
  if (typeof updateEditorResetVisibility === "function") updateEditorResetVisibility();
}

async function registerPlan(kind, start) {
  if (planRegistrationPending) throw new Error("일정을 등록 중입니다. 잠시 기다려 주세요.");
  const generation = editorGeneration, tab = workspaceTab, edit = editingPlan;
  const submittedDraft = editorSnapshot();
  const linkedDraft = editorDrafts[tab];
  if (!edit && linkedDraft?.completion && linkedDraft.completion.signature === draftSignature(submittedDraft)) {
    throw new Error('동일한 입력으로 이미 등록한 일정이 있습니다. 등록 목록에서 시작·결과를 확인하세요. 새 일정은 내용을 변경하거나 입력을 초기화한 뒤 등록해 주세요.');
  }
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
    if (edit && cleared) { editingPlan = null; submittedDraft.editingPlan = null; renderPlanEditMode(); }
    linkDraftToPlan(tab, result.id, submittedDraft);
    if (start) {
      try { await request(`plans/${result.id}/start`, { method: "POST" }); }
      catch (error) { await refreshPlans(); throw new Error(`일정은 등록했지만 시작하지 못했습니다: ${error.message}. 목록에서 설정을 확인하세요.`); }
    }
    planMessage(`${edit ? "기존 일정 수정을 저장했습니다. 목록에서 시작을 눌러 다시 실행하세요." : start ? "독립 일정으로 실행했습니다." : "일정을 등록했습니다. 목록에서 시작을 누르면 실행됩니다."} ${cleared ? "입력은 예약 완료까지 유지합니다." : "새로 편집한 입력 내용은 유지했습니다."}`);
    await refreshPlans();
  } finally { planRegistrationPending = false; button.disabled = false; }
}

async function refreshPlans() {
  if (planRefreshPending) return;
  planRefreshPending = true;
  try {
    const result = await request("plans");
    planEntries = result.entries || [];
    clearCompletedDrafts(planEntries);
    if (selectedDetailPlan && !planEntries.some(entry => entry.id === selectedDetailPlan)) document.getElementById("planDetailsDialog").close();
    renderExecutionPlans();
    renderPlanBadge();
    if (document.getElementById("planDetailsDialog").open && !selectedDetailPlan) return;
    const list = document.getElementById("planList");
    const focusedAction = list.contains(document.activeElement) ? document.activeElement.dataset.action : null;
    list.replaceChildren();
    if (!planEntries.length) { list.textContent = "등록된 일정이 없습니다."; return; }
    const modes = { priority: "단독 예약", multiple: "다중 예약", "profiles-parallel": "다인 예약" };
    for (const entry of planEntries) {
      if (selectedDetailPlan !== entry.id) continue;
      const row = document.createElement("div");
      row.className = "plan-entry";
      row.dataset.planId = entry.id;
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${entry.name} · ${entry.config.startDate} / ${entry.config.nights}박`;
      const info = document.createElement("p");
      info.textContent = `${entry.kind === "watch" ? `취소 대기 (${entry.intervalSeconds}초) · 조건 일치 시 객실 하나 예약` : `${entry.kind === "now" ? "즉시 예약" : `예약 대기 ${entry.config.triggerAt.replace("T", " ")}`} · ${modes[entry.config.bookingMode]}`} · ${entry.enabled ? "진행 중" : "중지/종료"}`;
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
      for (const result of entry.status.profileStatuses || []) {
        const line = document.createElement("p");
        const http = result.details?.navigation?.status;
        line.textContent = shortRoomText(`${result.room || result.label || `예약자 ${Number(result.index) + 1}`} · ${result.state || ""} · ${result.message || ""}${http ? ` · HTTP ${http}` : ""}${result.details?.page ? ` · ${result.details.page}` : ""}`);
        detail.append(line);
      }
      const controls = document.createElement("div");
      controls.className = "section-actions";
      for (const [action, label] of [["start", "시작"], ["stop", "중지"], ["edit", "수정"], ["load", "설정 불러오기"], ["delete", "삭제"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = label;
        button.dataset.action = action;
        button.disabled = action === "start" && !planCanStart(entry) || ["load", "delete"].includes(action) && planIsActive(entry) || action === "stop" && !planIsActive(entry);
        if (action === "edit") button.disabled = planIsActive(entry) || !["idle", "stopped"].includes(entry.status.state);
        if (action === "start" && editingPlan?.id === entry.id) button.disabled = true;
        if (planBatchPending || planDetailPending) button.disabled = true;
        button.addEventListener("click", async () => {
          if (planDetailPending || planBatchPending) return;
          planDetailPending = true;
          controls.querySelectorAll("button").forEach(control => { control.disabled = true; });
          button.disabled = true;
          try {
            if (action === "load" || action === "edit") {
              document.getElementById("planDetailsDialog").close();
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
              if (action === "start" && !window.confirm(`${entry.name}\n${entry.config.startDate}부터 ${entry.config.nights}박 · ${entry.kind === "watch" ? "체크한 객실 중 조건에 맞는 하나 예약" : modes[entry.config.bookingMode]}\n${planRunNotice(entry)}\n\n환불 규정 동의와 최종 예약 제출까지 자동 진행합니다. 다른 일정과 중복되는지 확인하셨나요?`)) return;
              if (action === "delete" && !window.confirm("이 일정을 목록에서 삭제할까요? 실제 예약은 취소되지 않습니다.")) return;
              const result = await request(`plans/${entry.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST", ...(action === "start" ? { body: JSON.stringify({ expectedRevision: entry.revision }) } : {}) });
              if (action === "delete") document.getElementById("planDetailsDialog").close();
              if (action === "delete" && editingPlan?.id === entry.id) resetPlanEditor();
              planMessage(result.status?.stage === "expired" ? result.status.message : `${entry.name}: ${label} 완료`);
            }
          } catch (error) { planMessage(error.message,true); document.getElementById("planDetailsMessage").textContent = error.message;document.getElementById("planDetailsMessage").hidden=true; }
          finally { planDetailPending = false; await refreshPlans(); }
        });
        controls.append(button);
      }
      row.append(detail, controls);
      list.append(row);
    }
    if (focusedAction) list.querySelector(`[data-action="${focusedAction}"]:not(:disabled)`)?.focus({ preventScroll: true });
  } catch (error) { planMessage(`일정 조회 실패: ${error.message}`,true); }
  finally { planRefreshPending = false; }
}

function renderPlanBadge() {
  const active = planEntries.filter(entry => entry.enabled);
  if (!active.length) return;
  const running = active.some(entry => entry.status.state === "running");
  elements.statusBadge.className = `badge ${running ? "running" : "waiting"}`;
  elements.statusBadge.textContent = `${active.length}개 일정 ${running ? "실행 중" : "대기·감시 중"}`;
}
function planStartTime(entry) {
  if (entry.kind === "watch") return "감시 시작: 시작 확인 후 바로 실행";
  if (entry.kind === "now") return "실행 예정: 시작 확인 후 바로 실행";
  return `실행 예정: ${String(entry.config.triggerAt || "미지정").replace("T", " ")} (한국 시간)`;
}
function planRunNotice(entry) {
  const timing = planStartTime(entry);
  const behavior = entry.kind === "watch"
    ? `${entry.intervalSeconds}초 간격으로 조회하며 빈자리 발견 시 예약합니다. 감시 종료: ${String(entry.watchDeadlineAt || entry.watchEndsAt || `${entry.config.startDate}T00:00:00`).replace("T", " ")} (한국 시간).`
    : "예약 엔진이 실행된 뒤 조회·입력·필수 동의와 최종 제출을 진행하므로 실제 제출·완료 시각은 달라질 수 있습니다.";
  return `${timing}\n${behavior}\n\nHA 서버에서 실행합니다. 서버 전원 꺼짐·절전, 애드온 중지·재시작, 인터넷 단절·예약 사이트 오류, 실행 시각 경과로 예약이 진행되지 않을 수 있습니다. 실행·예약 성공을 보장하지 않습니다.\n무통장입금 신청 후 입금은 직접 해야 합니다. 같은 예약을 폰 앱과 동시에 실행하지 마세요.`;
}
function planStateLabel(entry) {
  if (planIsActive(entry)) {
    if (entry.status?.stage === "prewarming") return "예약 준비 중";
    if (entry.status?.state === "running") return "예약 진행 중";
    return entry.kind === "watch" ? "취소 자리 감시 중" : "예약 대기 중";
  }
  return entry.status?.state === "success" ? "완료" : entry.status?.state === "failed" ? "결과 확인 필요" : "중지";
}
async function executionPlanAction(entry, action) {
  if (planDetailPending || planBatchPending || busy) return;
  if (action === "start" && !planCanStart(entry) || action === "stop" && !planIsActive(entry) || action === "delete" && planIsActive(entry)) return;
  if (action === "start" && !window.confirm(`${entry.name}\n${entry.config.startDate}부터 ${entry.config.nights}박\n\n${planRunNotice(entry)}\n\n이 일정을 시작할까요?`)) return;
  if (action === "delete" && !window.confirm("이 일정을 목록에서 삭제할까요? 실제 예약은 취소되지 않습니다.")) return;
  planDetailPending = true; renderExecutionPlans();
  try {
    const result = await request(`plans/${entry.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST", ...(action === "start" ? { body: JSON.stringify({ expectedRevision: entry.revision }) } : {}) });
    if (action === "delete" && editingPlan?.id === entry.id) resetPlanEditor();
    planMessage(result.status?.stage === "expired" ? result.status.message : `${entry.name}: ${{start:"시작",stop:"중지",delete:"삭제"}[action]} 완료`);
  } catch (error) { planMessage(error.message,true); }
  finally { planDetailPending = false; await refreshPlans(); }
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
    const label = document.createElement("div"); label.className = `execution-plan${planIsActive(entry) ? " active-plan" : ""}`; label.dataset.executionPlanId = entry.id;
    const input = document.createElement("input"); input.type = "checkbox"; input.dataset.planId = entry.id;
    input.checked = selectedExecutionPlans.has(entry.id); input.disabled = planBatchPending;
    input.setAttribute("aria-label", `${entry.name} · ${entry.config.startDate} · ${entry.config.nights}박 선택`);
    input.addEventListener("change", () => { if (input.checked) selectedExecutionPlans.add(entry.id); else selectedExecutionPlans.delete(entry.id); renderExecutionPlans(); });
    const text = document.createElement("button"); text.type = "button"; text.className = "plan-detail-open"; text.dataset.planId = entry.id;
    text.textContent = `${entry.name} · ${entry.config.startDate} / ${entry.config.nights}박`;
    text.setAttribute("aria-haspopup", "dialog");
    text.addEventListener("click", async () => {
      selectedDetailPlan = entry.id;
      document.getElementById("planList").textContent = "일정 정보를 불러오는 중…";
      document.getElementById("planDetailsTitle").textContent = entry.name;
      document.getElementById("planDetailsMessage").textContent = "";
      const dialog = document.getElementById("planDetailsDialog");
      if (!dialog.open) dialog.showModal();
      await refreshPlans();
    });
    const state = document.createElement("small"); state.textContent = `${bookingModeName(entry)} · ${planStateLabel(entry)}`;
    const timing = document.createElement("span"); timing.className = "execution-plan-time"; timing.textContent = planStartTime(entry);
    const progress = document.createElement("span"); progress.className = "execution-plan-progress"; progress.setAttribute("role", "status"); progress.textContent = entry.status?.message || "";
    const controls = document.createElement("div"); controls.className = "execution-plan-controls";
    for (const [action, title] of [["start", "시작"], ["stop", "중지"], ["delete", "삭제"]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = action === "delete" ? "danger" : "secondary"; button.textContent = title; button.dataset.planAction = action;
      button.disabled = busy || planBatchPending || planDetailPending || (action === "start" ? !planCanStart(entry) : action === "stop" ? !planIsActive(entry) : planIsActive(entry));
      button.addEventListener("click", () => void executionPlanAction(entry, action)); controls.append(button);
    }
    label.append(input, text, state, timing, progress, controls); list.append(label);
    label.addEventListener("click", event => { if (!event.target.closest("input,button")) text.click(); });
  }
  if (focusId) [...list.querySelectorAll("[data-plan-id]")].find(input => input.dataset.planId === focusId)?.focus({ preventScroll: true });
  const blocked = busy || planBatchPending;
  const capacity = Math.max(0, 5 - planEntries.filter(planIsActive).length);
  document.getElementById("startAllPlans").disabled = blocked || !capacity || !planEntries.some(planCanStart);
  document.getElementById("startSelectedPlans").disabled = blocked || !capacity || !planEntries.some(entry => selectedExecutionPlans.has(entry.id) && planCanStart(entry));
  elements.stopButton.disabled = blocked || !planEntries.some(planIsActive) && !["waiting", "running"].includes(currentState);
  document.getElementById("stopSelectedPlans").disabled = blocked || !planEntries.some(entry => selectedExecutionPlans.has(entry.id) && planIsActive(entry));
  document.getElementById("deleteSelectedPlans").disabled = blocked || !planEntries.some(entry => selectedExecutionPlans.has(entry.id) && planCanDeleteSelected(entry));
}

function bookingModeName(entry) { return entry.kind === "watch" ? "취소 대기" : ({ priority: "단독 예약", multiple: "다중 예약", "profiles-parallel": "다인 예약" })[entry.config?.bookingMode] || "단독 예약"; }
function planCanDeleteSelected(entry) { return !planIsActive(entry) && ["idle", "stopped"].includes(entry.status?.state || "idle"); }
async function deleteSelectedPlans() {
  if (busy || planBatchPending) return;
  planBatchPending = true; renderExecutionPlans();
  try {
    const snapshot = (await request("plans")).entries || [];
    const targets = snapshot.filter(entry => selectedExecutionPlans.has(entry.id) && planCanDeleteSelected(entry));
    if (!targets.length || !window.confirm(`${targets.map(entry => entry.name).join("\n")}\n\n중지된 ${targets.length}개 일정을 삭제할까요? 실제 예약은 취소되지 않습니다. 진행·완료·확인 필요 일정은 선택 삭제에서 제외합니다.`)) return;
    const failures = [];
    for (const entry of targets) {
      try { await request(`plans/${entry.id}`, { method: "DELETE" }); selectedExecutionPlans.delete(entry.id); }
      catch (error) { failures.push(`${entry.name}: ${error.message}`); }
    }
    document.getElementById("executionBatchMessage").textContent = `삭제 ${targets.length - failures.length}개${failures.length ? ` · 실패: ${failures.join(" / ")}` : ""}`;
    document.getElementById("executionBatchMessage").hidden=!!failures.length;if(failures.length)window.showFloatingMessage?.(document.getElementById("executionBatchMessage").textContent,{error:true});
    await refreshPlans();
  } finally { planBatchPending = false; renderExecutionPlans(); }
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
      const names = targets.map(entry => `${entry.name} · ${entry.config.startDate} / ${entry.config.nights}박\n${planRunNotice(entry)}`).join("\n\n");
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
    document.getElementById("executionBatchMessage").hidden=!!failures.length;if(failures.length)window.showFloatingMessage?.(shortRoomText(message),{error:true});
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
  elements.roomSectionTitle.textContent="사이트 선택";
  elements.roomSectionHelp.textContent="취소 대기할 사이트를 추가하세요. 마감된 사이트도 감시 후보로 지정할 수 있습니다.";
  elements.roomList.hidden=false;elements.profilePriorities.hidden=true;elements.multipleProfileField.hidden=true;
  document.getElementById("roomDragHelp").hidden=true;
  elements.roomList.replaceChildren(siteChoiceEditor(rooms));renderRoomSelectionControls();
}

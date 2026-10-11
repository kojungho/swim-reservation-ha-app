let workspaceTab = "priority";
let editorGeneration = 0;
let planRegistrationPending = false;
let defaultRoomOrder = [];
let planEntries = [];
let planRefreshPending = false;
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
  profilePage.querySelector("h3").before(elements.multipleProfileField, document.getElementById("watchProfileField"));
  elements.startDate.closest("section").querySelector(".section-title").append(elements.bookingHelpButton);
  const actions = document.createElement("div");
  actions.className = "actions";
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
  document.getElementById("addPlanButton").addEventListener("click", () => registerPlan(workspaceTab === "watch" ? "watch" : "scheduled", false).catch(error => planMessage(error.message)));
  workspaceTab = elements.bookingMode.value;
  switchWorkspaceTab(workspaceTab, { keepEditor: true });
  void refreshPlans();
  setInterval(() => void refreshPlans(), 2500);
}

function seoulCurrentMonth() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
}

function switchWorkspaceTab(tab, { keepEditor = false } = {}) {
  const modes = ["priority", "multiple", "profiles-parallel"];
  if (![...modes, "watch", "people", "monthly"].includes(tab)) return;
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
  });
  const booking = modes.includes(tab) || tab === "watch";
  const profilePage = elements.reserverName.closest("section");
  for (const section of document.querySelectorAll("main.shell > section.card")) section.hidden = !booking;
  profilePage.hidden = !booking;
  document.getElementById("lookupCard").hidden = tab !== "people";
  document.getElementById("planCard").hidden = !booking;
  document.getElementById("watchHelp").hidden = tab !== "watch";
  document.getElementById("watchInterval").closest("label").hidden = tab !== "watch";
  document.getElementById("watchProfileField").hidden = tab !== "watch";
  if (tab === "watch") elements.historyList.closest("section").hidden = true;
  elements.bookingMode.closest(".booking-mode-field").hidden = true;
  elements.bookingHelpButton.hidden = tab === "watch";
  elements.triggerAt.closest("label").hidden = tab === "watch";
  document.getElementById("reservationConnectionDetails").hidden = tab === "watch";
  elements.siteClock.closest(".site-time-panel").hidden = tab === "watch";
  elements.startDate.closest("section").querySelector("h2").textContent = tab === "watch" ? "숙박 조건" : "예약 날짜와 시각";
  elements.startDate.closest("section").querySelector(".section-title p").textContent = tab === "watch" ? "감시할 숙박 시작 날짜와 박수를 지정하세요. 조건에 맞는 자리를 발견하면 바로 예약을 시도합니다." : "숙박 날짜·박수와 최종 예약을 제출할 시각을 지정하세요. 예약 모드는 상단 탭에서 선택합니다.";
  document.getElementById("addPlanButton").textContent = tab === "watch" ? "현재 조건으로 취소 자리 감시 등록" : "현재 설정으로 예약 일정 등록";
  elements.startButton.hidden = tab === "watch";
  elements.runNowButton.hidden = tab === "watch";
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
  const index = workspaceTab === "watch" ? Number(document.getElementById("watchProfileSelect").value || 0) : Number(elements.multipleProfileSelect.value || 0);
  document.getElementById("firstBookingProfileTitle").hidden = one && index !== 0;
  document.getElementById("firstBookingProfileFields").hidden = one && index !== 0;
  [...elements.extraProfiles.children].forEach((panel, extraIndex) => { panel.hidden = one && index !== extraIndex + 1; panel.querySelector("button").hidden = one; });
  elements.addProfileButton.hidden = one;
  elements.profileModeHelp.textContent = workspaceTab === "watch" ? "감시할 예약자 한 명의 정보를 사용합니다. 체크한 객실 중 조건에 맞는 하나만 예약하며 순위는 지정하지 않습니다." : workspaceTab === "multiple" ? "선택한 한 명의 정보로 체크한 모든 객실을 각각 예약합니다. 객실 선호 순위는 지정하지 않습니다." : workspaceTab === "profiles-parallel" ? "최대 5명까지 정보를 입력한 뒤 아래에서 각자의 객실 우선순위를 정하세요. 한 사람당 객실 하나를 동시에 예약합니다." : "선택한 한 명의 정보로 우선순위 중 예약 가능한 객실 하나를 예약합니다. 여러 사람을 실행하려면 예약자별 동시 탭을 사용하세요.";
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
    panel.className = "second-profile-panel";
    const title = document.createElement("h3");
    title.textContent = `조회 대상 ${index + 1}`;
    const grid = document.createElement("div"); grid.className = "grid two";
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
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary"; remove.textContent = "조회 대상 삭제";
    remove.addEventListener("click", () => { lookupProfilesDraft.splice(index, 1); renderLookupProfiles(); document.getElementById("lookupMessage").textContent = "조회 정보 저장을 눌러 삭제 내용을 반영하세요. 실제 예약은 취소되지 않습니다."; });
    panel.append(title, grid, remove); list.append(panel);
  });
  document.getElementById("addLookupProfileButton").disabled = lookupProfilesDraft.length >= 5;
  refreshLookupSiteSelector();
}

function refreshLookupSiteSelector() {
  const select = elements.siteProfileSelect, previous = select.value;
  select.replaceChildren(...lookupProfilesDraft.map((profile, index) => {
    const option = document.createElement("option"); option.value = String(index + 1);
    option.textContent = `조회 대상 ${index + 1}${profile.reserverName ? ` · ${profile.reserverName}` : ""}`;
    return option;
  }));
  select.value = Number(previous) <= lookupProfilesDraft.length && previous ? previous : "1";
}

function planMessage(text) { document.getElementById("planMessage").textContent = text; }

function resetPlanEditor(tab = workspaceTab) {
  editorGeneration++;
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
  document.getElementById("watchProfileSelect").value = "0";
  document.getElementById("roomDragStatus").textContent = "";
  elements.inspectResult.hidden = true;
  elements.inspectResult.replaceChildren();
  if (tab === "watch") refreshWatchProfileSelector();
  updateBookingProfileVisibility();
}

async function registerPlan(kind, start) {
  if (planRegistrationPending) throw new Error("일정을 등록 중입니다. 잠시 기다려 주세요.");
  const generation = editorGeneration, tab = workspaceTab;
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
    const result = await request("plans", { method: "POST", body: JSON.stringify({ name: document.getElementById("planName").value, kind, watchProfileIndex: 0, intervalSeconds: document.getElementById("watchInterval").value, config }) });
    if (!result.id) throw new Error("일정 등록 결과를 확인하지 못했습니다.");
    const cleared = generation === editorGeneration && tab === workspaceTab && !roomDrag;
    if (cleared) resetPlanEditor();
    if (start) {
      try { await request(`plans/${result.id}/start`, { method: "POST" }); }
      catch (error) { await refreshPlans(); throw new Error(`일정은 등록했지만 시작하지 못했습니다: ${error.message}. 목록에서 설정을 확인하세요.`); }
    }
    planMessage(`${start ? "독립 일정으로 실행했습니다." : "일정을 등록했습니다. 목록에서 시작을 누르면 실행됩니다."} ${cleared ? "입력란을 초기화했습니다." : "새로 편집한 입력 내용은 유지했습니다."}`);
    await refreshPlans();
  } finally { planRegistrationPending = false; button.disabled = false; }
}

async function refreshPlans() {
  if (planRefreshPending) return;
  planRefreshPending = true;
  try {
    const result = await request("plans");
    planEntries = result.entries || [];
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
      const status = document.createElement("p");
      status.textContent = `${entry.status.message || "설정 완료"}${entry.status.lastCheckedAt ? ` · 마지막 확인 ${new Date(entry.status.lastCheckedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}`;
      const targets = document.createElement("p");
      const profiles = entry.config.profiles || [entry.config.profile1 || entry.config.profile || {}];
      const names = entry.kind === "watch" ? entry.config.roomPriority.filter(room => room.enabled).map(room => room.name).join(", ") : entry.config.bookingMode === "profiles-parallel" ? profiles.map((profile, index) => `${profile.reserverName || `예약자 ${index + 1}`}: ${(profile.roomPriority || []).filter(room => room.enabled).map(room => room.name).join(" → ")}`).join(" / ") : entry.config.roomPriority.filter(room => room.enabled).map(room => room.name).join(" → ");
      targets.textContent = `객실 조건: ${names} · 예약자 ${profiles.map(profile => profile.reserverName || "미입력").join(", ")}`;
      detail.append(title, info, targets, status);
      const controls = document.createElement("div");
      controls.className = "section-actions";
      for (const [action, label] of [["start", "시작"], ["stop", "중지"], ["load", "설정 불러오기"], ["delete", "목록 삭제"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = label;
        button.disabled = action === "start" && (entry.enabled || ["failed", "success", "running"].includes(entry.status.state)) || ["load", "delete"].includes(action) && entry.enabled;
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            if (action === "load") {
              let watchIndex = 0;
              if (entry.kind === "watch") {
                const current = readConfig().profiles, saved = entry.config.profiles[0];
                watchIndex = current.findIndex(profile => profile.reserverName === saved.reserverName && profile.phone === saved.phone && profile.birthDate === saved.birthDate);
                loadConfig({ ...entry.config, profiles: watchIndex >= 0 ? current : [saved, ...current].slice(0, 5) });
                if (watchIndex < 0) watchIndex = 0;
              } else loadConfig(entry.config);
              switchWorkspaceTab(entry.kind === "watch" ? "watch" : entry.config.bookingMode, { keepEditor: true });
              if (entry.kind === "watch") document.getElementById("watchProfileSelect").value = String(watchIndex);
              document.getElementById("planName").value = entry.name;
              scheduleAvailabilityCheck();
            } else {
              if (action === "start" && !window.confirm(`${entry.name}\n${entry.config.startDate}부터 ${entry.config.nights}박 · ${entry.kind === "watch" ? "체크한 객실 중 조건에 맞는 하나 예약" : modes[entry.config.bookingMode]}\n${entry.kind === "watch" ? "조건이 맞는 자리가 나오면" : "지정 시각에"} 환불 규정 동의와 최종 예약 제출까지 자동 진행합니다. 다른 일정과 중복되는지 확인하셨나요?`)) return;
              if (action === "delete" && !window.confirm("이 일정을 목록에서 삭제할까요? 실제 예약은 취소되지 않습니다.")) return;
              await request(`plans/${entry.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
              planMessage(`${entry.name}: ${label} 완료`);
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

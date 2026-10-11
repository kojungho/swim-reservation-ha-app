let workspaceTab = "priority";
const modeDrafts = new Map();
let planEntries = [];
let planRefreshPending = false;

function initializeWorkspace() {
  elements.monthlyDialog.classList.add("monthly-page");
  document.querySelector("main.shell").insertBefore(elements.monthlyDialog, document.querySelector("main.shell > aside"));
  const profilePage = elements.reserverName.closest("section");
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(elements.siteProfileSelect.closest("label"), elements.reservationSiteButton, elements.reservationLookupButton);
  profilePage.append(actions, elements.reservationList);
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
  if (modes.includes(workspaceTab)) modeDrafts.set(workspaceTab, readConfig());
  const entering = workspaceTab !== tab;
  workspaceTab = tab;
  if (modes.includes(tab) && !keepEditor) {
    const current = readConfig();
    loadConfig({ ...(modeDrafts.get(tab) || current), profiles: current.profiles, bookingMode: tab });
    scheduleAvailabilityCheck();
  }
  document.querySelectorAll("[data-workspace-tab]").forEach(button => {
    const selected = button.dataset.workspaceTab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const booking = modes.includes(tab) || tab === "watch";
  const profilePage = elements.reserverName.closest("section");
  for (const section of document.querySelectorAll("main.shell > section.card")) section.hidden = !booking;
  profilePage.hidden = tab !== "people";
  document.getElementById("planCard").hidden = !booking;
  document.getElementById("watchHelp").hidden = tab !== "watch";
  document.getElementById("watchInterval").closest("label").hidden = tab !== "watch";
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
  if (tab === "people" && entering) void loadReservations().catch(error => {
    elements.reservationList.hidden = false;
    elements.reservationList.textContent = `예약조회 실패: ${error.message}`;
  });
}

function planMessage(text) { document.getElementById("planMessage").textContent = text; }

async function registerPlan(kind, start) {
  const config = readConfig();
  const result = await request("plans", { method: "POST", body: JSON.stringify({ name: document.getElementById("planName").value, kind, intervalSeconds: document.getElementById("watchInterval").value, config }) });
  if (!result.id) throw new Error("일정 등록 결과를 확인하지 못했습니다.");
  if (start) await request(`plans/${result.id}/start`, { method: "POST" });
  planMessage(start ? "독립 일정으로 실행했습니다. 다른 일정도 추가할 수 있습니다." : "일정을 등록했습니다. 목록에서 시작을 누르면 실행됩니다.");
  await refreshPlans();
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
      info.textContent = `${entry.kind === "watch" ? `취소 자리 감시 (${entry.intervalSeconds}초)` : entry.kind === "now" ? "즉시 예약" : `예약 대기 ${entry.config.triggerAt.replace("T", " ")}`} · ${modes[entry.config.bookingMode]} · ${entry.enabled ? "진행 중" : "중지/종료"}`;
      const status = document.createElement("p");
      status.textContent = `${entry.status.message || "설정 완료"}${entry.status.lastCheckedAt ? ` · 마지막 확인 ${new Date(entry.status.lastCheckedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}`;
      const targets = document.createElement("p");
      const profiles = entry.config.profiles || [entry.config.profile1 || entry.config.profile || {}];
      const names = entry.config.bookingMode === "profiles-parallel" ? profiles.map((profile, index) => `${profile.reserverName || `예약자 ${index + 1}`}: ${(profile.roomPriority || []).filter(room => room.enabled).map(room => room.name).join(" → ")}`).join(" / ") : entry.config.roomPriority.filter(room => room.enabled).map(room => room.name).join(" → ");
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
              loadConfig(entry.config);
              switchWorkspaceTab(entry.kind === "watch" ? "watch" : entry.config.bookingMode, { keepEditor: true });
              document.getElementById("planName").value = entry.name;
              scheduleAvailabilityCheck();
            } else {
              if (action === "start" && !window.confirm(`${entry.name}\n${entry.config.startDate}부터 ${entry.config.nights}박 · ${modes[entry.config.bookingMode]}\n${entry.kind === "watch" ? "조건이 맞는 자리가 나오면" : "지정 시각에"} 환불 규정 동의와 최종 예약 제출까지 자동 진행합니다. 다른 일정과 중복되는지 확인하셨나요?`)) return;
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

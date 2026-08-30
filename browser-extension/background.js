const ALARM_NAME = "swim-reservation-start";
const TARGET_HOST = "newpension.logosweb.or.kr";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await beginReservation("alarm");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARM") {
    armReservation(message.config).then(sendResponse);
    return true;
  }
  if (message?.type === "STOP") {
    stopReservation().then(sendResponse);
    return true;
  }
  if (message?.type === "FIRE_NOW") {
    beginReservation("page-timer").then(sendResponse);
    return true;
  }
  if (message?.type === "INJECT_DIALOG_HANDLER") {
    if (!sender.tab?.id) return false;
    injectDialogHandler(sender.tab.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "STATUS") {
    updateStatus(message.patch).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function armReservation(config) {
  const targetAt = Number(config.targetAt);
  if (!Number.isFinite(targetAt) || targetAt <= Date.now()) {
    return { ok: false, error: "예약 시작 시각은 현재보다 뒤여야 합니다." };
  }

  const url = safeReservationUrl(config.targetUrl);
  if (!url) return { ok: false, error: "쉼오지 예약 링크를 확인해 주세요." };

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when: targetAt });
  chrome.power.requestKeepAwake("system");

  const tab = await findOrCreateReservationTab(url.href);
  await chrome.storage.local.set({
    reservationConfig: { ...config, targetUrl: url.href, targetAt },
    reservationRun: {
      state: "waiting",
      stage: "armed",
      tabId: tab.id,
      targetAt,
      updatedAt: Date.now(),
      message: "예약 시작 시각을 기다리는 중입니다."
    }
  });
  return { ok: true, tabId: tab.id };
}

async function beginReservation(source) {
  const { reservationConfig: config, reservationRun: run } =
    await chrome.storage.local.get(["reservationConfig", "reservationRun"]);
  if (!config || !["waiting", "running"].includes(run?.state)) {
    return { ok: false, error: "대기 중인 예약이 없습니다." };
  }

  if (source === "page-timer" && Date.now() < Number(config.targetAt) - 250) {
    return { ok: false, error: "아직 예약 시작 시각 전입니다." };
  }

  const url = safeReservationUrl(config.targetUrl);
  if (!url) return { ok: false, error: "예약 링크가 올바르지 않습니다." };

  let tab;
  try {
    tab = run.tabId ? await chrome.tabs.get(run.tabId) : null;
  } catch (_) {
    tab = null;
  }
  if (!tab) tab = await findOrCreateReservationTab(url.href);

  await updateStatus({
    state: "running",
    stage: "opening",
    tabId: tab.id,
    message: "예약 페이지를 새로 불러오는 중입니다.",
    startedAt: Date.now()
  });
  await chrome.tabs.update(tab.id, { active: true, url: url.href });
  return { ok: true };
}

async function stopReservation() {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.power.releaseKeepAwake();
  await updateStatus({
    state: "stopped",
    stage: "stopped",
    message: "사용자가 예약 실행을 중지했습니다."
  });
  return { ok: true };
}

async function findOrCreateReservationTab(url) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => {
    try {
      return new URL(tab.url).hostname === TARGET_HOST;
    } catch (_) {
      return false;
    }
  });
  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    return chrome.tabs.get(existing.id);
  }
  return chrome.tabs.create({ url, active: true });
}

async function injectDialogHandler(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      if (window.__swimMacroDialogsInstalled) return;
      window.__swimMacroDialogsInstalled = true;
      window.confirm = (message) => {
        document.dispatchEvent(new CustomEvent("swim-macro-dialog", {
          detail: { type: "confirm", message: String(message ?? "") }
        }));
        return true;
      };
      window.alert = (message) => {
        document.dispatchEvent(new CustomEvent("swim-macro-dialog", {
          detail: { type: "alert", message: String(message ?? "") }
        }));
      };
    }
  });
}

async function updateStatus(patch = {}) {
  const { reservationRun: current = {} } = await chrome.storage.local.get("reservationRun");
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ reservationRun: next });
  if (["success", "failed", "stopped", "ready-manual"].includes(next.state)) {
    await chrome.alarms.clear(ALARM_NAME);
    chrome.power.releaseKeepAwake();
  }
}

function safeReservationUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== TARGET_HOST) return null;
    if (!url.pathname.endsWith("/reservation1.php")) return null;
    if (url.searchParams.get("id") !== "swim" || !url.searchParams.get("adaystart")) return null;
    return url;
  } catch (_) {
    return null;
  }
}

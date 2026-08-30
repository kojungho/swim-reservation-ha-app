(async () => {
  const { reservationConfig: config, reservationRun: run } =
    await chrome.storage.local.get(["reservationConfig", "reservationRun"]);
  if (!config || !["waiting", "running"].includes(run?.state)) return;

  document.addEventListener("swim-macro-dialog", (event) => {
    const detail = event.detail || {};
    setStatus({
      lastDialog: detail.message,
      message: detail.type === "alert" ? `사이트 알림: ${detail.message}` : undefined
    });
  });
  await sendMessage({ type: "INJECT_DIALOG_HANDLER" });

  if (run.state === "waiting") {
    schedulePageTimer(Number(config.targetAt));
    return;
  }

  await domReady();
  await routePage(config, run);
})().catch((error) => {
  setStatus({ state: "failed", stage: "exception", message: error.message || String(error) });
});

function schedulePageTimer(targetAt) {
  const delay = targetAt - Date.now();
  if (delay <= 0) {
    sendMessage({ type: "FIRE_NOW" });
    return;
  }
  const tick = () => {
    const remaining = targetAt - Date.now();
    if (remaining <= 0) sendMessage({ type: "FIRE_NOW" });
    else setTimeout(tick, Math.min(remaining, remaining < 5000 ? 50 : 1000));
  };
  setTimeout(tick, Math.min(delay, 1000));
}

async function routePage(config, run) {
  const path = location.pathname.toLowerCase();
  const bodyText = clean(document.body?.innerText || "");

  if (/예약(이 | )?(완료|되었습니다)|예약번호/.test(bodyText) && !hasPersonalFields()) {
    await setStatus({ state: "success", stage: "complete", message: "사이트에서 예약 완료 화면을 확인했습니다." });
    return;
  }

  if (path.endsWith("/reservation1.php")) {
    await runRoomSelection(config);
    return;
  }

  if (hasPersonalFields()) {
    await runPersonalInfo(config);
    return;
  }

  if (/환불|취소.*규정|이용.*약관/.test(bodyText) || document.querySelector('input[type="checkbox"]')) {
    await runTermsStep();
    return;
  }

  await setStatus({
    state: "failed",
    stage: "unknown-page",
    message: `자동으로 판별하지 못한 화면입니다: ${document.title}`
  });
}

async function runRoomSelection(config) {
  const priorities = (config.roomPriority || []).filter((room) => room.enabled);
  if (!priorities.length) throw new Error("우선순위 객실이 선택되지 않았습니다.");

  const rows = [...document.querySelectorAll('input[type="checkbox"][name^="room_rid"]')]
    .map((checkbox) => {
      const row = checkbox.closest("tr");
      const match = checkbox.name.match(/\[(\d+)\]/);
      const index = match ? Number(match[1]) : -1;
      return {
        checkbox,
        row,
        index,
        text: clean(row?.innerText || ""),
        nights: document.querySelector(`select[name="daytype[${index}]"]`)
      };
    });

  let chosen = null;
  for (const priority of priorities) {
    const candidate = rows.find((row) => row.text.includes(clean(priority.name)));
    if (!candidate || !candidate.nights || candidate.checkbox.disabled) continue;
    const option = [...candidate.nights.options].find((item) => item.value === String(config.nights) && !item.disabled);
    if (!option) continue;
    chosen = candidate;
    break;
  }

  if (!chosen) {
    throw new Error(`${config.nights}박으로 예약 가능한 우선순위 객실이 없습니다.`);
  }

  chosen.checkbox.checked = true;
  chosen.checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  chosen.nights.value = String(config.nights);
  chosen.nights.dispatchEvent(new Event("change", { bubbles: true }));

  const roomName = priorities.find((item) => chosen.text.includes(clean(item.name)))?.name || chosen.text;
  await setStatus({
    stage: "room-selected",
    selectedRoom: roomName,
    message: `${roomName}, ${config.nights}박을 선택했습니다.`
  });

  const form = chosen.checkbox.form || document.forms.form1 || document.querySelector("form");
  if (!form) throw new Error("객실 선택 폼을 찾지 못했습니다.");
  form.action = new URL("order_ok1.php", location.href).href;
  HTMLFormElement.prototype.submit.call(form);
}

async function runTermsStep() {
  const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
    .filter((item) => !item.disabled);
  if (!checkboxes.length) throw new Error("환불 규정 동의 체크박스를 찾지 못했습니다.");

  for (const checkbox of checkboxes) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await setStatus({ stage: "terms-accepted", message: "환불·이용 규정에 동의했습니다." });

  const action = findAction(["동의하고", "다음", "예약 진행", "예약하기"]);
  if (action) {
    action.click();
    return;
  }
  const form = checkboxes[0].form || document.querySelector("form");
  if (!form) throw new Error("환불 규정 다음 단계 버튼을 찾지 못했습니다.");
  HTMLFormElement.prototype.submit.call(form);
}

async function runPersonalInfo(config) {
  const profile = config.profile || {};
  const used = new Set();
  fillLabeled(["예약자명", "예약자 이름", "예약자"], profile.reserverName, used, ["입금"]);
  fillLabeled(["입금자명", "입금자 이름", "입금자"], profile.depositorName, used);
  fillPhone(profile.phone, used);
  fillBirth(profile.birthDate, used);

  for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
    if (!checkbox.disabled) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  const missing = [];
  if (!profile.reserverName) missing.push("예약자명");
  if (!profile.depositorName) missing.push("입금자명");
  if (!profile.phone) missing.push("휴대폰 번호");
  if (!profile.birthDate) missing.push("생년월일");
  if (missing.length) throw new Error(`저장되지 않은 정보: ${missing.join(", ")}`);

  await setStatus({ stage: "personal-filled", message: "예약자 정보를 입력했습니다." });
  if (!config.autoFinalSubmit) {
    await setStatus({
      state: "ready-manual",
      stage: "ready-manual",
      message: "정보 입력을 마쳤습니다. 내용을 확인하고 예약하기를 직접 눌러 주세요."
    });
    return;
  }

  const action = findAction(["예약하기", "예약신청", "예약 완료", "예약완료"])
    || [...document.querySelectorAll('input[type="submit"], input[type="image"], button[type="submit"]')].pop();
  if (!action) throw new Error("최종 예약하기 버튼을 찾지 못했습니다.");
  await setStatus({ stage: "final-submit", message: "최종 예약을 전송하고 있습니다." });
  action.click();
}

function hasPersonalFields() {
  const text = clean(document.body?.innerText || "");
  return /예약자(명| 이름)?/.test(text) && /(입금자|휴대폰|생년월일)/.test(text);
}

function fillLabeled(labels, value, used, excluded = []) {
  if (!value) return false;
  const controls = editableControls();
  for (const control of controls) {
    if (used.has(control)) continue;
    const context = clean(control.closest("tr, p, li, div, td")?.innerText || "");
    const name = clean(`${control.name || ""} ${control.id || ""}`);
    const matches = labels.some((label) => context.includes(label)) || labels.some((label) => name.includes(label));
    if (!matches || excluded.some((word) => context.includes(word))) continue;
    setControlValue(control, value);
    used.add(control);
    return true;
  }
  return false;
}

function fillPhone(value, used) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return;
  const matches = editableControls().filter((control) => {
    const context = clean(control.closest("tr, p, li, div, td")?.innerText || "");
    const name = `${control.name || ""} ${control.id || ""}`.toLowerCase();
    return /휴대폰|핸드폰|연락처|전화번호/.test(context) || /(phone|mobile|tel|hp)/.test(name);
  }).filter((control) => !used.has(control));
  if (matches.length >= 3) {
    const parts = [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)];
    matches.slice(0, 3).forEach((control, index) => {
      setControlValue(control, parts[index]);
      used.add(control);
    });
  } else if (matches[0]) {
    setControlValue(matches[0], digits);
    used.add(matches[0]);
  }
}

function fillBirth(value, used) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (!digits) return;
  const matches = editableControls().filter((control) => {
    const context = clean(control.closest("tr, p, li, div, td")?.innerText || "");
    const name = `${control.name || ""} ${control.id || ""}`.toLowerCase();
    return /생년월일|생일/.test(context) || /(birth|birthday)/.test(name);
  }).filter((control) => !used.has(control));
  if (matches.length >= 3) {
    const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
    matches.slice(0, 3).forEach((control, index) => {
      setControlValue(control, parts[index]);
      used.add(control);
    });
  } else if (matches[0]) {
    setControlValue(matches[0], digits);
    used.add(matches[0]);
  }
}

function editableControls() {
  return [...document.querySelectorAll("input, select, textarea")].filter((control) => {
    const type = (control.type || "").toLowerCase();
    return !control.disabled && !["hidden", "checkbox", "radio", "button", "submit", "image", "reset"].includes(type);
  });
}

function setControlValue(control, value) {
  if (control.tagName === "SELECT") {
    const option = [...control.options].find((item) => item.value === value || clean(item.text) === clean(value));
    control.value = option ? option.value : value;
  } else {
    control.value = value;
  }
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function findAction(words) {
  const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="image"], img[onclick], a[onclick]')];
  return candidates.find((item) => {
    const label = clean(`${item.innerText || ""} ${item.value || ""} ${item.alt || ""} ${item.title || ""}`);
    return words.some((word) => label.includes(word));
  });
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function domReady() {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
}

async function setStatus(patch) {
  return sendMessage({ type: "STATUS", patch });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      void chrome.runtime.lastError;
      resolve(response);
    });
  });
}

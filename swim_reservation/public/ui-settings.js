const uiDefaults = {
  fonts: { title: 28, heading: 18, body: 14, field: 16, button: 13, room: 14, status: 12, calendar: 12, list: 14, log: 12 },
  serverTime: true, reservationInfo: true, safety: true, watchInfo: true, stayRange: true, dateInputVersion: 1,
  menuCorner: "top-right", mapCorner: "bottom-right", menuSpacing: 6, mapIcon: true, floatingSize: 46
};
let uiSettings = structuredClone(uiDefaults);
let galleryEntries = [], galleryActiveId = null, galleryBusy = false;
const gallerySelection = new Set();
const fontNames = { title: "앱 제목", heading: "구역 제목", body: "본문·안내", field: "입력칸·항목", button: "버튼·메뉴", room: "객실명", status: "상태 표시", calendar: "달력", list: "일정·조회 내역", log: "로그" };

async function initializeUiSettings() {
  const intervalInput = document.getElementById("finalSubmitInterval");
  const intervalMessage = document.getElementById("submissionSettingsMessage");
  try {
    const settings = await request("submission-settings");
    if (Number.isInteger(settings.intervalSeconds)) intervalInput.value = settings.intervalSeconds;
  } catch (error) { intervalMessage.textContent = `제출 간격 조회 실패: ${error.message}`; }
  document.getElementById("saveFinalSubmitInterval").addEventListener("click", async event => {
    if (!intervalInput.reportValidity()) return;
    event.target.disabled = true;
    try {
      const settings = await request("submission-settings", { method: "PUT", body: JSON.stringify({ intervalSeconds: intervalInput.valueAsNumber }) });
      intervalInput.value = settings.intervalSeconds;
      intervalMessage.textContent = `${settings.intervalSeconds === 0 ? "지연 미사용(0초)" : `${settings.intervalSeconds}초`}로 저장했습니다. 다인·다중 예약의 다음 실행부터 적용됩니다.`;
    } catch (error) { intervalMessage.textContent = `저장 실패: ${error.message}`; }
    finally { event.target.disabled = false; }
  });
  const controls = document.getElementById("settingsControls");
  const help = text => { const button = document.createElement("button"); button.type = "button"; button.className = "info-button"; button.textContent = "ⓘ"; button.dataset.settingsHelp = text; button.setAttribute("aria-label", "항목 설명"); return button; };
  const section = title => {
    const heading = document.createElement("h3"); heading.textContent = title;
    const grid = document.createElement("div"); grid.className = "settings-grid";
    controls.append(heading, grid); return grid;
  };
  const row = (grid, name, description, input) => {
    const wrapper = document.createElement("div"); wrapper.className = "setting-row";
    const label = document.createElement("label"); label.htmlFor = input.id; label.textContent = name;
    const title = document.createElement("div"); title.className = "setting-label";
    const info = help(description); info.setAttribute("aria-label", `${name} 설명`);
    title.append(label, info); wrapper.append(title, input); grid.append(wrapper);
  };
  const fonts = section("글자 크기");
  for (const [key, name] of Object.entries(fontNames)) {
    const input = document.createElement("input"); input.type = "number"; input.id = `font-${key}`; input.min = "10"; input.max = key === "title" ? "42" : "24"; input.step = "1"; input.value = uiSettings.fonts[key];
    input.required = true;
    input.addEventListener("input", () => { if (input.checkValidity() && input.value) { uiSettings.fonts[key] = Number(input.value); applyUiSettings(); } });
    row(fonts, name, `같은 종류의 글자를 함께 조절합니다. 단위는 px이며 10~${input.max} 사이로 설정하세요. 변경은 미리 반영되고 저장하면 모든 기기와 재시작 후에도 적용됩니다.`, input);
  }
  const displays = section("표시");
  for (const [key, name, description] of [
    ["mapIcon", "배치도 아이콘", "배치도 버튼의 아이콘을 켜거나 끕니다. 모바일에서는 이 설정과 관계없이 ‘배치도’ 글자만 표시합니다."],
    ["serverTime", "서버 시간", "상단의 서버 시간 시계를 표시합니다. 꺼도 서버 시간 동기화와 예약 실행은 유지됩니다."],
    ["reservationInfo", "예약 실행일·정보", "예약 화면의 실행일과 예약 링크 등 상세 정보를 표시합니다. 숨겨도 등록된 예약 시각과 설정은 유지됩니다."],
    ["safety", "안전 안내", "화면 아래의 안전한 운영 안내를 표시합니다. 인터넷에 App 포트를 직접 공개하지 말고 Home Assistant Ingress를 사용하세요."],
    ["watchInfo", "취소 대기 설정", "취소 대기의 조회 간격과 취소 객실 조회 종료일을 표시합니다. 숨겨도 입력한 간격과 종료 조건은 유지됩니다."],
    ["stayRange", "입실·퇴실 선택", "켜면 달력에서 입실일과 퇴실일을 선택하고 박수가 자동 계산됩니다. 끄면 기존 입실일·박수 선택 방식을 사용합니다. 최대 6박이며 퇴실일에는 숙박하지 않습니다. 기존 일정과 박수는 변경되지 않습니다."]
  ]) {
    const input = document.createElement("input"); input.type = "checkbox"; input.id = `setting-${key}`;
    input.addEventListener("change", () => { uiSettings[key] = input.checked; applyUiSettings(); });
    row(displays, name, description, input);
  }
  const positions = section("버튼 위치");
  for (const [key, name] of [["menuCorner", "메뉴"], ["mapCorner", "배치도"]]) {
    const select = document.createElement("select"); select.id = `setting-${key}`;
    for (const [value, label] of [["top-left", "상단 왼쪽"], ["top-right", "상단 오른쪽"], ["bottom-left", "하단 왼쪽"], ["bottom-right", "하단 오른쪽"]]) select.add(new Option(label, value));
    select.addEventListener("change", () => { uiSettings[key] = select.value; applyUiSettings(); });
    row(positions, name, "스크롤해도 선택한 모서리에 고정됩니다. 두 버튼의 위치가 같으면 간격을 두고 나란히 표시합니다.", select);
  }
  const spacing = document.createElement("input"); spacing.type = "number"; spacing.id = "setting-menuSpacing"; spacing.min = "0"; spacing.max = "16"; spacing.step = "1";
  spacing.required = true;
  spacing.addEventListener("input", () => { if (spacing.checkValidity() && spacing.value) { uiSettings.menuSpacing = Number(spacing.value); applyUiSettings(); } });
  row(positions, "메뉴 간격", "펼친 메뉴의 항목 간격과 안쪽 여백을 함께 조절합니다. 0~16 사이이며 작은 값은 메뉴가 더 촘촘해집니다.", spacing);
  const size = document.createElement("input"); size.type = "number"; size.id = "setting-floatingSize"; size.min = "44"; size.max = "64"; size.step = "1"; size.required = true;
  size.addEventListener("input", () => { if (size.checkValidity() && size.value) { uiSettings.floatingSize = Number(size.value); applyUiSettings(); } });
  row(positions, "플로팅 크기 (px)", "메뉴·배치도·맨 위로 버튼의 높이를 44~64px로 조절합니다. 글자 크기는 글자 크기 설정을 따릅니다.", size);
  document.getElementById("settingsSave").addEventListener("click", async event => {
    if (![...controls.querySelectorAll("input")].every(input => input.reportValidity())) return;
    event.target.disabled = true;
    try {
      uiSettings = await request("ui-settings", { method: "PUT", body: JSON.stringify(uiSettings) });
      applyUiSettings(); renderUiSettings(); document.getElementById("settingsMessage").textContent = "설정을 저장했습니다.";
    } catch (error) { document.getElementById("settingsMessage").textContent = `저장 실패: ${error.message}`; }
    finally { event.target.disabled = false; }
  });
  document.getElementById("settingsReset").addEventListener("click", () => {
    uiSettings = structuredClone(uiDefaults); renderUiSettings(); applyUiSettings();
    document.getElementById("settingsMessage").textContent = "기본값으로 변경했습니다. 저장을 누르면 유지됩니다.";
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-settings-help]"); if (!button) return;
    document.getElementById("settingsHelpText").textContent = button.dataset.settingsHelp;
    document.getElementById("settingsHelpDialog").showModal();
  });
  for (const [dialogId, buttonId] of [["settingsHelpDialog", "settingsHelpClose"], ["mapZoomDialog", "mapZoomClose"]]) {
    const dialog = document.getElementById(dialogId);
    document.getElementById(buttonId).addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  }
  document.getElementById("siteMapImage").addEventListener("click", () => zoomMap(document.getElementById("siteMapImage").src));
  document.getElementById("siteMapImage").addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); zoomMap(event.target.src); }
  });
  document.getElementById("galleryDeleteSelected").addEventListener("click", () => void deleteMapPhotos([...gallerySelection]));
  document.getElementById("galleryDeleteAll").addEventListener("click", () => void deleteMapPhotos(galleryEntries.map(entry => entry.id)));
  try {
    const saved = await request("ui-settings");
    uiSettings = { ...uiDefaults, ...saved, fonts: { ...uiDefaults.fonts, ...saved.fonts } };
    if(saved.dateInputVersion!==1){uiSettings.stayRange=true;uiSettings.dateInputVersion=1;}
  } catch (error) { document.getElementById("settingsMessage").textContent = `설정 조회 실패: ${error.message}`; }
  renderUiSettings(); applyUiSettings();
}

function renderUiSettings() {
  for (const key of Object.keys(fontNames)) document.getElementById(`font-${key}`).value = uiSettings.fonts[key];
  for (const key of ["serverTime", "reservationInfo", "safety", "watchInfo", "stayRange", "mapIcon"]) document.getElementById(`setting-${key}`).checked = uiSettings[key];
  for (const key of ["menuCorner", "mapCorner", "menuSpacing", "floatingSize"]) document.getElementById(`setting-${key}`).value = uiSettings[key];
}

function applyUiVisibility() {
  document.getElementById("serverTimeButton").hidden = !uiSettings.serverTime;
  document.getElementById("safetyNotice").hidden = !uiSettings.safety;
  document.getElementById("reservationConnectionDetails").hidden = !uiSettings.reservationInfo || workspaceTab === "watch";
  document.querySelector(".watch-settings-row").hidden = !uiSettings.watchInfo || workspaceTab !== "watch";
}

function applyUiSettings() {
  document.documentElement.style.setProperty("--floating-size", `${uiSettings.floatingSize}px`);
  document.querySelector(".site-map-icon").toggleAttribute("hidden", !uiSettings.mapIcon);
  for (const [key, value] of Object.entries(uiSettings.fonts)) document.documentElement.style.setProperty(`--font-${key}`, `${value}px`);
  document.documentElement.style.setProperty("--menu-gap", `${uiSettings.menuSpacing}px`);
  document.documentElement.style.setProperty("--menu-padding", `${4 + uiSettings.menuSpacing}px`);
  document.documentElement.style.setProperty("--menu-row-height", `${32 + uiSettings.menuSpacing * 2}px`);
  const menu = document.querySelector(".workspace-menu-floating"), map = document.getElementById("siteMapButton");
  // Keep the independent fixed buttons in their established defaults; group only when sharing a corner.
  const same = uiSettings.menuCorner === uiSettings.mapCorner;
  menu.dataset.corner = uiSettings.menuCorner; map.dataset.corner = uiSettings.mapCorner;
  map.classList.toggle("floating-paired", same);
  menu.classList.toggle("floating-paired", same);
  const width = map.getBoundingClientRect().width || 48;
  menu.style.setProperty("--paired-width", `${width + 8}px`);
  updateScrollTopButton();
  applyUiVisibility();
  updateStayFields();
}

function updateScrollTopButton() {
  const button = document.getElementById("scrollTopButton");
  if (!button) return;
  button.hidden = window.scrollY < 240;
  if (button.hidden) return;
  button.style.removeProperty("--scroll-top-lift");
  const target = button.getBoundingClientRect();
  const overlaps = [document.getElementById("siteMapButton"), document.getElementById("workspaceMenuButton")].some(el => {
    const rect = el.getBoundingClientRect();
    return rect.left < target.right + 8 && rect.right > target.left - 8 && rect.top < target.bottom + 8 && rect.bottom > target.top - 8;
  });
  if (overlaps) button.style.setProperty("--scroll-top-lift", `${uiSettings.floatingSize + 12}px`);
}
window.addEventListener("scroll", updateScrollTopButton, { passive: true });
document.getElementById("scrollTopButton").addEventListener("click", () => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));

function stayEndDate(start, nights) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
  const value = new Date(`${start}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(nights));
  return value.toISOString().slice(0, 10);
}

function updateStayFields(force = false) {
  const checkout = document.getElementById("checkoutDate");
  const end = stayEndDate(elements.startDate.value, Number(elements.nights.value) || 1);
  if (force || checkout.dataset.derived !== end) { checkout.value = end; checkout.dataset.derived = end; }
  document.getElementById("checkoutField").hidden = !uiSettings.stayRange;
  document.getElementById("nightsField").hidden = uiSettings.stayRange;
  document.getElementById("stayNightsDisplay").hidden = !uiSettings.stayRange;
  document.getElementById("stayNightsDisplay").textContent = elements.startDate.value ? `${elements.nights.value}박` : "—";
  const opening = bookingOpenIso(elements.startDate.value);
  const badge = document.getElementById("stayOpeningDate");
  badge.hidden = !opening || !(Date.parse(`${opening}+09:00`) > currentSiteTime());
  if (opening) {
    const date = document.createElement("time"); date.dateTime = opening.slice(0, 10); date.textContent = date.dateTime;
    badge.replaceChildren(document.createTextNode("예약 오픈일 "), date);
  } else badge.replaceChildren();
  badge.title = opening ? `예약 오픈일 ${opening.slice(0, 10)}` : "";
  badge.setAttribute("aria-label", badge.title);
}

function setMonthlyLoading(loading) {
  document.getElementById("monthlyQueryButton").disabled = loading;
  document.getElementById("monthlyQuerySpinner").hidden = !loading;
  document.getElementById("monthlyContent").setAttribute("aria-busy", String(loading));
}

function zoomMap(url) {
  document.getElementById("mapZoomImage").src = url;
  document.getElementById("mapZoomDialog").showModal();
}

async function loadMapGallery() {
  const state = await request("site-map/gallery");
  galleryEntries = state.entries || []; galleryActiveId = state.activeId || null;
  for (const id of gallerySelection) if (!galleryEntries.some(entry => entry.id === id)) gallerySelection.delete(id);
  renderMapGallery();
}

function renderMapGallery() {
  const grid = document.getElementById("mapGallery"); grid.replaceChildren();
  document.getElementById("galleryCount").textContent = `${galleryEntries.length}/6`;
  galleryEntries.forEach((entry, index) => {
    const card = document.createElement("article"); card.className = "gallery-photo";
    const label = document.createElement("label"); label.className = "gallery-select";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = gallerySelection.has(entry.id); checkbox.disabled = galleryBusy;
    checkbox.addEventListener("change", () => { if (checkbox.checked) gallerySelection.add(entry.id); else gallerySelection.delete(entry.id); updateGalleryActions(); });
    label.append(checkbox, document.createTextNode(`사진 ${index + 1}${entry.id === galleryActiveId ? " · 적용 중" : ""}`));
    const preview = document.createElement("button"); preview.type = "button"; preview.className = "gallery-preview"; preview.setAttribute("aria-label", `사진 ${index + 1} 확대`);
    const img = document.createElement("img"); img.src = API(`site-map/gallery/${entry.id}`); img.alt = `사이트 위치 사진 ${index + 1}`; preview.append(img); preview.addEventListener("click", () => zoomMap(img.src));
    const actions = document.createElement("div"); actions.className = "actions";
    const apply = document.createElement("button"); apply.type = "button"; apply.className = "secondary"; apply.textContent = "적용"; apply.disabled = galleryBusy || entry.id === galleryActiveId;
    apply.addEventListener("click", () => void mapGalleryAction(async () => { await request(`site-map/gallery/${entry.id}`, { method: "POST", body: "{}" }); }, "안내 사진을 변경했습니다."));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "삭제"; remove.disabled = galleryBusy; remove.addEventListener("click", () => void deleteMapPhotos([entry.id]));
    actions.append(apply, remove); card.append(label, preview, actions); grid.append(card);
  });
  const add = document.createElement("button"); add.id = "galleryAddButton"; add.type = "button"; add.className = "gallery-add";
  add.setAttribute("aria-label", "배치도 사진 추가");
  const plus = document.createElement("span"); plus.className = "gallery-add-symbol"; plus.textContent = "＋"; plus.setAttribute("aria-hidden", "true");
  const caption = document.createElement("span"); caption.textContent = galleryEntries.length >= 6 ? "6장 가득 참" : "추가";
  add.append(plus, caption); add.addEventListener("click", () => { if (!add.disabled) elements.siteMapFile.click(); }); grid.append(add);
  updateGalleryActions();
}

function updateGalleryActions() {
  document.getElementById("galleryDeleteSelected").disabled = galleryBusy || !gallerySelection.size;
  document.getElementById("galleryDeleteAll").disabled = galleryBusy || !galleryEntries.length;
  elements.siteMapUploadButton.disabled = galleryBusy || galleryEntries.length >= 6;
  const add = document.getElementById("galleryAddButton"); if (add) add.disabled = galleryBusy || galleryEntries.length >= 6;
}

async function deleteMapPhotos(ids) {
  if (galleryBusy || !ids.length || !confirm(`사진 ${ids.length}개를 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
  await mapGalleryAction(() => request("site-map/gallery", { method: "DELETE", body: JSON.stringify({ ids }) }), `사진 ${ids.length}개를 삭제했습니다. 삭제한 사진은 복구할 수 없습니다.`);
}

async function mapGalleryAction(action, message) {
  if (galleryBusy) return;
  galleryBusy = true; renderMapGallery();
  try {
    await action(); await loadMapGallery();
    elements.siteMapImage.src = `${API("site-map")}?v=${Date.now()}`;
    elements.siteMapMessage.textContent = message;
  } catch (error) { elements.siteMapMessage.textContent = `사진 변경 실패: ${error.message}`; }
  finally { galleryBusy = false; renderMapGallery(); }
}

window.addEventListener("resize", () => { if (document.getElementById("settingsControls")?.children.length) applyUiSettings(); });

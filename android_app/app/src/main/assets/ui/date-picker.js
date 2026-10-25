// Reused unchanged from the add-on calendar; phone.js supplies its state/helpers.
function initializeDatePicker() {
  const dialog = document.getElementById("datePickerDialog");
  const get = name => document.getElementById(`datePicker${name}`);
  let target = null, month = "", selected = "", rangeMode = false, rangeStart = "", rangeEnd = "", rangePhase = "start";
  const eligible = input => input instanceof HTMLInputElement && ["date", "datetime-local", "month"].includes(input.type) && !input.disabled && !input.readOnly;
  const shift = delta => {
    const [year, number] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, number - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const allowedMonth = value => value >= (target.min.slice(0, 7) || "0001-01") && value <= (target.max.slice(0, 7) || "9999-12");
  const availabilityEnabled = () => ["startDate", "checkoutDate"].includes(target?.id) && window.stayCalendar;
  const isWatch = () => typeof workspaceTab !== "undefined" && workspaceTab === "watch";
  const canChoose = value => !availabilityEnabled() || !window.stayCalendar.pending.has(month) && !window.stayCalendar.pending.has(rangeStart.slice(0,7)) && window.stayCalendar.allow(value, rangeMode ? rangePhase : target.id === "checkoutDate" ? "end" : "start", rangeStart, isWatch());
  let loadGeneration = 0;
  const help = document.createElement("p"); help.className = "date-picker-availability"; get("Days").after(help);
  function loadCounts() {
    if (!availabilityEnabled()) return;
    const generation = ++loadGeneration, displayed = month;
    help.textContent = "예약 현황 조회 중…";
    const loading = Promise.all([...new Set([month, ...(rangePhase === "end" && rangeStart ? [rangeStart.slice(0, 7)] : [])])].map(value => window.stayCalendar.load(value))).then(() => {
      if (!dialog.open || generation !== loadGeneration || displayed !== month) return;
      render();
    });
    render();help.textContent = "예약 현황 조회 중…";
  }
  function render() {
    const [year, number] = month.split("-").map(Number);
    get("Month").textContent = `${year}년 ${number}월`;
    get("Prev").disabled = !allowedMonth(shift(-1));
    get("Next").disabled = !allowedMonth(shift(1));
    get("Days").hidden = target.type === "month";
    get("TimeField").hidden = target.type !== "datetime-local";
    get("Error").textContent = "";
    help.hidden = !availabilityEnabled();
    help.textContent = "초록: 가능한 곳 수 · 마감: 잔여 없음 · 예정: 오픈 전, 대기 등록 가능 · 미확인: 조회 필요. 퇴실일은 숙박일에서 제외합니다.";
    get("Range").hidden = !rangeMode;
    if (rangeMode) {
      get("Title").textContent = rangePhase === "start" ? "입실일 선택" : "퇴실일 선택";
      for (const [key, label, value] of [["Checkin", "입실일", rangeStart], ["Checkout", "퇴실일", rangeEnd]]) {
        const date = document.createElement("strong"); date.textContent = value || "선택";
        get(key).replaceChildren(document.createTextNode(label), date);
      }
      get("Checkin").setAttribute("aria-pressed", String(rangePhase === "start"));
      get("Checkout").setAttribute("aria-pressed", String(rangePhase === "end"));
      get("Checkout").disabled = !rangeStart;
      get("Nights").textContent = rangeStart && rangeEnd ? `${(Date.parse(rangeEnd) - Date.parse(rangeStart)) / 86400000}박` : "—";
    }
    get("Apply").disabled = target.type !== "month" && !selected;
    get("Days").replaceChildren();
    if (target.type === "month") return;
    for (const label of ["일", "월", "화", "수", "목", "금", "토"]) {
      const cell = document.createElement("span"); cell.textContent = label; get("Days").append(cell);
    }
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    for (let index = 0; index < offset; index++) get("Days").append(document.createElement("span"));
    const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    for (let day = 1; day <= count; day++) {
      const value = `${month}-${String(day).padStart(2, "0")}`;
      const button = document.createElement("button");
      button.type = "button"; button.className = "date-picker-day"; button.textContent = day;
      if (availabilityEnabled()) {
        const state = window.stayCalendar.day(value).state;
        button.dataset.availability = state;
        const count = document.createElement("small"); count.textContent = window.stayCalendar.label(value); button.append(count);
      }
      button.dataset.date = value; button.setAttribute("aria-label", `${year}년 ${number}월 ${day}일`);
      button.setAttribute("aria-pressed", String(value === selected));
      if (rangeMode) {
        button.setAttribute("aria-pressed", String(value === rangeStart || value === rangeEnd));
        button.classList.toggle("range-start", value === rangeStart);
        button.classList.toggle("range-end", value === rangeEnd);
        button.classList.toggle("in-range", Boolean(rangeStart && rangeEnd && value > rangeStart && value < rangeEnd));
      }
      button.disabled = Boolean(target.min && value < target.min.slice(0, 10) || target.max && value > target.max.slice(0, 10));
      if (rangeMode && rangePhase === "end") button.disabled ||= value <= rangeStart || value > stayEndDate(rangeStart, 6);
      button.disabled ||= !canChoose(value);
      button.addEventListener("click", () => {
        if (!canChoose(value)) return;
        if (rangeMode) {
          if (rangePhase === "start") { rangeStart = value; rangeEnd = ""; rangePhase = "end"; render(); loadCounts(); get("Checkout").focus(); return; }
          rangeEnd = value;
          const nights = (Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86400000;
          if (!Number.isInteger(nights) || nights < 1 || nights > 6) return;
          elements.nights.value = String(nights);
          const previous = elements.startDate.value;
          elements.startDate.value = rangeStart;
          if (previous !== rangeStart) {
            elements.startDate.dispatchEvent(new Event("input", { bubbles: true }));
            elements.startDate.dispatchEvent(new Event("change", { bubbles: true }));
          }
          elements.nights.dispatchEvent(new Event("input", { bubbles: true }));
          elements.nights.dispatchEvent(new Event("change", { bubbles: true }));
          updateStayFields(); dialog.close(); return;
        }
        selected = value;
        if (target.type === "date") { get("Apply").disabled = false; get("Apply").click(); }
        else { render(); get("Days").querySelector(`[data-date="${value}"]`).focus(); }
      });
      get("Days").append(button);
    }
  }
  function open(input) {
    if (dialog.open) return;
    target = input;
    rangeMode = uiSettings.stayRange && ["startDate", "checkoutDate"].includes(input.id);
    rangeStart = elements.startDate.value;
    rangeEnd = document.getElementById("checkoutDate").value;
    rangePhase = input.id === "checkoutDate" && rangeStart ? "end" : "start";
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    selected = input.type === "month" ? "" : input.value.slice(0, 10);
    month = (input.value || today).slice(0, 7);
    if (input.min && month < input.min.slice(0, 7)) month = input.min.slice(0, 7);
    if (input.max && month > input.max.slice(0, 7)) month = input.max.slice(0, 7);
    get("Title").textContent = input.type === "month" ? "월 선택" : input.type === "datetime-local" ? "날짜·시각 선택" : "날짜 선택";
    get("Time").value = input.value.split("T")[1] || "00:00:00";
    get("Apply").hidden = input.type === "date";
    render(); dialog.showModal(); loadCounts();
    (get("Days").querySelector('[aria-pressed="true"]:not(:disabled)') || get("Next")).focus();
  }
  // Suppress the OS picker even when its indicator is clicked; retain typed input.
  document.addEventListener("pointerdown", event => { if (eligible(event.target)) event.preventDefault(); });
  document.addEventListener("click", event => { if (eligible(event.target)) { event.preventDefault(); open(event.target); } });
  document.addEventListener("keydown", event => {
    if (eligible(event.target) && (event.key === " " || event.key === "ArrowDown" && event.altKey)) { event.preventDefault(); open(event.target); }
  });
  get("Prev").addEventListener("click", () => { month = shift(-1); render(); loadCounts(); });
  get("Next").addEventListener("click", () => { month = shift(1); render(); loadCounts(); });
  get("Cancel").addEventListener("click", () => dialog.close());
  get("Checkin").addEventListener("click", () => { rangePhase = "start"; render(); });
  get("Checkout").addEventListener("click", () => { if (rangeStart) { rangePhase = "end"; render(); loadCounts(); } });
  get("Apply").addEventListener("click", () => {
    let value = target.type === "month" ? month : selected;
    if (target.type === "date" && !canChoose(value)) { get("Error").textContent = "마감된 숙박일 또는 지난 날짜입니다."; return; }
    if (target.type === "datetime-local") {
      if (!get("Time").value || !get("Time").checkValidity()) { get("Error").textContent = "올바른 시각을 입력해 주세요."; return; }
      value += `T${get("Time").value}`;
    }
    const previous = target.value;
    target.value = value;
    if (!target.checkValidity()) { target.value = previous; get("Error").textContent = "선택할 수 있는 날짜·시각 범위를 확인해 주세요."; return; }
    if (previous !== target.value) {
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    dialog.close();
  });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => target?.focus({ preventScroll: true }));
}

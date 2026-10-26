let bookingBook = [];
let bookingBookWriting = false;
let bookingBookLoaded = false;
let editingBookIdentity = null;
const bookingIdentityKeys = ["reserverName", "depositorName", "phone", "birthDate"];

function bookingIdentity(profile = {}) {
  return Object.fromEntries(bookingIdentityKeys.map(key => [key, key === "phone" || key === "birthDate" ? String(profile[key] || "").replace(/\D/g, "") : String(profile[key] || "").trim()]));
}
function matchingBookIndex(profile) {
  const identity = bookingIdentity(profile);
  return bookingBook.findIndex(saved => bookingIdentityKeys.every(key => bookingIdentity(saved)[key] === identity[key]));
}
function completeBookingIdentity(profile) {
  const value = bookingIdentity(profile);
  return validPersonName(value.reserverName) && /^01\d{8,9}$/.test(value.phone);
}
async function loadBookingBook() {
  const result = await request("profiles");
  bookingBook = result.profiles || [];
  bookingBookLoaded = true;
  renderBookingBook();
  renderBookingProfileSelectors();
  refreshLookupSiteSelector();
}
function initializeBookingBook() {
  document.getElementById("bookingProfileSelect1").addEventListener("change", event => selectBookingActor(0, event.target.value));
  document.getElementById("bookNewButton").addEventListener("click", () => openBookEditor());
  document.getElementById("bookCancelButton").addEventListener("click", closeBookEditor);
  for (const id of ["bookReserverName", "bookDepositorName", "bookPhone", "bookBirthDate"]) document.getElementById(id).addEventListener("input", updateBookEditor);
  document.getElementById("bookAddButton").addEventListener("click", () => perform(async () => {
    const profile = Object.fromEntries(bookingIdentityKeys.map((key, index) => [key, document.getElementById(["bookReserverName", "bookDepositorName", "bookPhone", "bookBirthDate"][index]).value]));
    if (editingBookIdentity) {
      const index = matchingBookIndex(editingBookIdentity);
      if (index < 0) throw new Error("수정할 예약자가 변경되었습니다. 목록에서 다시 선택하세요.");
      if (!completeBookingIdentity(profile)) throw new Error("예약자 정보를 모두 확인하세요.");
      const duplicate = matchingBookIndex(profile);
      if (duplicate >= 0 && duplicate !== index) throw new Error("이미 저장된 예약자입니다.");
      await writeBookingBook(bookingBook.map((saved, item) => item === index ? { ...saved, ...bookingIdentity(profile) } : saved));
    } else await appendBookingIdentity(profile);
    closeBookEditor();
    document.getElementById("bookingBookMessage").textContent = "예약자를 저장했습니다. 각 모드의 선택 목록에 추가되었습니다.";
  }));
}
function openBookEditor(profile = null) {
  editingBookIdentity = profile ? { ...profile } : null;
  document.getElementById("bookEditor").hidden = false;
  document.getElementById("bookEditorTitle").textContent = profile ? `${profile.reserverName} 정보 수정` : "새 예약자 추가";
  bookingIdentityKeys.forEach((key, index) => { document.getElementById(["bookReserverName", "bookDepositorName", "bookPhone", "bookBirthDate"][index]).value = profile?.[key] || ""; });
  updateBookEditor();
  document.getElementById("bookReserverName").focus();
}
function closeBookEditor() {
  editingBookIdentity = null;
  document.getElementById("bookEditor").hidden = true;
  bookingIdentityKeys.forEach((_, index) => { document.getElementById(["bookReserverName", "bookDepositorName", "bookPhone", "bookBirthDate"][index]).value = ""; });
  updateBookEditor();
}
function updateBookEditor() {
  const locked = busy || bookingBookWriting;
  for (const id of ["bookReserverName", "bookDepositorName", "bookPhone", "bookBirthDate", "bookCancelButton"]) document.getElementById(id).disabled = locked;
  document.getElementById("bookNewButton").disabled = locked || !bookingBookLoaded || bookingBook.length >= 20;
  for (const button of document.querySelectorAll("#bookingBookList button")) button.disabled = locked;
  const draft = Object.fromEntries(bookingIdentityKeys.map((key, index) => [key, document.getElementById(["bookReserverName", "bookDepositorName", "bookPhone", "bookBirthDate"][index]).value]));
  document.getElementById("bookAddButton").disabled = busy || bookingBookWriting || !bookingBookLoaded || !completeBookingIdentity(draft) || !editingBookIdentity && bookingBook.length >= 20;
  document.getElementById("bookAddButton").textContent = editingBookIdentity ? "수정 저장" : "예약자 저장";
}
async function writeBookingBook(next) {
  if (!bookingBookLoaded) throw new Error("저장된 예약자 정보를 먼저 확인해야 합니다. 화면을 새로고침해 주세요.");
  if (bookingBookWriting) throw new Error("예약자 정보를 저장 중입니다. 잠시 기다려 주세요.");
  bookingBookWriting = true;
  renderBookingProfileSelectors();
  try {
    const result = await request("profiles", { method: "PUT", body: JSON.stringify({ profiles: next.map(profile => ({ ...profile, ...bookingIdentity(profile) })) }) });
    bookingBook = result.profiles || [];
    renderBookingBook();
  } finally { bookingBookWriting = false; renderBookingProfileSelectors(); refreshLookupSiteSelector(); updateBookEditor(); }
}
async function appendBookingIdentity(profile) {
  if (!completeBookingIdentity(profile)) throw new Error("예약자명·입금자명·휴대폰 번호·생년월일을 모두 확인하세요.");
  if (matchingBookIndex(profile) >= 0) throw new Error("이미 저장된 예약자입니다. 선택 목록에서 선택하세요.");
  if (bookingBook.length >= 20) throw new Error("예약자는 최대 20명입니다. 예약자 정보 탭에서 사용하지 않는 사람을 삭제하세요.");
  await writeBookingBook([...bookingBook, bookingIdentity(profile)]);
}
async function saveBookingActor(index) {
  await appendBookingIdentity(readConfig().profiles[index]);
  showMessage("예약자를 저장했습니다. 선택 목록에 추가되었습니다.");
}
function selectBookingActor(index, value) {
  const selected = value === "" ? {} : bookingBook[Number(value)];
  if (!selected) return;
  const config = readConfig();
  config.profiles[index] = { ...bookingIdentity(selected), roomPriority: config.profiles[index].roomPriority || [] };
  loadConfig({ ...config, editorProfiles: undefined, multipleProfileIndex: 0, editorProfileIndex: 0 });
}
function mountExtraBookingSelector(panel, index) {
  const label = document.createElement("label");
  label.className = "booking-select-field";
  label.textContent = "예약자 저장 목록";
  const select = document.createElement("select");
  select.id = `bookingProfileSelect${index + 1}`;
  select.addEventListener("change", event => selectBookingActor(index, event.target.value));
  label.append(select);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "secondary booking-actor-save";
  save.id = `saveBookingActor${index + 1}`;
  save.textContent = "예약자 저장";
  save.addEventListener("click", () => perform(() => saveBookingActor(index)));
  const toolbar = document.createElement("div");
  toolbar.className = "booking-selector-actions";
  toolbar.append(label, save);
  panel.querySelector(".grid").before(toolbar);
}
function renderBookingProfileSelectors() {
  readConfig().profiles.forEach((profile, index) => {
    const select = document.getElementById(`bookingProfileSelect${index + 1}`);
    if (!select) return;
    const selected = matchingBookIndex(profile);
    const empty = new Option("선택 안 함 · 직접 입력", "");
    select.replaceChildren(empty, ...bookingBook.map((saved, bookIndex) => new Option(`${saved.reserverName} · ${saved.phone}`, String(bookIndex))));
    select.value = selected >= 0 ? String(selected) : "";
    const save = index === 0 ? elements.saveProfilesButton : document.getElementById(`saveBookingActor${index + 1}`);
    save.disabled = busy || bookingBookWriting || !bookingBookLoaded || selected >= 0 || !completeBookingIdentity(profile) || bookingBook.length >= 20;
  });
}
function renderBookingBook() {
  const list = document.getElementById("bookingBookList");
  list.replaceChildren();
  if (!bookingBook.length) list.textContent = "저장된 예약자가 없습니다.";
  bookingBook.forEach((profile, index) => {
    const row = document.createElement("div");
    row.className = "booking-book-row";
    applyGuestColor(row, index);
    const name = document.createElement("span");
    name.textContent = `${profile.reserverName} · ${profile.phone} · 입금자 ${profile.depositorName}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "삭제";
    remove.setAttribute("aria-label", `${profile.reserverName} 저장 정보 삭제`);
    remove.addEventListener("click", () => perform(async () => {
      if (!window.confirm(`${profile.reserverName}의 저장 정보를 삭제할까요? 등록된 일정과 실제 예약은 변경되지 않습니다.`)) return;
      // Resolve against the current book rather than a stale rendered index.
      const current = matchingBookIndex(profile);
      if (current < 0) return;
      await writeBookingBook(bookingBook.filter((_, item) => item !== current));
      document.getElementById("bookingBookMessage").textContent = "저장 정보를 삭제했습니다. 등록된 일정은 유지됩니다.";
    }));
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "secondary"; edit.textContent = "수정";
    edit.setAttribute("aria-label", `${profile.reserverName} 정보 수정`);
    edit.addEventListener("click", () => openBookEditor(profile));
    const actions = document.createElement("div"); actions.className = "section-actions"; actions.append(edit, remove);
    row.append(name, actions);
    list.append(row);
  });
  document.getElementById("bookNewButton").disabled = bookingBook.length >= 20;
  updateBookEditor();
}

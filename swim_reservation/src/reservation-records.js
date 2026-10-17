// Shared, read-only DOM parser. Never execute cancellation handlers here.
export function readReservationRows() {
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const actionId = element => {
    const action = `${element.getAttribute("href") || ""} ${element.getAttribute("onclick") || ""}`;
    const call = action.match(/\bdel_ok1\s*\(\s*['"]?(\d+)['"]?\s*[,)]/i);
    if (call) return call[1];
    try {
      const url = new URL(element.getAttribute("href") || "", location.href);
      if (url.origin === location.origin && /\/reservation\/order_del\d*\.php$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get("no") || "")) return url.searchParams.get("no");
    } catch { /* An unsupported action is not permission to guess its target. */ }
    return null;
  };
  return [...document.querySelectorAll("tr")].flatMap(row => {
    if ([...row.cells].some(cell => cell.querySelector("table"))) return [];
    const cells = [...row.cells].map(cell => clean(cell.innerText));
    const index = cells.findIndex(cell => /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/.test(cell) || /^\d{4}[-./]\d{1,2}[-./]\d{1,2}[.]?$/.test(cell));
    if (index < 1) return [];
    const action = [...row.querySelectorAll("a,button,input[type=button],input[type=image]")].find(element => actionId(element));
    const id = action ? actionId(action) : null;
    // Some pages split the guest count into two cells. Locate money columns instead of assuming offsets.
    const prices = cells.slice(index + 3).map((value, offset) => ({ value, index: index + 3 + offset })).filter(item => /\d[\d,]*\s*원/.test(item.value));
    const feeIndex = prices[0]?.index ?? index + 4;
    const status = cells.slice((prices[2]?.index ?? index + 6) + 1).join(" ").replace(/예약취소|취소하기/g, "").trim();
    return [{ id, room: cells[index - 1], stayDate: cells[index], nights: cells[index + 1], size: cells[index + 2],
      guests: cells.slice(index + 3, feeIndex).join("/"), fee: prices[0]?.value || cells[index + 4] || "—",
      extraFee: prices[1]?.value || cells[index + 5] || "—", total: prices[2]?.value || cells[index + 6] || "—",
      status: status || (id ? "예약대기 중" : "취소 불가"), cancelable: Boolean(id && !action.disabled && action.getAttribute("aria-disabled") !== "true") }];
  });
}

export function reservationDate(value) {
  const parts = String(value || "").match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return parts ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}` : "";
}

export function sameReservationStay(row, expected) {
  const room = value => String(value || "").replace(/\s+/g, "");
  return room(row.room) === room(expected.room) && reservationDate(row.stayDate) === reservationDate(expected.stayDate || expected.startDate)
    && Number(String(row.nights).match(/\d+/)?.[0]) === Number(String(expected.nights).match(/\d+/)?.[0]);
}

// Runs inside the browser; returned evidence contains no guest names or phone numbers.
export function readReceiptIdentity(expected) {
  const clean = value => String(value || "").replace(/\s+/g, "").trim();
  const fields = new Map();
  for (const row of document.querySelectorAll("tr")) {
    if (row.cells.length !== 2 || [...row.cells].some(cell => cell.querySelector("table"))) continue;
    fields.set(clean(row.cells[0].innerText), clean(row.cells[1].innerText));
  }
  const name = fields.get("이름") || fields.get("예약자명") || fields.get("예약자이름") || "";
  const phone = (fields.get("휴대폰") || fields.get("휴대폰번호") || fields.get("전화번호") || "").replace(/\D/g, "");
  return { nameMatches: Boolean(name && name === clean(expected.reserverName)), phoneMatches: Boolean(phone && phone === String(expected.phone || "").replace(/\D/g, "")) };
}

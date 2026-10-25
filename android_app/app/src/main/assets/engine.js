// DOM-only helpers adapted from the existing HA engine. No HA API or JavaScript bridge.
function fillPersonalFields(profile) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const controls = [...document.querySelectorAll("input, select, textarea")].filter((control) => {
    const type = (control.type || "").toLowerCase();
    return !control.disabled && !["hidden", "checkbox", "radio", "button", "submit", "image", "reset"].includes(type);
  });
  const used = new Set();

  const context = (control) => {
    const cell = control.closest("td, th");
    const row = control.closest("tr");
    const labels = control.labels ? [...control.labels].map((label) => label.innerText) : [];
    return clean([
      ...labels,
      control.closest("label")?.innerText,
      control.getAttribute("aria-label"),
      control.getAttribute("placeholder"),
      cell?.previousElementSibling?.innerText,
      row?.innerText,
      control.parentElement?.innerText
    ].filter(Boolean).join(" "));
  };

  const identifierMatches = (control, pattern) => {
    if (!pattern) return false;
    return [control.name, control.id, control.getAttribute("autocomplete")]
      .filter(Boolean)
      .some((value) => pattern.test(String(value)));
  };

  const ranked = (labelPattern, namePattern, exclude) => controls
    .filter((control) => !used.has(control) && (!exclude || !exclude.test(context(control))))
    .map((control) => ({
      control,
      score: (labelPattern.test(context(control)) ? 10 : 0) + (identifierMatches(control, namePattern) ? 6 : 0)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const setValue = (control, value) => {
    let nextValue = String(value);
    if (control.tagName === "SELECT") {
      const option = [...control.options].find((item) => (
        item.value === nextValue
        || clean(item.text) === clean(nextValue)
        || (/^\d+$/.test(item.value) && Number(item.value) === Number(nextValue))
      ));
      if (!option) return false;
      nextValue = option.value;
    }
    control.value = nextValue;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    used.add(control);
    return control.value === nextValue;
  };

  const fillOne = (labelPattern, namePattern, value, exclude) => {
    const candidate = ranked(labelPattern, namePattern, exclude)[0]?.control;
    return candidate ? setValue(candidate, value) : false;
  };

  const splitFill = (labelPattern, namePattern, digits, parts, singleValue) => {
    const matches = ranked(labelPattern, namePattern).map((item) => item.control);
    if (matches.length >= parts.length) {
      let offset = 0;
      for (let index = 0; index < parts.length; index += 1) {
        const length = parts[index];
        const success = setValue(matches[index], digits.slice(offset, offset + length));
        if (!success) return false;
        offset += length;
      }
      return true;
    }
    if (matches[0]) {
      return setValue(matches[0], singleValue ? singleValue(matches[0], digits) : digits);
    }
    return false;
  };

  const filled = {
    reserverName: fillOne(
      /예약자|신청자|성명/,
      /^(name|name1|username|user_name|rname|res_?name|reservation_?name|order_?name|booker)$/i,
      profile.reserverName,
      /입금|예금주/
    ),
    depositorName: fillOne(
      /입금자|예금주|송금인/,
      /bank_?name|deposit_?name|payer|name2/i,
      profile.depositorName
    ),
    phone: splitFill(
      /휴대폰|핸드폰|연락처|전화번호|전화/,
      /phone|mobile|tel|hp|handphone|cell/i,
      profile.phone,
      [3, 4, 4]
    ),
    birthDate: splitFill(
      /생년월일|생일|출생/,
      /birth|birthday|birthdate|jumin/i,
      profile.birthDate,
      [4, 2, 2],
      (control, digits) => control.maxLength === 6 ? digits.slice(-6) : digits
    )
  };

  for (const box of document.querySelectorAll('input[type="checkbox"]:not(:disabled)')) {
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const fields = controls.slice(0, 16).map((control) => ({
    tag: control.tagName.toLowerCase(),
    type: control.type || "",
    name: control.name || "",
    id: control.id || "",
    maxLength: control.maxLength,
    context: context(control).slice(0, 80)
  }));
  return { filled, fields };
}

// Shared, read-only DOM parser. Never execute cancellation handlers here.
function readReservationRows() {
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

function reservationDate(value) {
  const parts = String(value || "").match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return parts ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}` : "";
}

function sameReservationStay(row, expected) {
  const room = value => String(value || "").replace(/\s+/g, "");
  return room(row.room) === room(expected.room) && reservationDate(row.stayDate) === reservationDate(expected.stayDate || expected.startDate)
    && Number(String(row.nights).match(/\d+/)?.[0]) === Number(String(expected.nights).match(/\d+/)?.[0]);
}

// Runs inside the browser; returned evidence contains no guest names or phone numbers.
function readReceiptIdentity(expected) {
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


function phoneStep(op,c) {
  const boxes=()=>[...document.querySelectorAll('input[type="checkbox"][name^="room_rid"]')];
  const clean=s=>String(s||"").replace(/\s+/g," ").trim();
  if(op==="read") {
    const rooms=boxes().map(box=>{
      const index=(box.name.match(/\[(\d+)\]/)||[])[1];
      const select=document.querySelector('select[name="daytype['+index+']"]');
      const row=box.closest("tr");
      return {name:clean(row?.querySelector("td:nth-child(2)")?.innerText||row?.innerText).split(/\s+/)[0],
        available:!box.disabled && Boolean(select&&[...select.options].some(o=>o.value===String(c.nights)&&!o.disabled))};
    });
    const dates=[...document.querySelectorAll('input[name="adaystart" i]')].map(el=>el.value).filter(Boolean);
    if(!dates.length&&rooms.length) dates.push(new URL(location.href).searchParams.get("adaystart")||"");
    const rows=readReservationRows();
    const identity=readReceiptIdentity({reserverName:c.name,phone:c.phone});
    const receipt=identity.nameMatches&&identity.phoneMatches&&rows.some(row=>row.id&&sameReservationStay(row,{room:c.selectedRoom,startDate:c.date,nights:c.nights}));
    return {rooms,dates,receipt,personal:["name","name2","tel1","tel2","tel3","birthYear","birthMonth","birthDay"].filter(n=>document.querySelector('[name="'+n+'"]')).length>=6};
  }
  if(op==="room") {
    const box=boxes().find(b=>clean(b.closest("tr")?.querySelector("td:nth-child(2)")?.innerText).split(/\s+/)[0]===c.selectedRoom);
    if(!box||box.disabled)throw Error("선택 객실이 변경됐습니다.");
    for(const b of boxes()) b.checked=false;
    const index=box.name.match(/\[(\d+)\]/)[1],select=document.querySelector('select[name="daytype['+index+']"]');
    if(!select||![...select.options].some(o=>o.value===String(c.nights)&&!o.disabled))throw Error("숙박 기간 선택 불가");
    box.checked=true;select.value=String(c.nights);
    box.dispatchEvent(new Event("change",{bubbles:true}));select.dispatchEvent(new Event("change",{bubbles:true}));
    return {ok:true};
  }
  if(op==="terms") {
    for(const b of document.querySelectorAll('input[type="checkbox"]:not(:disabled)')){b.checked=true;b.dispatchEvent(new Event("change",{bubbles:true}));}
    return {ok:true};
  }
  if(op==="fill") {
    const r=fillPersonalFields({reserverName:c.name,depositorName:c.payer,phone:c.phone,birthDate:c.birth});
    if(Object.values(r.filled).some(v=>!v))throw Error("예약자 입력란 불일치");
    return {ok:true};
  }
  if(op==="submit") {
    const path=location.pathname.split("/").pop();
    if(path!==c.expectedPage)throw Error("전송 페이지 불일치");
    const forms=[...document.forms];if(!forms.length)throw Error("예약 폼 없음");
    // Actions outside the reservation origin are never submitted.
    for(const form of forms){
      const url=new URL(form.action||location.href,location.href);
      if(url.origin!==location.origin||!/^\/reservation\/(reservation1|order_ok[123])\.php$/.test(url.pathname))throw Error("허용되지 않은 폼");
    }
    const candidates=[...document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],img[onclick],a[onclick]')];
    let button=candidates.find(el=>/예약하기|예약신청|다음|동의/.test(clean([el.innerText,el.value,el.alt,el.title].join(" ")))&&!/취소|조회/.test(clean([el.innerText,el.value,el.alt].join(" "))));
    if(!button)button=[...document.querySelectorAll('img[onclick*="click_go"],input[type="submit"],input[type="image"],button[type="submit"]')].pop();
    if(!button||button.disabled)throw Error("전송 버튼 없음");
    button.click();return {ok:true};
  }
  throw Error("지원하지 않는 단계");
}

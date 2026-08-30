export function fillPersonalFields(profile) {
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
      const option = [...control.options].find((item) => item.value === nextValue || clean(item.text) === clean(nextValue));
      if (option) nextValue = option.value;
    }
    control.value = nextValue;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    used.add(control);
  };

  const fillOne = (labelPattern, namePattern, value, exclude) => {
    const candidate = ranked(labelPattern, namePattern, exclude)[0]?.control;
    if (candidate) setValue(candidate, value);
    return Boolean(candidate);
  };

  const splitFill = (labelPattern, namePattern, digits, parts, singleValue) => {
    const matches = ranked(labelPattern, namePattern).map((item) => item.control);
    if (matches.length >= parts.length) {
      let offset = 0;
      parts.forEach((length, index) => {
        setValue(matches[index], digits.slice(offset, offset + length));
        offset += length;
      });
      return true;
    }
    if (matches[0]) {
      setValue(matches[0], singleValue ? singleValue(matches[0], digits) : digits);
      return true;
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

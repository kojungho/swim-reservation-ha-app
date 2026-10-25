// Shared DOM-only validation from the add-on. No network or native bridge.
// One browser call for all personal fields and required agreements. This never
// submits a form, changes its hidden fields, or accepts optional agreements.
function fillCampForm(form, values) {
  const steps = [];
  let current;
  const begin = step => { current = { step, startedAt: performance.now() }; };
  const finish = (ok = true, checks = {}) => steps.push({ step: current.step, outcome: ok ? 'complete' : 'error', elapsedMs: Math.round((performance.now() - current.startedAt) * 1000) / 1000, checks });
  const fieldLabel = name => ['name', 'phone', 'depositor', 'request', 'arrive_time'].includes(name) ? name : 'other';
  const fail = (code, checks, invalidFields = []) => { finish(false, checks); return { ok: false, code, failedStep: current.step, invalidFields, steps }; };
  try {
  begin('form-controls-check');
  const fields = Object.entries(values.fields).map(([name, value]) => ({ name, element: form.querySelector(`[name="${name}"]`), value: String(value) }));
  const bank = form.querySelector('input[type="radio"][name="pay_method"][value="bank"]');
  const terms = [...form.querySelectorAll('input.js-agree[data-required="1"]')];
  if (!terms.length || terms.some(element => element.type !== 'checkbox' || element.matches(':disabled'))) return fail('TERMS_UNRECOGNIZED', { requiredTermsRecognized: false });
  const invalidControls = fields.filter(({ element, value }) => !element || !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.matches(':disabled') || element.readOnly || element.type === 'hidden'
    || (element.maxLength >= 0 && value.length > element.maxLength)
    || (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === value && !option.disabled)));
  if (!bank || bank.matches(':disabled') || invalidControls.length) return fail('FORM_FIELDS_UNRECOGNIZED', { fieldsRecognized: !invalidControls.length, bankRecognized: Boolean(bank && !bank.matches(':disabled')) }, invalidControls.map(({ name }) => fieldLabel(name)));
  finish(true, { fieldsRecognized: true, requiredTermsRecognized: true });
  const changed = element => { element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
  begin('personal-fields-fill');
  for (const { element, value } of fields) {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    changed(element);
  }
  finish();
  begin('payment-select');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(bank, true);
  changed(bank);
  finish(bank.checked, { bankSelected: bank.checked });
  begin('terms-accept');
  for (const element of terms) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(element, true);
    changed(element);
  }
  finish(terms.every(element => element.checked), { requiredTermsChecked: terms.every(element => element.checked) });
  begin('input-verify');
  const checks = { fieldsMatched: fields.every(({ element, value }) => element.value === value), bankSelected: bank.checked,
    requiredTermsChecked: terms.every(element => element.checked), nativeValid: form.checkValidity() };
  const invalidFields = fields.filter(({ element, value }) => element.value !== value || !element.checkValidity()).map(({ name }) => fieldLabel(name));
  const ok = Object.values(checks).every(Boolean);
  finish(ok, checks);
  return { ok, code: ok ? null : 'FORM_VALIDATION_FAILED', failedStep: ok ? null : current.step, invalidFields, steps };
  } catch { return fail('FORM_DOM_ERROR', { domOperationFailed: true }); }
}

// Runs inside the browser. Return structured booking fields only: never tokens,
// account numbers, submitted names/phone values, or the source HTML/body.
function readCampReservations({ expectedName = '', rooms = [], html } = {}) {
  // API-fetched details are parsed without loading resources or executing scripts.
  const doc = html === undefined ? document : new DOMParser().parseFromString(html, 'text/html');
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const compact = value => clean(value).replace(/\s/g, '');
  const date = text => {
    const match = clean(text).match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
    if (!match) return '';
    const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    try { return new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result ? result : ''; } catch { return ''; }
  };
  const values = root => {
    const result = new Map();
    for (const row of root.querySelectorAll('.sum-row, .bank-box .row')) {
      if (row.children.length !== 2) continue;
      const key = compact(row.children[0].textContent), value = clean(row.children[1].textContent);
      if (result.has(key) && result.get(key) !== value) return null;
      result.set(key, value);
    }
    return result;
  };
  const status = badge => ({ '입금대기': '입금 대기', '예약확정': '예약 확정', '입금확인': '입금 확인', '결제완료': '결제 완료', '예약취소': '예약 취소', '취소완료': '예약 취소', '기한만료': '기한 만료', '예약만료': '기한 만료' })[compact(badge)];
  const parse = (root, head) => {
    const text = clean(head?.textContent);
    const id = text.match(/예약번호\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{5,39})(?![A-Z0-9-])/i)?.[1];
    const state = status(head?.querySelector('.badge')?.textContent);
    const dates = root.querySelector('.stay-dates');
    const fields = values(dates?.closest('.summary-card') || root);
    const bank = values(root.querySelector('.bank-box') || doc.createElement('div'));
    if (!id || !state || !dates || !fields || !bank) return null;
    const dateValues = [...dates.querySelectorAll('.d-val')].map(element => date(element.textContent)).filter(Boolean);
    if (dateValues.length !== 2) return null;
    const [checkin, checkout] = dateValues;
    const nights = (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000;
    const badgeNights = Number(clean(dates.querySelector('.nights')?.textContent).match(/^(\d+)\s*박$/)?.[1]);
    if (!Number.isInteger(nights) || nights < 1 || nights > 365 || badgeNights !== nights) return null;
    const site = compact(fields.get('사이트'));
    const room = rooms.find(item => compact(item.displayName) === site);
    const total = fields.get('총금액') || fields.get('총요금');
    if (!room || !/^\d[\d,]*\s*원$/.test(total || '')) return null;
    const name = fields.get('예약자') || fields.get('예약자명');
    if (!name || compact(name) !== compact(expectedName)) return null;
    const guests = fields.get('인원') || '';
    const adults = Number(guests.match(/성인\s*(\d+)\s*명/)?.[1]);
    if (!Number.isInteger(adults) || adults < 1) return null;
    return { id, room: room.name, siteId: room.siteId, stayDate: checkin, checkout, nights: `${nights}박`, guests, adults, total, status: state,
      paymentStatus: state === '입금 대기' ? 'pending' : ['예약 확정', '입금 확인', '결제 완료'].includes(state) ? 'confirmed' : 'closed',
      depositDeadline: state === '입금 대기' ? bank.get('입금기한') || '' : '', cancelable: false, cancelPolicy: 'contact' };
  };
  const wrap = doc.querySelector('.done-wrap');
  if (!wrap) return { kind: 'unknown', rows: [] };
  const picks = [...wrap.querySelectorAll('.lookup-pick')];
  if (picks.length) {
    const rows = picks.map(pick => parse(pick, pick));
    if (rows.some(row => !row) || new Set(rows.map(row => row.id)).size !== rows.length) return { kind: 'unknown', rows: [] };
    return { kind: 'list', rows };
  }
  const head = wrap.querySelector('.done-head');
  if (head?.querySelector('.badge')) {
    const row = parse(wrap, head);
    return row ? { kind: 'detail', submissionComplete: /^예약신청이완료되었습니다[.!]?$/.test(compact(head.querySelector('h1')?.textContent)), rows: [row] } : { kind: 'unknown', rows: [] };
  }
  // Only an explicit result message means zero; the untouched lookup form does not.
  const noMatch = [...wrap.querySelectorAll('form.lookup-form > .form-error')].some(element => compact(element.textContent) === '일치하는예약이없습니다.예약자명·연락처를확인해주세요.');
  if (noMatch) return { kind: 'empty', rows: [] };
  const messages = [...wrap.querySelectorAll('.msg-box p, .lookup-empty, .notice, .error, .message')].map(element => compact(element.textContent));
  const empty = messages.some(message => /^(조회된|일치하는|등록된)?예약(내역|정보)?(이|가)?없습니다[.!]?$/.test(message));
  return { kind: empty ? 'empty' : 'unknown', rows: [] };
}

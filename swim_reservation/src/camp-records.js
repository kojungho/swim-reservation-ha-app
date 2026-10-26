// Runs inside the browser. Return structured booking fields only: never tokens,
// account numbers, submitted names/phone values, or the source HTML/body.
export function readCampReservations({ expectedName = '', rooms = [], html } = {}) {
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
  const status = badge => ({ '입금대기': '입금 대기', '예약확정': '예약 확정', '입금확인': '입금 확인', '결제완료': '결제 완료', '예약취소': '예약 취소', '자동취소': '자동 취소', '취소완료': '예약 취소', '기한만료': '기한 만료', '예약만료': '기한 만료' })[compact(badge)];
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

// Private request data: keep in memory only, never return through the UI/API/logs.
export function readCampLookupSelections({ expectedName, expectedPhone }) {
  const picks = [...document.querySelectorAll('.done-wrap .lookup-pick')];
  if (!picks.length || picks.length > 20) return null;
  const selections = picks.map(form => {
    if (form.tagName !== 'FORM' || form.method.toLowerCase() !== 'post') return null;
    const action = new URL(form.action);
    if (action.origin !== location.origin || action.pathname !== '/camp/lookup.php' || action.search) return null;
    const inputs = [...form.querySelectorAll('input')];
    const names = ['_csrf', 'name', 'phone', 'pick'];
    if (inputs.length !== 4 || names.some(name => inputs.filter(input => input.type === 'hidden' && input.name === name && !input.disabled).length !== 1)) return null;
    const fields = Object.fromEntries(inputs.map(input => [input.name, input.value]));
    if (!fields._csrf || fields._csrf.length > 1024 || !/^[A-Za-z0-9_-]{1,256}$/.test(fields.pick)
      || fields.name.replace(/\s/g, '') !== String(expectedName || '').replace(/\s/g, '')
      || fields.phone.replace(/\D/g, '') !== String(expectedPhone || '').replace(/\D/g, '')) return null;
    const button = form.querySelector('button[type="submit"]');
    if (!button || button.disabled || button.hasAttribute('formaction') || button.textContent.replace(/\s/g, '') !== '자세히보기') return null;
    const ids = [...new Set(form.textContent.match(/\b[A-Z][A-Z0-9]{2,}-[A-Z0-9]{2,}\b/gi) || [])];
    // Imported/confirmed reservations may omit the public booking number on the
    // compact card. The server-provided pick still identifies the detail; never
    // derive it from a guessed booking number.
    return ids.length <= 1 ? { id: ids[0] || null, fields } : null;
  });
  if (selections.some(item => !item) || new Set(selections.map(item => item.id).filter(Boolean)).size !== selections.filter(item => item.id).length
    || new Set(selections.map(item => item.fields.pick)).size !== selections.length) return null;
  return selections;
}

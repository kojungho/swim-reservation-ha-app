// Synthetic data only. Class names come from the public stylesheet; labels and
// layout follow supplied screenshots. This is not captured authenticated HTML.
export function campReceipt({ name = '테스트예약자', room = '산맥존숨', state = '입금대기', heading = '예약 신청이 완료되었습니다', id = 'TEST123-ABC', checkin = '2026.12.22', checkout = '2026.12.23', nights = '1박', adults = '성인 2명', total = '60,000원' } = {}) {
  return `<main class="done-wrap"><header class="done-head"><span class="badge pending">${state}</span><h1>${heading}</h1><p>예약번호 ${id}</p></header>
    <div class="bank-box"><div class="acct">테스트용 계좌 원문</div><div class="row"><span>입금자명</span><b>테스트입금자</b></div><div class="row"><span>입금 기한</span><b>10월 26일 (월) 15:58 까지</b></div></div>
    <div class="summary-card"><div class="stay-dates"><div><div class="d-label">체크인</div><div class="d-val">${checkin} (화)<br>14:00</div></div><span class="nights">${nights}</span><div><div class="d-label">체크아웃</div><div class="d-val">${checkout} (수)<br>13:00</div></div></div>
      <div class="sum-row"><span>사이트</span><span>${room}</span></div><div class="sum-row"><span>예약자</span><span>${name}</span></div><div class="sum-row"><span>인원</span><span>${adults}</span></div><div class="sum-row total"><span>총 금액</span><b>${total}</b></div></div>
    <div class="cancel-box">취소는 캠핑장으로 연락해 주세요.</div></main>`;
}

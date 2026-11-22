(() => {
  'use strict';
  const $ = id => document.getElementById(id); let csrf = '', busy = false, sending = false;
  const message = text => { $('cardMessage').textContent = text; };
  async function api(path = '', method = 'GET', input) {
    if (method !== 'GET' && path !== '/stop' && !window.isSecureContext) throw Error('카드 검토는 HTTPS로 연결한 Home Assistant에서 열어 주세요.');
    const response = await fetch('api/card-review' + path, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { 'X-Swim-Card-Review': csrf }) }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const data = await response.json(); if (!response.ok) throw Error(data.error || '요청을 처리하지 못했습니다. 화면을 다시 열어 주세요.'); return data;
  }
  function controls() { document.querySelectorAll('#vaultForm input,#vaultForm button,#reviewForm input,#reviewForm select,#reviewForm button,#selfTest,#deleteCard').forEach(e => { e.disabled = busy || sending; }); $('stopReview').disabled = !busy || sending; }
  async function refresh() {
    try {
      const data = await api(); csrf = data.csrf; busy = data.review.busy;
      $('vaultStatus').textContent = data.vault.configured ? '삼성카드 암호화 저장됨 · 값은 다시 표시하지 않습니다.' : '저장된 카드 없음';
      $('reviewStatus').textContent = data.review.message;
      $('previewLine').hidden=!data.review.hasConnectionPreview;
      $('reviewDetails').textContent = data.review.state === 'ready' ? `${data.review.fixture ? '샘플 테스트' : '실제 주문 검토'}: 카드번호·CVC·비밀번호 입력 확인\n최종 결제 요청 없음 · 브라우저 통신 차단 · 1분 후 입력값 폐기` : data.review.state === 'failed' ? `중지 단계: ${data.review.stepLabel || '화면 연결 확인'}` : data.review.state === 'connected' ? '카드 저장소를 열지 않고 공식 화면과 숫자 키 10개씩을 확인했습니다. 실제 카드 정보·비밀번호 입력 없음.' : '';
      controls();
    } catch { message('연결 상태를 확인하세요. 중지 여부를 확인할 때까지 검토를 다시 시작하지 마세요.'); }
  }
  async function action(work) { if (sending) return; sending = true; controls(); message(''); try { await work(); } catch (error) { message(error.message); } finally { sending = false; await refresh(); } }
  $('vaultForm').addEventListener('submit', event => { event.preventDefault(); if(sending||busy)return; const input=Object.fromEntries(new FormData(event.target)); event.target.reset(); void action(async () => { try { await api('/vault', 'PUT', input); message('카드 정보를 암호화해 저장했습니다.'); } finally { for (const key of Object.keys(input)) input[key] = ''; } }); });
  $('reviewForm').addEventListener('submit', event => { event.preventDefault(); if(sending||busy)return; const input=Object.fromEntries(new FormData(event.target)); input.consent=input.consent==='on'; event.target.elements.passphrase.value=''; void action(async () => { try { await api('/start', 'POST', input); } finally { input.passphrase = ''; } }); });
  $('selfTest').addEventListener('click', () => void action(() => api('/self-test', 'POST', {})));
  $('connectionTest').addEventListener('click', () => { if(sending||busy)return;const form=$('reviewForm'),input={};for(const name of ['startDate','nights','siteId','profileIndex','adults','amount'])input[name]=form.elements[name].value;input.consent=form.elements.consent.checked;void action(()=>api('/connection-test','POST',input)); });
  $('stopReview').addEventListener('click', () => void action(() => api('/stop', 'POST', {})));
  $('deleteCard').addEventListener('click', () => { if (confirm('암호화 저장된 카드를 삭제할까요? 다시 사용하려면 직접 등록해야 합니다.')) void action(() => api('/vault', 'DELETE')); });
  async function init() { try { const data = await api('/options'); for (const site of data.sites) $('reviewSite').add(new Option(`${site.id} ${site.name}`, site.id)); for (const profile of data.profiles) $('reviewProfile').add(new Option(profile.name || `예약자 ${profile.index + 1}`, profile.index)); } catch { message('예약자와 사이트 목록을 불러오지 못했습니다.'); } await refresh(); setInterval(() => { if (!sending) void refresh(); }, 2000); }
  window.addEventListener('pagehide', () => { $('vaultForm').reset(); $('reviewForm').elements.passphrase.value = ''; });
  void init();
})();

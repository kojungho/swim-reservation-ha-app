(() => {
  'use strict';
  const $ = id=>document.getElementById(id);
  let csrf='', prepared=null, sending=false, busy=false, timer=null;
  const status=text=>{$('bookingCardStatus').textContent=text;};
  async function api(path='',input) {
    if (input && !window.isSecureContext) throw Error('Home Assistant의 HTTPS 화면에서 검토해 주세요.');
    const res=await fetch('api/card-review'+path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(input?{'X-Swim-Card-Review':csrf}:{})},...(input?{body:JSON.stringify(input)}:{})});
    const data=await res.json();if(!res.ok)throw Error(data.error||'카드 검토 요청을 처리하지 못했습니다.');return data;
  }
  function controls(){
    for(const id of ['bookingCardJob','bookingCardUnlock','bookingCardConsent','bookingCardConnect','bookingCardFill'])$(id).disabled=busy||sending;
    $('bookingCardStop').disabled=!busy||sending;
  }
  async function refresh(){
    const data=await api();csrf=data.csrf;busy=data.review.busy;controls();
    status(data.review.message+(data.review.stepLabel?' · 중지 단계: '+data.review.stepLabel:'')+(data.review.state==='ready'?' · 최종 결제 없음 · 통신 차단됨':''));
  }
  window.updateBookingPayment=()=>{
    if ((typeof workspaceTab!=='undefined'&&workspaceTab==='watch') || (typeof editingPlan!=='undefined'&&editingPlan)) $('bookingPayment').value='bank';
    const card=$('bookingPayment').value==='card-review';
    const button=$('addPlanButton');if(button&&!(typeof editingPlan!=='undefined'&&editingPlan))button.textContent=card?'카드 결제 전 검토':'일정 등록';
    if(card)$('planCard').querySelector('.plan-registration').hidden=false;
    const now=$('runNowButton');if(now&&card)now.hidden=true;
    const field=$('bookingPayment').closest('label');field.hidden=typeof workspaceTab!=='undefined'&&workspaceTab==='watch';
  };
  $('bookingPayment').addEventListener('change',window.updateBookingPayment);
  window.openBookingCardReview=async config=>{
    if(sending)return; sending=true;
    try{
      await refresh();if(busy)throw Error('진행 중인 카드 검토를 먼저 중지하세요.');
      const data=await api('/booking-prepare',{config});prepared=data;
      $('bookingCardJob').replaceChildren(...data.jobs.map(j=>new Option('예약 '+(j.profileIndex+1)+' · '+j.reserverName+' · '+j.roomName+' · '+j.amount.toLocaleString('ko-KR')+'원',j.index)));
      $('bookingCardConditions').textContent=config.startDate+' · '+config.nights+'박 · 성인 '+config.adults+'명 · 각 후보별 검토 · 준비 조건 5분 유효';
      $('bookingCardUnlock').value='';$('bookingCardConsent').checked=false;
      $('bookingCardDialog').showModal();status('예약 조건과 공식 금액 확인 완료. 카드 없이 연결 확인부터 진행할 수 있습니다.');
      clearInterval(timer);timer=setInterval(()=>{if(!sending)refresh().catch(()=>status('검토 상태를 확인하지 못했습니다. 다시 시작하지 말고 연결을 확인하세요.'));},2000);
    }finally{sending=false;controls();}
  };
  async function start(connectionOnly){
    if(sending||busy||!prepared)return;
    if(!$('bookingCardConsent').checked){status('미결제 주문 생성·필수 약관 동의를 확인해 주세요.');return;}
    const unlock=$('bookingCardUnlock');
    if(!connectionOnly&&(!unlock.value||!unlock.checkValidity())){unlock.reportValidity();status('저장 시 사용한 12자 이상의 해제 암호를 입력하세요.');return;}
    const input={id:prepared.id,index:Number($('bookingCardJob').value),consent:true,connectionOnly,...(!connectionOnly?{passphrase:unlock.value}:{})};
    unlock.value='';sending=true;controls();
    try{await api('/booking-start',input);await refresh();}
    catch(error){status(error.message);}
    finally{input.passphrase='';sending=false;controls();}
  }
  $('bookingCardConnect').onclick=()=>void start(true);
  $('bookingCardFill').onclick=()=>void start(false);
  async function stop(){sending=true;controls();try{await api('/stop',{});await refresh();}catch(error){status(error.message);}finally{sending=false;controls();}}
  $('bookingCardStop').onclick=()=>void stop();
  $('bookingCardClose').onclick=async()=>{await stop();if(!busy)$('bookingCardDialog').close();};
  $('bookingCardDialog').addEventListener('cancel',event=>{event.preventDefault();$('bookingCardClose').click();});
  $('bookingCardDialog').addEventListener('close',()=>{clearInterval(timer);$('bookingCardUnlock').value='';});
  window.addEventListener('pagehide',()=>{$('bookingCardUnlock').value='';clearInterval(timer);});
  window.updateBookingPayment();
})();

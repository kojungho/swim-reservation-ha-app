/* Private immutable submission records. No automatic reservation or cancellation. */
(function(){
 const phone=typeof Phone!=='undefined',host=document.getElementById('bookingBookCard');if(!host)return;
 const make=(tag,text,cls)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(cls)element.className=cls;return element;};
 const block=make('section'),title=make('h3','예약 제출 정보'),list=make('div');block.id='submittedBookingRecords';block.append(title,make('p','제출 직전에 확인한 입력 정보입니다. 실제 예약 상태는 조회로 확인하세요.'),list);host.append(block);
 let key='',busy=false;
 const notify=error=>window.showFloatingMessage?.(error.message||String(error),{error:true});
 async function read(){return phone?api('bookingRecords'):request('booking-records');}
 async function remove(id){if(phone)api('bookingRecordDelete',{id});else await request('booking-records/'+encodeURIComponent(id),{method:'DELETE'});key='';await refresh();}
 function render(entries){
  list.replaceChildren();if(!entries.length){list.append(make('p','저장된 제출 기록이 없습니다. 새 버전에서 제출한 예약부터 남습니다.'));return;}
  for(const entry of entries){const entered=entry.entered||{},stay=entry.stay||{},receipt=entry.receipt||{},card=make('details',undefined,'submitted-booking-record'),summary=make('summary',(entry.state==='complete'?'예약 신청 완료':'결과 확인 필요')+' · '+(entered.name||'')+' · '+(stay.site||'')+' · '+(stay.checkin||''));
   card.append(summary);for(const text of ['예약번호: '+(receipt.id||'미확인'), '입실 / 퇴실: '+(stay.checkin||'')+' / '+(stay.checkout||'')+' · '+(stay.nights||'')+'박','금액 / 신청 당시 상태: '+(receipt.total||'미확인')+' / '+(receipt.status||'확인 필요'),'예약자명: '+(entered.name||''),'휴대폰 입력값: '+(entered.fields||[]).filter(field=>field.role==='phone').map(field=>field.value).join(' / '),'입금자명: '+(entered.depositor||''),'도착 예정: '+(entered.arrival||''),'요청사항: '+(entered.request||'')])card.append(make('p',text));
   const actions=make('div',undefined,'section-actions'),lookup=make('button','이 정보로 예약 조회','secondary'),del=make('button','기록 삭제','danger');lookup.type=del.type='button';
   lookup.onclick=async()=>{try{if(phone){switchTab('people');requestPhoneLookup([{name:entered.name,phone:entered.phone}]);}else{switchWorkspaceTab('people');await loadReservations([{reserverName:entered.name,depositorName:entered.depositor||'',phone:entered.phone,birthDate:''}]);}}catch(error){notify(error);}};
   del.onclick=()=>{const confirm=make('button','기록만 삭제','danger'),cancel=make('button','취소','secondary');confirm.type=cancel.type='button';actions.replaceChildren(make('span','실제 예약은 취소되지 않습니다.'),confirm,cancel);confirm.onclick=async()=>{confirm.disabled=true;try{await remove(entry.id);}catch(error){confirm.disabled=false;notify(error);}};cancel.onclick=()=>actions.replaceChildren(lookup,del);};
   actions.append(lookup,del);card.append(actions);list.append(card);
  }
 }
 async function refresh(){if(busy||document.hidden||host.hidden)return;busy=true;try{const result=await read(),entries=result.entries||[],next=JSON.stringify(entries);if(next!==key){key=next;render(entries);}}catch(error){notify(error);}finally{busy=false;}}
 window.refreshBookingRecords=refresh;document.addEventListener('click',()=>setTimeout(refresh,80));document.addEventListener('visibilitychange',refresh);setInterval(refresh,10000);refresh();
})();

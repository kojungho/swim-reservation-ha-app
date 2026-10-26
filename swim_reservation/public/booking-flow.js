/* Shared compact booking flow. Display-only; no start, submit or cancel actions. */
window.buildDisplayReceipt=function(value){
 const el=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
 const card=el('div');card.className='reservation-row reservation-compact';
 const identity=el('div');identity.append(el('strong',String(value.room||'').split('_')[0]),el('span',(value.stayDate||'')+' · '+(value.nights||'')));
 const state=el('div');state.className='reservation-compact-state';state.append(el('strong',value.status||'확인 필요'),el('span',value.total||''));
 const details=el('details');details.className='reservation-more';details.append(el('summary','상세'));
 const more=el('div');more.append(el('span','예약번호 '+(value.id||'미확인')));if(value.depositDeadline)more.append(el('span','입금 기한 '+value.depositDeadline));more.append(el('span','취소는 캠핑장에 문의해 주세요.'));details.append(more);card.append(identity,state,details);return card;
};
(() => {
 const byId=id=>document.getElementById(id),phone=!!window.Phone;
 const setHidden=(el,value)=>{if(el&&el.hidden!==value)el.hidden=value;};
 const modes=['priority','multiple','profiles-parallel','watch'];
 const notify=text=>window.showFloatingMessage?.(text,{error:true});
 let scheduled=false,initialized=false,bodies=[],lastNoRoom='',haKey='',lastSync=0;
 window.applyBookingMenus=function(settings={},target=phone?'app':'addon'){
  const choices=settings[target+'Menus']||{};
  for(const tab of modes){const item=document.querySelector('[data-workspace-tab="'+tab+'"]');setHidden(item,choices[tab]===false);if(phone){const name=settings.appMenuLabels?.[tab]||({priority:'단독 예약',multiple:'다중 예약','profiles-parallel':'다인 예약',watch:'취소 대기'})[tab];labels[tab]=name;if(item&&item.textContent!==name)item.textContent=name;}}
  if(phone)setHidden(document.querySelector('[data-workspace-tab=settings]'),true);
  const current=typeof workspaceTab==='string'?workspaceTab:'priority';
  if(phone&&byId('workspaceMenuLabel')&&byId('workspaceMenuLabel').textContent!==labels[current])byId('workspaceMenuLabel').textContent=labels[current];
  if(modes.includes(current)&&choices[current]===false){const next=modes.find(m=>choices[m]!==false)||'people';phone?switchTab(next):switchWorkspaceTab(next);}
 };
 window.applyDisplaySync=function(state){
  if(!phone)return;
  const key=JSON.stringify(state||{});if(key===haKey)return;haKey=key;
  const cached=state?.cached;
  if(cached?.settings){uiSettings={...defaults,...cached.settings,fonts:{...defaults.fonts,...cached.settings.fonts}};applyUi();window.applyBookingMenus(uiSettings,'app');}
  const image=byId('siteMapImage');image.src=cached?.hasPhoto?'ha-map.png?v='+cached.updatedAt:'site-map.png';
  const status=byId('haConnectionState');if(status)status.textContent=state?.message||(cached?'마지막 동기화 설정 사용':'공개 설정 확인 대기');
  byId('siteMapMessage').textContent=cached?'애드온의 메인 사진':'공개 설정이 연결되면 메인 사진이 자동으로 표시됩니다.';
  window.refreshPhoneMaps=()=>{};setHidden(byId('mapGallery'),true);setHidden(document.querySelector('.gallery-heading'),true);
  for(const id of ['galleryDeleteSelected','galleryDeleteAll','siteMapUploadButton'])setHidden(byId(id),true);
 };
 function markLabels(){
  const required=new Set(['startDate','checkoutDate','reserverName','phone','bookReserverName','bookPhone','oneOffName','oneOffPhone','campAdults']);
  document.querySelectorAll('label').forEach(label=>{
   for(const child of label.childNodes)if(child.nodeType===3&&child.textContent.includes('(선택)'))child.textContent=child.textContent.replace(/\s*\(선택\)/g,'');
   const input=label.querySelector('input,select,textarea');if(input&&(required.has(input.id)||/^(reserverName|phone)\d+$/.test(input.id)||['name','phone'].includes(input.name))&&!label.querySelector('.required-tag')){
    const tag=document.createElement('small');tag.textContent='(필수)';tag.className='required-tag';label.insertBefore(tag,input);
   }
  });
 }
 function initialize(){
  if(initialized||!byId('startDate')||phone&&!window.featuresReady&&typeof featuresReady==='undefined')return;
  if(phone&&typeof featuresReady!=='undefined'&&!featuresReady)return;
  initialized=true;
  const date=byId('startDate').closest('section'),person=byId('reserverName').closest('section'),room=byId('roomList').closest('section');
  room.before(person);
  for(const [i,section]of [date,person,room].entries()){
   const title=section.querySelector('.section-title');title.querySelector('span').textContent=String(i+1);
   const body=document.createElement('div');body.className='booking-step-body';
   for(const child of [...section.children])if(child!==title)body.append(child);
   const toggle=document.createElement('button');toggle.type='button';toggle.className='step-toggle';toggle.textContent=i===0?'날짜 선택':i===1?'예약자 입력':'사이트 선택 단계';toggle.onclick=()=>{if(toggle.disabled)return;body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));};
   title.append(toggle);section.append(body);bodies.push({body,toggle,ready:false});
  }
  for(const id of ['inspectButton','watchSelectAll','watchDeselectAll'])setHidden(byId(id),true);
  for(const el of document.querySelectorAll('.section-title p,#roomDragHelp,#profileModeHelp,#phoneBatchNote,.log-help,.site-choice-message,.site-choice-empty'))el.classList.add('compact-explanation');
  if(phone){const links=person.querySelectorAll('.official-small');links.forEach((a,i)=>{if(i)a.hidden=true;});}
  const request=byId('campRequest');if(request){request.closest('label').classList.add('full-field');request.rows=2;}
  for(const button of document.querySelectorAll('button'))if(button.textContent.includes('공식 약관')){button.className='official-small';button.textContent='공식 예약 사이트';}
  for(const el of document.querySelectorAll('a.button[href*="swimozi"]')){el.className='official-small';el.textContent='공식 예약 사이트';}
  document.querySelectorAll('.one-off-lookup summary').forEach(el=>el.textContent='비회원 조회');
  const selector=byId('siteProfileSelect');if(selector){const label=selector.closest('label');for(const text of [...label.childNodes])if(text.nodeType===3)text.textContent='예약자 ';}
  const intro=byId('lookupCard').querySelector(':scope>p:not([id])');if(intro)intro.textContent='선택한 예약자의 내역만 조회합니다.';
  if(phone){
   const connection=document.createElement('div');connection.className='ha-connection';
   const update=document.createElement('button');update.type='button';update.className='official-small';update.textContent='앱 업데이트';update.onclick=()=>api('checkUpdates');
   const state=document.createElement('small');state.id='haConnectionState';connection.append(update,state);document.querySelector('header').append(connection);
   // Keep device permissions accessible, but no editable display/settings page.
   const health=byId('phoneHealth')?.closest('#settingsControls');if(health){const permissions=health.querySelector('.phone-permissions');if(permissions){const detail=document.createElement('details');detail.className='device-permissions';const summary=document.createElement('summary');summary.textContent='폰 실행 권한';detail.append(summary,byId('phoneHealth'),permissions);byId('logCard').append(detail);}}
   setHidden(byId('settingsCard'),true);window.applyDisplaySync(nativeState.haDisplay);
   const previousRead=readPlan;readPlan=function(){const value=previousRead(),interval=nativeState.haDisplay?.cached?.submitIntervalSeconds;if(Number.isInteger(interval)&&interval>=0&&interval<=60)value.submitInterval=interval;return value;};
   const originalSwitch=switchTab;switchTab=function(tab){if(tab==='settings')return;originalSwitch(tab);queue();};
   const originalApply=applyUi;applyUi=function(){originalApply();setHidden(byId('reservationConnectionDetails'),true);};
   const originalUpdate=updateStayFields;updateStayFields=function(){originalUpdate();const opening=bookingOpenIso(byId('startDate').value);setHidden(byId('stayOpeningDate'),!opening||Date.parse(opening+'+09:00')<=currentSiteTime());};
   // Execution time stays editable outside the removed generated reservation-info panel.
   const trigger=byId('triggerAt')?.closest('label');if(trigger)bodies[0].body.append(trigger);
   setHidden(byId('reservationConnectionDetails'),true);
  }
  const safety=byId('safetyNotice');if(safety){const detail=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='실행 안전 안내';text.textContent=phone?'전원·네트워크·절전 제한으로 실행이 중단될 수 있습니다. HA와 같은 예약을 동시에 실행하지 마세요.':'서버 전원·네트워크와 시간을 확인하세요. 폰과 같은 예약을 동시에 실행하지 마세요.';detail.append(summary,text);safety.replaceChildren(detail);}
  markLabels();
 }
 function refresh(){
  scheduled=false;initialize();if(!initialized)return;
  const date=byId('startDate').value,end=byId('checkoutDate').value,nights=Number(byId('nights').value);
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=(phone?seoulToday():new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()))&&nights>=1&&nights<=6&&(!end||end>date);
  let personReady=!!byId('reserverName').value.trim()&&/^01\d{8,9}$/.test(byId('phone').value.replace(/\D/g,''));
  if(typeof workspaceTab!=='undefined'&&workspaceTab==='profiles-parallel'){
   if(phone)personReady=phonePeople.length>0&&phonePeople.every(p=>p.name.trim()&&/^01\d{8,9}$/.test(p.phone.replace(/\D/g,'')));
   else personReady=[{reserverName:byId('reserverName').value,phone:byId('phone').value},...extraProfiles].every(p=>p.reserverName?.trim()&&/^01\d{8,9}$/.test((p.phone||'').replace(/\D/g,'')));
  }
  const ready=[true,validDate,validDate&&personReady];
  bodies.forEach((item,i)=>{item.toggle.disabled=!ready[i];if(!ready[i])setHidden(item.body,true);else if(!item.ready)setHidden(item.body,false);item.ready=ready[i];const expanded=String(!item.body.hidden);if(item.toggle.getAttribute('aria-expanded')!==expanded)item.toggle.setAttribute('aria-expanded',expanded);});
  markLabels();
  if(phone){document.querySelectorAll('#phonePeople .phone-person-card').forEach((card,i)=>{const p=phonePeople[i],valid=validDate&&p?.name?.trim()&&/^01\d{8,9}$/.test((p?.phone||'').replace(/\D/g,''));setHidden(card.querySelector('.phone-person-ranks'),!valid);});}
  for(const id of ['inspectButton','watchSelectAll','watchDeselectAll'])setHidden(byId(id),true);
  if(phone){window.applyBookingMenus(uiSettings);setHidden(byId('settingsCard'),true);for(const id of ['galleryDeleteSelected','galleryDeleteAll','siteMapUploadButton','mapGallery'])setHidden(byId(id),true);setHidden(document.querySelector('.gallery-heading'),true);
   if(Date.now()-lastSync>60000&&!document.hidden){lastSync=Date.now();try{api('haSync');}catch(e){/* Keep cached display, no booking state changes. */}}
  }else if(typeof uiSettings!=='undefined')window.applyBookingMenus(uiSettings);
  const states=(phone?vault.rooms.map(phoneChoiceState):rooms.map(r=>siteChoiceState(r.name)));
  if(states.length&&states.every(s=>['unavailable','booked'].includes(s.kind))){const key=date+'/'+nights;if(lastNoRoom!==key){lastNoRoom=key;notify('선택한 기간에 예약 가능한 사이트가 없습니다.');}}else lastNoRoom='';
 }
 function queue(){if(!scheduled){scheduled=true;setTimeout(refresh,80);}}
 window.prepareSiteChoice=async()=>{
  if(!byId('startDate').value){notify('입실·퇴실일을 선택하세요.');return false;}
  if(phone){
   if(phoneChoiceState(vault.rooms[0]).kind==='before-open-no-data'||workspaceTab==='watch')return true;
   try{const key=roomQueryKey(),requestedAt=Date.now();api('inspect',readPlan());const end=Date.now()+30000;do{await new Promise(r=>setTimeout(r,300));poll();if(roomQueryKey()!==key)return false;if(!nativeState.inspectBusy&&availabilitySnapshot?.key===key&&availabilitySnapshot?.ok&&availabilitySnapshot.capturedAt>=requestedAt){if(!vault.rooms.some(n=>phoneChoiceState(n).selectable)){notify('예약 가능한 사이트가 없습니다.');return false;}return true;}}while(Date.now()<end);throw Error('객실 조회를 완료하지 못했습니다. 다시 선택하세요.');}catch(e){showError(e);return false;}
  }
  if(plannedSiteChoices()||workspaceTab==='watch')return true;
  await refreshAvailability();return rooms.some(r=>canSelectRoom(r.name));
 };
 document.addEventListener('DOMContentLoaded',()=>{queue();document.addEventListener('input',queue);document.addEventListener('change',queue);document.addEventListener('roomorderchange',queue);new MutationObserver(queue).observe(document.querySelector('main'),{childList:true,subtree:true});setInterval(queue,1200);});
})();

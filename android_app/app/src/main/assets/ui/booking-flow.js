/* Shared compact booking flow. Display-only; no start, submit or cancel actions. */
window.buildDisplayReceipt=function(value){
 const el=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
 const card=el('div');card.className='reservation-row reservation-compact';
 const identity=el('div');identity.append(el('strong',String(value.room||'').split('_')[0]),el('span',(value.stayDate||'')+' · '+(value.nights||'')));
 const state=el('div');state.className='reservation-compact-state';state.append(el('strong',value.status||'확인 필요'),el('span',value.total||''));
 const details=el('button','상세');details.type='button';details.className='reservation-detail-button';details.setAttribute('aria-expanded','false');
 const more=el('div');more.className='reservation-more';more.hidden=true;more.append(el('span','예약번호 '+(value.id||'미확인')));if(value.depositDeadline)more.append(el('span','입금 기한 '+value.depositDeadline));more.append(el('span','취소는 캠핑장에 문의해 주세요.'));details.onclick=()=>{more.hidden=!more.hidden;details.setAttribute('aria-expanded',String(!more.hidden));};card.append(identity,state,details,more);return card;
};
(() => {
 const byId=id=>document.getElementById(id),phone=!!window.Phone;
 const setHidden=(el,value)=>{if(el&&el.hidden!==value)el.hidden=value;};
 const modes=['priority','multiple','profiles-parallel','watch'];
 const notify=text=>window.showFloatingMessage?.(text,{error:true});
 let scheduled=false,initialized=false,bodies=[],lastNoRoom='',haKey='',lastSync=0,autoTimer=0,autoWanted=false,autoKey='',pendingName='',autoNamed=false,generatedName='';
 window.applyBookingMenus=function(settings={},target=phone?'app':'addon'){
  const choices=settings[target+'Menus']||{};if(phone)labels.none='메뉴 없음';
  const visibleModes=phone?[...modes,'book','people','monthly','logs']:modes;
  for(const tab of visibleModes){const item=document.querySelector('[data-workspace-tab="'+tab+'"]');setHidden(item,choices[tab]===false);if(phone){const name=settings.appMenuLabels?.[tab]||({priority:'단독 예약',multiple:'다중 예약','profiles-parallel':'다인 예약',watch:'취소 대기'})[tab]||labels[tab];labels[tab]=name;if(item&&item.textContent!==name)item.textContent=name;}}
  if(phone)setHidden(document.querySelector('[data-workspace-tab=settings]'),true);
  const current=typeof workspaceTab==='string'?workspaceTab:'priority';
  if(phone&&byId('workspaceMenuLabel')&&byId('workspaceMenuLabel').textContent!==labels[current])byId('workspaceMenuLabel').textContent=labels[current];
  if((visibleModes.includes(current)&&choices[current]===false)||(phone&&current==='none'&&visibleModes.some(m=>choices[m]!==false))){const next=visibleModes.find(m=>choices[m]!==false)||(phone?'none':'people');phone?switchTab(next):switchWorkspaceTab(next);if(next==='none')byId('workspaceMenuLabel').textContent='메뉴 없음';}
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
   const input=label.querySelector('input,select,textarea');if(input&&(required.has(input.id)||/^(reserverName|phone)\d+$/.test(input.id)||['name','phone'].includes(input.name))){
    input.dataset.bookingRequired='true';
    let caption=label.querySelector(':scope>.field-label-text,:scope>.stay-label-line');
    if(!caption){caption=document.createElement('span');caption.className='field-label-text';const text=[...label.childNodes].filter(n=>n.nodeType===3);label.insertBefore(caption,label.firstChild);for(const node of text)caption.append(node);}
    const line=caption.classList.contains('stay-label-line')?caption.querySelector('span')||caption:caption;
    if(!line.querySelector('.required-tag')){const tag=document.createElement('small');tag.textContent='(필수)';tag.className='required-tag';line.append(tag);}
   }
  });
 }
 function missingRequired(input){
  if(!input||input.disabled||input.readOnly&&input.id==='triggerAt'||!input.getClientRects().length)return false;
  const value=input.value.trim();
  if(!value)return true;
  if(/phone/i.test(input.id)||input.name==='phone')return !/^01\d{8,9}$/.test(value.replace(/\D/g,''));
  return !input.validity.valid;
 }
 let correctingUntil=0,scrollCheck=0,lastScrollY=0;
 function firstRequired(item){
  if(!item.toggle.getClientRects().length)return;
  const collapsed=item.body.hidden;item.body.hidden=false;
  const missing=[...item.body.querySelectorAll('[data-booking-required]')].find(missingRequired);
  if(missing)item.toggle.setAttribute('aria-expanded','true');else item.body.hidden=collapsed;
  return missing;
 }
 function showRequired(input){
  if(!missingRequired(input)||document.querySelector('dialog[open]'))return;
  autoWanted=false;clearTimeout(autoTimer);autoTimer=0;correctingUntil=performance.now()+1200;
  input.classList.add('required-input-error');input.setAttribute('aria-invalid','true');
  const title=input.closest('label')?.querySelector('.field-label-text,.stay-label-line>span:first-child')?.textContent.replace('(필수)','').trim()||input.getAttribute('aria-label')||input.placeholder||'필수 항목';
  notify(title+(/phone/i.test(input.id)||input.name==='phone'?' 형식을 확인해 주세요.':' 입력이 필요합니다.'));
  input.scrollIntoView({block:'center',behavior:'smooth'});input.focus({preventScroll:true});
 }
 function initializeRequiredValidation(){
  const fields=root=>[...root.querySelectorAll('[data-booking-required]')];
  document.addEventListener('input',event=>{const input=event.target;if(input.classList.contains('required-input-error')&&!missingRequired(input)){input.classList.remove('required-input-error');input.removeAttribute('aria-invalid');}},true);
  document.addEventListener('focusout',event=>{const input=event.target;if(input.dataset.bookingRequired!=='true'||event.relatedTarget?.classList.contains('required-input-error'))return;setTimeout(()=>{if(!input.isConnected||!modes.includes(workspaceTab)&&!input.closest('#lookupCard,#bookingBookCard'))return;showRequired(input);},0);},true);
  const nextStep=event=>{
   const heading=event.target.closest('.booking-step-title');if(!heading||!modes.includes(workspaceTab))return;
   const index=bodies.findIndex(item=>item.toggle===heading);if(index<1)return;
   let missing;for(const item of bodies.slice(0,index)){missing=firstRequired(item);if(missing)break;}
   if(missing){event.preventDefault();event.stopImmediatePropagation();showRequired(missing);}
  };
  document.addEventListener('click',nextStep,true);
  document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')nextStep(event);},true);
  window.addEventListener('scroll',()=>{
   const down=window.scrollY>lastScrollY;lastScrollY=window.scrollY;clearTimeout(scrollCheck);
   if(!down||performance.now()<correctingUntil||!modes.includes(workspaceTab))return;
   scrollCheck=setTimeout(()=>{
    if(performance.now()<correctingUntil||document.querySelector('dialog[open]'))return;
    let missing;for(const item of bodies){
     if(item.body.hidden&&item.toggle.getBoundingClientRect().bottom<70){missing=firstRequired(item);}
     else missing=fields(item.body).find(input=>missingRequired(input)&&input.getBoundingClientRect().bottom<70);
     if(missing)break;
    }
    if(missing)showRequired(missing);
   },160);
  },{passive:true});
 }
 function initialize(){
  if(initialized||!byId('startDate')||phone&&!window.featuresReady&&typeof featuresReady==='undefined')return;
  if(phone&&typeof featuresReady!=='undefined'&&!featuresReady)return;
  initialized=true;
  const date=byId('startDate').closest('section'),person=byId('reserverName').closest('section'),room=byId('roomList').closest('section');
  date.before(person);
  for(const [i,section]of [person,date,room].entries()){
   const title=section.querySelector('.section-title');title.querySelector('span').textContent=String(i+1);
   title.querySelector('h2').textContent=['예약자 정보','기간','객실 선택'][i];
   const body=document.createElement('div');body.className='booking-step-body';
   for(const child of [...section.children])if(child!==title)body.append(child);
   const toggle=title;toggle.classList.add('booking-step-title');toggle.setAttribute('role','button');toggle.tabIndex=0;body.id='booking-step-body-'+(i+1);toggle.setAttribute('aria-controls',body.id);
   const flip=()=>{if(toggle.getAttribute('aria-disabled')==='true')return;body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));};
   toggle.addEventListener('click',flip);toggle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip();}});
   section.append(body);bodies.push({body,toggle,ready:false});
  }
  for(const id of ['inspectButton','watchSelectAll','watchDeselectAll'])setHidden(byId(id),true);
  for(const el of document.querySelectorAll('.section-title p,#roomDragHelp,#profileModeHelp,#phoneBatchNote,.log-help,.site-choice-message,.site-choice-empty'))el.classList.add('compact-explanation');

  const request=byId('campRequest');if(request){request.closest('label').classList.add('full-field');request.rows=2;}
  const linkRow=document.createElement('div');linkRow.className='app-link-row';
  const official=document.createElement('a');official.className='official-small official-site-link';official.textContent='공식 예약 사이트';official.href='https://www.swimozicamp.com/camp/';official.target='_blank';official.rel='noopener noreferrer';if(phone)official.addEventListener('click',e=>{e.preventDefault();try{api('openMonthly');}catch(error){showError(error);}});linkRow.append(official);document.querySelector('header').append(linkRow);
  if(!phone){const update=document.createElement('a');update.className='official-small';update.textContent='앱 업데이트';update.href='https://github.com/kojungho/swim-reservation-ha-app/releases/latest';update.target='_blank';update.rel='noopener noreferrer';linkRow.prepend(update);}
  document.querySelectorAll('.one-off-lookup summary').forEach(el=>el.textContent='비회원 조회');
  document.querySelectorAll('.one-off-lookup').forEach(section=>{section.open=false;const fields=document.createElement('div');fields.className='nonmember-fields';for(const input of section.querySelectorAll('input')){input.placeholder=input.id==='oneOffName'?'예약자명':input.id==='oneOffPhone'?'휴대폰 번호':input.placeholder;input.setAttribute('aria-label',input.getAttribute('aria-label')||'비회원 조회 '+input.placeholder);fields.append(input);}const button=section.querySelector('button');if(button)fields.append(button);section.querySelector('summary').after(fields);for(const el of section.querySelectorAll(':scope>p,:scope>.lookup-fields,:scope>.section-actions'))el.remove();});
  const selector=byId('siteProfileSelect');if(selector){const label=selector.closest('label');for(const text of [...label.childNodes])if(text.nodeType===3)text.textContent='예약자 ';}
  const intro=byId('lookupCard').querySelector(':scope>p:not([id])');if(intro)intro.textContent='선택한 예약자의 내역만 조회합니다.';
  if(phone){
   const connection=document.createElement('div');connection.className='ha-connection';
   const update=document.createElement('button');update.type='button';update.className='official-small';update.textContent='앱 업데이트';update.onclick=()=>api('checkUpdates');
   const state=document.createElement('small');state.id='haConnectionState';linkRow.prepend(update);connection.append(state);document.querySelector('header').append(connection);
   // Execution permissions are requested by native dialogs at the point of use.
   setHidden(byId('settingsCard'),true);window.applyDisplaySync(nativeState.haDisplay);
   const previousRead=readPlan;readPlan=function(){if(workspaceTab!=='watch')byId('triggerAt').value=beforeOpening()?bookingOpenIso(byId('startDate').value):'';const value=previousRead(),interval=nativeState.haDisplay?.cached?.submitIntervalSeconds;if(Number.isInteger(interval)&&interval>=0&&interval<=60)value.submitInterval=interval;return value;};
   const originalSwitch=switchTab;switchTab=function(tab){if(tab==='settings')return;originalSwitch(tab);queue();};
   const originalApply=applyUi;applyUi=function(){originalApply();setHidden(byId('reservationConnectionDetails'),true);};
   const originalUpdate=updateStayFields;updateStayFields=function(){originalUpdate();setHidden(byId('stayOpeningDate'),true);};

   setHidden(byId('reservationConnectionDetails'),true);
  }
  const trigger=byId('triggerAt')?.closest('label');if(trigger){bodies[1].body.append(trigger);const caption=[...trigger.childNodes].find(n=>n.nodeType===3);if(caption)caption.textContent='예약 실행 시간(오픈 예정일)';byId('triggerAt').readOnly=true;byId('triggerAt').setAttribute('aria-readonly','true');byId('triggerAt').tabIndex=-1;}
  const safety=byId('safetyNotice');if(safety){const detail=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='실행 안전 안내';text.textContent=phone?'전원·네트워크·절전 제한으로 실행이 중단될 수 있습니다.':'서버 전원·네트워크와 시간을 확인하세요.';detail.append(summary,text);safety.replaceChildren(detail);}
  markLabels();initializeRequiredValidation();
  byId('historyCard').querySelector('h2').textContent='예약 대기 일정 등록 및 예약 이력';
  const nameLabel=byId('planName').closest('label');for(const child of nameLabel.childNodes)if(child.nodeType===3)child.textContent='예약 대기 일정 명칭';
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
  const ready=[true,personReady,validDate&&personReady];
  bodies.forEach((item,i)=>{item.toggle.disabled=!ready[i];const disabled=String(!ready[i]);if(item.toggle.getAttribute('aria-disabled')!==disabled)item.toggle.setAttribute('aria-disabled',disabled);if(!ready[i])setHidden(item.body,true);else if(!item.ready)setHidden(item.body,false);item.ready=ready[i];const expanded=String(!item.body.hidden);if(item.toggle.getAttribute('aria-expanded')!==expanded)item.toggle.setAttribute('aria-expanded',expanded);});
  const trigger=byId('triggerAt')?.closest('label');setHidden(trigger,!validDate||workspaceTab==='watch'||!beforeOpening());
  const planned=validDate&&beforeOpening(),name=byId('planName');setHidden(name.closest('label'),!planned);
  if(autoNamed&&name.value!==generatedName){autoNamed=false;pendingName=name.value;}
  if(planned){if(autoNamed){name.value=pendingName;autoNamed=false;}}
  else if(validDate&&workspaceTab!=='watch'){
   if(!autoNamed)pendingName=name.value;
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(phone?currentSiteTime():Date.now()));
   if(name.value!==today)name.value=today;autoNamed=true;generatedName=today;
  }
  setHidden(byId('stayOpeningDate'),true);
  setHidden(byId('stayNightsDisplay'),!validDate||!uiSettings.stayRange);
  if(!validDate&&byId('stayNightsDisplay').textContent)byId('stayNightsDisplay').textContent='';
  if(validDate&&beforeOpening()){const opening=bookingOpenIso(date);if(opening)byId('triggerAt').value=opening;}
  if(phone)setHidden(document.querySelector('[data-phone-run]'),!validDate||beforeOpening()||workspaceTab==='watch');
  document.querySelectorAll('.room-actions').forEach(el=>setHidden(el,true));
  const roomSection=byId('roomList').closest('section');
  for(const editor of roomSection.querySelectorAll('.site-choice-editor')){
   const host=editor.closest('#roomList')?roomSection:editor.closest('.second-profile-panel,.phone-rank-panel');if(!host)continue;
   host.classList.add('site-choice-positioned');const style=getComputedStyle(host);for(const [name,value]of [['--choice-top',style.paddingTop],['--choice-right',style.paddingRight]])if(host.style.getPropertyValue(name)!==value)host.style.setProperty(name,value);
   const heading=host===roomSection?host.querySelector('.section-title'):host.querySelector(':scope>h3');heading?.classList.add('site-choice-heading');
  }
  for(const el of bodies[0].body.querySelectorAll('button,a'))if(el.textContent.includes('공식'))setHidden(el,true);
  if(autoWanted&&ready[2]&&modes.includes(workspaceTab)&&!autoTimer){
   const key=identityKey();autoTimer=setTimeout(()=>{autoTimer=0;if(!autoWanted||identityKey()!==key||document.hidden||document.querySelector('dialog[open]'))return;autoWanted=false;if(autoKey===key)return;autoKey=key;
    setHidden(bodies[2].body,false);bodies[2].toggle.setAttribute('aria-expanded','true');
    const button=[...bodies[2].body.querySelectorAll('.site-choice-tools button')].find(el=>!el.disabled&&el.getClientRects().length);
    if(!button)return;setHidden(bodies[2].body,false);bodies[2].toggle.setAttribute('aria-expanded','true');bodies[2].toggle.scrollIntoView({block:'start',behavior:'smooth'});button.click();
   },650);
  }
  markLabels();
  document.querySelectorAll('.required-input-error').forEach(input=>{if(!missingRequired(input)&&input.value.trim()){input.classList.remove('required-input-error');input.removeAttribute('aria-invalid');}});
  if(phone){document.querySelectorAll('#phonePeople .phone-person-card').forEach((card,i)=>{const p=phonePeople[i],valid=validDate&&p?.name?.trim()&&/^01\d{8,9}$/.test((p?.phone||'').replace(/\D/g,''));setHidden(card.querySelector('.phone-person-ranks'),!valid);});}
  for(const id of ['inspectButton','watchSelectAll','watchDeselectAll'])setHidden(byId(id),true);
  if(phone){window.applyBookingMenus(uiSettings);setHidden(byId('settingsCard'),true);for(const id of ['galleryDeleteSelected','galleryDeleteAll','siteMapUploadButton','mapGallery'])setHidden(byId(id),true);setHidden(document.querySelector('.gallery-heading'),true);
   if(Date.now()-lastSync>60000&&!document.hidden){lastSync=Date.now();try{api('haSync');}catch(e){/* Keep cached display, no booking state changes. */}}
  }else if(typeof uiSettings!=='undefined')window.applyBookingMenus(uiSettings);
  const states=(phone?vault.rooms.map(phoneChoiceState):rooms.map(r=>siteChoiceState(r.name)));
  if(states.length&&states.every(s=>['unavailable','booked'].includes(s.kind))){const key=date+'/'+nights;if(lastNoRoom!==key){lastNoRoom=key;notify('선택한 기간에 예약 가능한 사이트가 없습니다.');}}else lastNoRoom='';
 }
 function beforeOpening(){
  const date=byId('startDate').value,nights=Number(byId('nights').value);if(!date)return false;
  return phone?!!window.stayCalendar?.planned(date,nights)||Date.parse(bookingOpenIso(date)+'+09:00')>currentSiteTime():plannedSiteChoices();
 }
 function identityKey(){
  const people=workspaceTab==='profiles-parallel'?(phone?phonePeople.map(p=>[p.name,p.phone]):[{reserverName:byId('reserverName').value,phone:byId('phone').value},...extraProfiles].map(p=>[p.reserverName,p.phone])):[[byId('reserverName').value,byId('phone').value]];
  return JSON.stringify([workspaceTab,byId('startDate').value,byId('nights').value,people]);
 }
 function userEdited(event){
  if(!initialized||!modes.includes(workspaceTab))return;
  if(!bodies.slice(0,2).some(item=>item.body.contains(event.target))||event.target.id==='triggerAt')return;
  if(event.target.closest('.site-choice-editor'))return;
  autoWanted=true;clearTimeout(autoTimer);autoTimer=0;queue();
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
 window.addEventListener('online',()=>{lastSync=0;if(phone){try{api('haSync',{reconnect:true});}catch(e){/* Retain cached display until the next automatic retry. */}}queue();});
 document.addEventListener('DOMContentLoaded',()=>{queue();document.addEventListener('input',userEdited,true);document.addEventListener('change',userEdited,true);document.addEventListener('click',e=>{if(e.target.closest('.site-choice-tools button')){autoWanted=false;clearTimeout(autoTimer);autoTimer=0;}});document.addEventListener('roomorderchange',queue);new MutationObserver(queue).observe(document.querySelector('main'),{childList:true,subtree:true});setInterval(queue,1200);});
})();

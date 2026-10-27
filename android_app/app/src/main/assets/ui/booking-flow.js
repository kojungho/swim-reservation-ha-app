/* Shared compact booking flow. Display-only; no start, submit or cancel actions. */
window.validPersonName=function(value){
 if(typeof value!=='string')return false;const name=value.trim().normalize('NFC');
 return /^[가-힣]{2,50}$/u.test(name);
};
window.bookingProfileSaveError=function(profile={}){
 const name=String(profile.reserverName??profile.name??'').trim(),phone=String(profile.phone||'').replace(/\D/g,'');
 const errors=[];
 if(!name)errors.push('예약자명과 휴대폰 번호는 예약 확인에 사용하는 필수 정보입니다. 예약자명을 한글 2~50글자로 입력하세요.');
 else if(!validPersonName(name))errors.push('예약자명은 공백 없이 완성된 한글 2~50글자만 사용할 수 있습니다. 영문·외국어·숫자·기호·자음·모음만 입력한 이름은 저장할 수 없습니다.');
 if(!/^01\d{8,9}$/.test(phone))errors.push('휴대폰 번호를 01로 시작하는 10~11자리 숫자로 입력하세요.');
 if(String(profile.depositorName??profile.payer??'').trim().length>50)errors.push('입금자명은 50글자 이내로 입력하세요.');
 return errors.length?'저장하지 못했습니다. '+errors.join(' ')+' 입금자명은 비워도 됩니다.':'';
};
window.bookingConfirmationText=function(config,quote={}){
 const names=profile=>(profile.roomPriority||[]).filter(r=>r.enabled).map(r=>r.name);
 const groups=config.bookingMode==='profiles-parallel'?(config.profiles||[]).map(names):[names(config)];
 const money=name=>quote.quotes?.find(q=>q.name===name)?.total;
 const format=amount=>Number.isSafeInteger(amount)&&amount>0?amount.toLocaleString('ko-KR')+'원':'공식 금액 미확인';
 const lines=groups.flatMap((group,i)=>group.map(name=>{
  const item=quote.quotes?.find(q=>q.name===name),daily=(item?.nightlyRates||[]).map(row=>'  '+row.date+' · '+row.type+' '+format(row.amount));
  return (groups.length>1?'예약자 '+(i+1)+' · ':'')+name.split('_')[0]+' / '+format(money(name))+'\n'+(daily.length?daily.join('\n'):'  날짜별 요금 미확인');
 }));
 const selected=config.bookingMode==='multiple'?groups.flat():groups.every(g=>g.length===1)?groups.flat():[];
 const total=selected.length&&selected.every(name=>money(name)>0)?format(selected.reduce((sum,name)=>sum+money(name),0)):groups.some(g=>g.length>1)?'우선순위 중 실제 예약되는 사이트의 금액':'공식 금액 미확인';
 return '입실일 '+config.startDate+' / 퇴실일 '+stayEndDate(config.startDate,config.nights)+' / '+config.nights+'박\n\n'+(lines.join('\n')||'사이트 선택 필요')+'\n총 숙박비: '+total+'\n\n입금 계좌: 농협 317-0028-3427-31\n예금주: (주)쉼오지캠프\n\n예약 후 24시간 이내 입금하지 않을 시 자동으로 예약이 취소됩니다.';
};
let bookingConfirmPending=false;
window.confirmBooking=async function(entry){
 if(bookingConfirmPending)return false;bookingConfirmPending=true;
 try{
 const config=entry.config,groups=config.bookingMode==='profiles-parallel'?config.profiles||[]:[config];
 const roomNames=[...new Set(groups.flatMap(p=>(p.roomPriority||[]).filter(r=>r.enabled).map(r=>r.name)))];
 let quote={};try{quote=await request('booking-quote',{method:'POST',body:JSON.stringify({startDate:config.startDate,nights:Number(config.nights),adults:config.adults,roomNames})});}catch{/* Unverified prices are never guessed. */}
 return window.confirm(bookingConfirmationText(config,quote));
 }finally{bookingConfirmPending=false;}
};
window.buildDisplayReceipt=function(value){
 const el=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
 const card=el('div');card.className='reservation-row reservation-compact';
 const identity=el('div');identity.append(el('strong',String(value.room||'').split('_')[0]),el('span',(value.stayDate||'')+' · '+(value.nights||'')));
 const state=el('div');state.className='reservation-compact-state';state.append(el('strong',value.status||'확인 필요'),el('span',value.total||''));
 const details=el('button','상세');details.type='button';details.className='reservation-detail-button';details.setAttribute('aria-expanded','false');
 const more=el('div');more.className='reservation-more';more.hidden=true;
 more.append(el('span','예약번호 '+(value.id||'미확인')),el('span','사이트 '+String(value.room||'').split('_')[0]),el('span','입실일 '+(value.stayDate||'미확인')+' / 퇴실일 '+(value.checkout||'미확인')+' / '+(value.nights||'미확인')),el('span','총 숙박비 '+(value.total||'미확인')));
 if(value.guests)more.append(el('span','인원 '+value.guests));
 for(const row of value.nightlyRates||[])more.append(el('span',row.date+' · '+row.type+' '+Number(row.amount).toLocaleString('ko-KR')+'원'));
 more.append(el('span','입금 계좌: '+(value.bankAccount||'농협 317-0028-3427-31')),el('span','예금주: '+(value.bankHolder||'(주)쉼오지캠프')));
 if(value.depositDeadline)more.append(el('span','입금 기한 '+value.depositDeadline));
 more.append(el('span',value.depositNotice||'예약 후 24시간 이내 입금하지 않을 시 자동으로 예약이 취소됩니다.'),el('span','현재 예약 상태와 공식 입금 기한을 확인하세요.'),el('span','취소는 캠핑장에 문의해 주세요.'));details.onclick=()=>{more.hidden=!more.hidden;details.setAttribute('aria-expanded',String(!more.hidden));};card.append(identity,state,details,more);return card;
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
  byId('siteMapMessage').textContent='';
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
  if(nameInput(input))return !validPersonName(value);
  if(/phone/i.test(input.id)||input.name==='phone')return !/^01\d{8,9}$/.test(value.replace(/\D/g,''));
  return !input.validity.valid;
 }
 const composingNames=new WeakSet();
 function nameInput(input){return /^(reserverName|bookReserverName|oneOffName)\d*$/.test(input.id)||input.name==='name';}
 let correctingUntil=0,scrollCheck=0,lastScrollY=0,validationEpoch=0,resettingValidation=false,choosingProfile=false,lastRequiredMessage='';
 function savedProfileControl(target){return target?.closest?.('select[id^="bookingProfileSelect"],#watchProfileSelect,#multipleProfileSelect,#phonePeople select,.booking-select-field');}
 function beginProfileChoice(){
  if(choosingProfile)return;choosingProfile=true;validationEpoch++;clearTimeout(scrollCheck);clearTimeout(autoTimer);scrollCheck=autoTimer=0;autoWanted=false;
  const message=byId('floatingMessage');if(message?.querySelector('span')?.textContent===lastRequiredMessage){clearTimeout(message.hideTimer);message.hidden=true;}
  if(phone){try{api('hideKeyboard');}catch(error){/* Native selector remains usable without the optional IME request. */}}
 }
 window.beginBookingReset=function(){
  resettingValidation=true;choosingProfile=false;validationEpoch++;clearTimeout(scrollCheck);clearTimeout(autoTimer);scrollCheck=autoTimer=0;autoWanted=false;autoKey='';correctingUntil=0;pendingName='';autoNamed=false;generatedName='';
  for(const item of bodies)item.body.querySelectorAll('.required-input-error').forEach(input=>{input.classList.remove('required-input-error');input.removeAttribute('aria-invalid');});
  const message=byId('floatingMessage');if(message){clearTimeout(message.hideTimer);message.hidden=true;}
 };
 window.finishBookingReset=function(){
  resettingValidation=false;lastScrollY=window.scrollY;refresh();
  const missing=bodies[0]&&firstRequired(bodies[0]);if(missing)showRequired(missing);
 };
 function firstRequired(item){
  if(!item.toggle.getClientRects().length)return;
  const collapsed=item.body.hidden;item.body.hidden=false;
  const missing=[...item.body.querySelectorAll('[data-booking-required]')].find(missingRequired);
  if(missing)item.toggle.setAttribute('aria-expanded','true');else item.body.hidden=collapsed;
  return missing;
 }
 function showRequired(input){
  if(resettingValidation||choosingProfile||composingNames.has(input)||savedProfileControl(document.activeElement)||!missingRequired(input)||document.querySelector('dialog[open]'))return;
  if(modes.includes(workspaceTab)&&bodies.some(item=>item.body.contains(input))){for(const item of bodies){const earlier=firstRequired(item);if(earlier){input=earlier;break;}if(item.body.contains(input))break;}}
  autoWanted=false;clearTimeout(autoTimer);autoTimer=0;correctingUntil=performance.now()+1200;
  input.classList.add('required-input-error');input.setAttribute('aria-invalid','true');
  const title=input.closest('label')?.querySelector('.field-label-text,.stay-label-line>span:first-child')?.textContent.replace('(필수)','').trim()||input.getAttribute('aria-label')||input.placeholder||'필수 항목';
  lastRequiredMessage=nameInput(input)&&input.value.trim()?title+'은 공백 없이 완성된 이름을 한글 2~50글자로 입력해 주세요.':title+(/phone/i.test(input.id)||input.name==='phone'?' 형식을 확인해 주세요.':' 입력이 필요합니다.');notify(lastRequiredMessage);
  input.scrollIntoView({block:'center',behavior:'smooth'});input.focus({preventScroll:true});
  if(phone&&!input.readOnly&&input.matches('textarea,input:not([type=date]):not([type=datetime-local]):not([type=number])')){try{api('showKeyboard');}catch(error){/* Focus is retained if the keyboard is unavailable. */}}
 }
 function initializeRequiredValidation(){
  const fields=root=>[...root.querySelectorAll('[data-booking-required]')];
  document.addEventListener('compositionstart',event=>{if(nameInput(event.target)){composingNames.add(event.target);validationEpoch++;clearTimeout(autoTimer);autoTimer=0;queue();}},true);
  document.addEventListener('compositionend',event=>{if(nameInput(event.target)){composingNames.delete(event.target);queue();if(document.activeElement!==event.target)queueMicrotask(()=>showRequired(event.target));}},true);
  const choose=event=>{if(savedProfileControl(event.target))beginProfileChoice();else if(choosingProfile){choosingProfile=false;validationEpoch++;if(savedProfileControl(document.activeElement))document.activeElement.blur();}};
  document.addEventListener('pointerdown',choose,true);document.addEventListener('focusin',choose,true);
  document.addEventListener('wheel',choose,{capture:true,passive:true});document.addEventListener('touchmove',choose,{capture:true,passive:true});
  document.addEventListener('change',event=>{if(savedProfileControl(event.target))queueMicrotask(()=>{choosingProfile=false;validationEpoch++;queue();});},true);
  document.addEventListener('input',event=>{const input=event.target;if(!event.isComposing&&!composingNames.has(input)&&input.classList.contains('required-input-error')&&!missingRequired(input)){input.classList.remove('required-input-error');input.removeAttribute('aria-invalid');}},true);
  document.addEventListener('focusout',event=>{const input=event.target,epoch=validationEpoch;if(input.dataset.bookingRequired!=='true'||choosingProfile||savedProfileControl(event.relatedTarget)||event.relatedTarget?.classList.contains('required-input-error')||event.relatedTarget?.closest('.phone-reset-floating,#editorResetButton,#editorResetConfirm,#editorResetCancel'))return;setTimeout(()=>{if(epoch!==validationEpoch||resettingValidation||!input.isConnected||!modes.includes(workspaceTab)&&!input.closest('#lookupCard,#bookingBookCard'))return;showRequired(input);},0);},true);
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
   if(resettingValidation||choosingProfile||!down||performance.now()<correctingUntil||!modes.includes(workspaceTab))return;
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
  document.addEventListener('click',event=>{
   const button=event.target.closest('button');if(!button||!(/^(bookAddButton|saveProfilesButton|saveBookingActor\d+)$/.test(button.id)||button.dataset.profileSave!==undefined))return;
   let profile;
   if(button.id==='bookAddButton')profile={name:byId('bookReserverName').value,phone:byId('bookPhone').value,payer:byId('bookDepositorName').value};
   else if(button.dataset.profileSave!==undefined){const fields=button.closest('.phone-person-card');profile={name:fields.querySelector('[name=name]').value,phone:fields.querySelector('[name=phone]').value,payer:fields.querySelector('[name=payer]').value};}
   else if(phone)profile=profileFromEditor();
   else profile=readConfig().profiles[button.id==='saveProfilesButton'?0:Number(button.id.replace('saveBookingActor',''))-1];
   const error=bookingProfileSaveError(profile);if(error){validationEpoch++;event.preventDefault();event.stopImmediatePropagation();notify(error);}
  },true);
  byId('historyCard').querySelector('h2').textContent='예약 대기 일정 등록 및 예약 이력';
  const nameLabel=byId('planName').closest('label');for(const child of nameLabel.childNodes)if(child.nodeType===3)child.textContent='예약 대기 일정 명칭';
 }
 function refresh(){
  scheduled=false;initialize();if(!initialized)return;
  const date=byId('startDate').value,end=byId('checkoutDate').value,nights=Number(byId('nights').value);
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=(phone?seoulToday():new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()))&&nights>=1&&nights<=6&&(!end||end>date);
  let personReady=validPersonName(byId('reserverName').value)&&/^01\d{8,9}$/.test(byId('phone').value.replace(/\D/g,''));
  if(typeof workspaceTab!=='undefined'&&workspaceTab==='profiles-parallel'){
   if(phone)personReady=phonePeople.length>0&&phonePeople.every(p=>validPersonName(p.name)&&/^01\d{8,9}$/.test(p.phone.replace(/\D/g,'')));
   else personReady=[{reserverName:byId('reserverName').value,phone:byId('phone').value},...extraProfiles].every(p=>validPersonName(p.reserverName)&&/^01\d{8,9}$/.test((p.phone||'').replace(/\D/g,'')));
  }
  if([...bodies[0].body.querySelectorAll('input')].some(input=>composingNames.has(input)))personReady=false;
  const ready=[true,personReady,validDate&&personReady];
  bodies.forEach((item,i)=>{item.toggle.disabled=!ready[i];const disabled=String(!ready[i]);if(item.toggle.getAttribute('aria-disabled')!==disabled)item.toggle.setAttribute('aria-disabled',disabled);if(!ready[i])setHidden(item.body,true);else if(!item.ready)setHidden(item.body,false);item.ready=ready[i];const expanded=String(!item.body.hidden);if(item.toggle.getAttribute('aria-expanded')!==expanded)item.toggle.setAttribute('aria-expanded',expanded);});
  const trigger=byId('triggerAt')?.closest('label');setHidden(trigger,!validDate||workspaceTab==='watch'||!beforeOpening());
  const planned=validDate&&beforeOpening(),name=byId('planName');setHidden(name.closest('label'),!planned);
  const immediate=validDate&&!planned&&workspaceTab!=='watch';
  setHidden(byId('planCard')?.querySelector('.plan-registration'),immediate);
  byId('planCard')?.querySelectorAll(':scope>p').forEach(el=>setHidden(el,immediate));
  const reserveButton=phone?document.querySelector('[data-phone-run]'):byId('runNowButton');if(reserveButton&&reserveButton.textContent!=='예약 하기')reserveButton.textContent='예약 하기';
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

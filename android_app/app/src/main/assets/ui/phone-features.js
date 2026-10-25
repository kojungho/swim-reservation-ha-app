/* Native adapters: no HA server, tokens or remote UI scripts. */
let featuresReady=false, phonePeople=[], submissionInterval=5, featureLookupKey='', featureMonthKey='', phoneClock={synced:false,offset:0}, gallerySelected=new Set(), lastLoadedExtras=null;
let modeEditorMeta={},draftByMode={},suppressDraftSwitch=false,clearedDraftAt=0;
const modeTab=mode=>mode==='reserve'?'priority':mode==='watch'?'watch':mode;
const tabMode=tab=>tab==='priority'?'reserve':tab;
window.stayCalendar=new StayCalendarModel(async month=>{
  const until=performance.now()+25000;let result;
  do{result=api('calendarMonth',{month});if(!result.pending)break;await new Promise(resolve=>setTimeout(resolve,350));}while(performance.now()<until);
  if(!result?.ok)throw Error('달력 조회 미확인');return {month,openThrough:result.openThrough,days:Object.entries(result.days||{}).map(([date,count])=>({date,availableCount:count,beforeOpen:date>result.openThrough}))};
},()=>currentSiteTime());
function phoneDraftSignature(p){return JSON.stringify([p.mode,p.date,p.nights,p.name||'',p.payer||'',p.phone||'',p.rooms||'',p.trigger||0,p.watchUntil||0,p.adults||2,p.arrival||'',p.request||'',p.submitInterval??5,(p.people||[]).map(x=>[x.name||'',x.payer||'',x.phone||'',Array.isArray(x.rooms)?x.rooms.join(', '):x.rooms||''])]);}
const beforeFeaturesRead=readPlan, beforeFeaturesLoad=loadPlan, beforeFeaturesSwitch=switchTab, beforeFeaturesPoll=poll;
readPlan=function(){
  if($('phoneSubmitInterval')&&!$('phoneSubmitInterval').checkValidity())throw Error('제출 간격은 0~60초의 정수입니다.');
  const tab=workspaceTab;let value;try{workspaceTab=tab==='watch'?'watch':'priority';value=beforeFeaturesRead();}finally{workspaceTab=tab;}
  value.mode=tab==='multiple'?'multiple':tab==='profiles-parallel'?'profiles-parallel':tab==='watch'?'watch':'reserve';
  value.submitInterval=Number($('phoneSubmitInterval')?.value??submissionInterval);
  value.watchUntil=$('watchEndsAt')?.value?Date.parse($('watchEndsAt').value+'+09:00'):0;
  value.people=phonePeople.map(person=>({name:person.name.trim(),payer:person.payer.trim(),phone:person.phone.replace(/\D/g,''),rooms:person.rooms.join(', ')}));return value;
};
loadPlan=function(plan={}){
  const wasSuppressed=suppressDraftSwitch;suppressDraftSwitch=true;
  beforeFeaturesLoad(plan);phonePeople=(plan.people||[]).map(p=>({...p,rooms:String(p.rooms||'').split(/[,\n]/).map(n=>n.trim()).filter(Boolean)}));
  submissionInterval=plan.submitInterval??5;if($('phoneSubmitInterval'))$('phoneSubmitInterval').value=String(submissionInterval);
  $('watchEndsAt').value=plan.watchUntil?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(plan.watchUntil)).replace(' ','T'):'';
  lastLoadedExtras=plan;if(plan.mode==='multiple'||plan.mode==='profiles-parallel')switchTab(plan.mode);if(featuresReady)renderPhonePeople();suppressDraftSwitch=wasSuppressed;if(featuresReady)updatePhoneResetVisibility();
};
switchTab=function(tab){
  if(featuresReady&&!suppressDraftSwitch&&tab!==workspaceTab){
    if(['priority','watch','multiple','profiles-parallel'].includes(workspaceTab)){try{const snapshot=readPlan();draftByMode[snapshot.mode]=structuredClone(snapshot);modeEditorMeta[snapshot.mode]={title:$('planName').value,id:editingPlan};api('draft',snapshot);}catch(e){showError(e);return;}}
    const target=draftByMode[tabMode(tab)];if(['priority','watch','multiple','profiles-parallel'].includes(tab)){suppressDraftSwitch=true;loadPlan(target||{mode:tabMode(tab)});suppressDraftSwitch=false;const meta=modeEditorMeta[tabMode(tab)]||{};$('planName').value=meta.title||'';editingPlan=meta.id||'';}
  }
  beforeFeaturesSwitch(tab);if(!featuresReady)return;
  const booking=['priority','watch','multiple','profiles-parallel'].includes(tab);
  for(const section of [$('startDate').closest('section'),$('reserverName').closest('section'),$('roomList').closest('section'),$('historyCard')])section.hidden=!booking;
  $('planCard').hidden=!booking;$('phoneUnsupported').hidden=true;
  $('phonePeople').hidden=tab!=='profiles-parallel';$('firstBookingProfilePanel').hidden=tab==='profiles-parallel';$('roomList').closest('section').hidden=!booking||tab==='profiles-parallel';
  $('phoneBatchNote').hidden=!['multiple','profiles-parallel'].includes(tab);
  $('watchEndsAtField').hidden=false;
  $('roomSectionHelp').textContent=tab==='multiple'?'선택한 사이트 각각을 한 번씩 예약합니다. 같은 폰의 세션은 순차 실행합니다.':tab==='watch'?'선택한 사이트 중 빈자리 하나를 예약합니다. 조회 간격은 최소 10분입니다.':'동그라미 숫자 순서대로 사이트 하나가 성공할 때까지 진행합니다.';
  if(tab==='profiles-parallel'&&!phonePeople.length){phonePeople=[{name:$('reserverName').value,payer:$('depositorName').value,phone:$('phone').value,rooms:roomOrder.filter(n=>selected.has(n))}];renderPhonePeople();}
  if(tab==='monthly'&&nativeState.monthly?.month!==$('monthlyMonth').value){requestPhoneMonth();}
  updatePhoneResetVisibility();
};
currentSiteTime=function(){return Date.now()+(phoneClock.synced?phoneClock.offset:0);};
poll=function(){
  beforeFeaturesPoll();if(!featuresReady)return;
  runPhonePeriodCheck();
  const state=nativeState;
  if(state.draftClearedAt&&state.draftClearedAt!==clearedDraftAt){clearedDraftAt=state.draftClearedAt;const cleared=state.clearedDraft;if(cleared){delete draftByMode[cleared.mode];try{if(['priority','watch','multiple','profiles-parallel'].includes(workspaceTab)&&phoneDraftSignature(readPlan())===phoneDraftSignature(cleared))loadPlan({mode:cleared.mode});}catch(error){/* Keep an edited, incomplete draft intact. */}}}
  if(state.stage==='PARTIAL'){$('statusBadge').textContent='일부 완료 · 확인 필요';$('statusBadge').className='badge failed';}
  if(Array.isArray(state.catalog)){const added=state.catalog.filter(n=>!roomOrder.includes(n));if(added.length){vault.rooms=[...new Set([...vault.rooms,...state.catalog])];roomOrder.push(...added);renderRooms();}}
  phoneClock=state.clock||{synced:false,offset:0};
  $('serverTimeButton').querySelector('span').textContent=phoneClock.synced?'서버 시간':'폰 시간 · 미동기화';
  $('siteClock').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(currentSiteTime()));
  $('serverTimeValue').textContent=phoneClock.synced?new Date(currentSiteTime()).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'서버 시간 미동기화';
  $('siteTimeMeta').textContent=phoneClock.synced?`서버 Date 헤더·왕복 지연 보정 · 차이 ${phoneClock.offset}ms · RTT ${phoneClock.rtt}ms · 최근 ${new Date(phoneClock.updated).toLocaleTimeString('ko-KR')}`:state.clockResult?.error||'동기화를 누르면 공식 예약 사이트의 시간만 읽습니다.';
  const lookupKey=JSON.stringify(state.lookup||{});if(lookupKey!==featureLookupKey){featureLookupKey=lookupKey;renderPhoneLookup(state.lookup||{});}
  const monthKey=JSON.stringify(state.monthly||{});if(monthKey!==featureMonthKey){featureMonthKey=monthKey;renderPhoneMonth(state.monthly||{});}
};
function changedPhoneDraft(){document.dispatchEvent(new Event('roomorderchange'));}
function makePersonRanks(person){
  const wrap=node('div',undefined,'phone-person-ranks'),choices=node('select');choices.setAttribute('aria-label','추가할 사이트');
  for(const name of vault.rooms)if(!person.rooms.includes(name))choices.add(new Option(roomLabel(name),name));
  const add=makeButton('사이트 추가',()=>{if(choices.value){person.rooms.push(choices.value);renderPhonePeople();changedPhoneDraft();}});add.disabled=!choices.options.length;
  const tools=node('div',undefined,'phone-rank-add');tools.append(choices,add);wrap.append(tools);
  const list=node('div',undefined,'phone-mini-ranks');
  person.rooms.forEach((name,index)=>{
    const row=node('div',undefined,'phone-person-rank');row.dataset.rankName=name;row.append(node('span',String.fromCodePoint(0x2460+index)+' '+roomLabel(name)));
    const remove=makeButton('×',()=>{person.rooms.splice(index,1);renderPhonePeople();changedPhoneDraft();});remove.setAttribute('aria-label',roomLabel(name)+' 우선순위 제외');
    const drag=makeButton('☰',()=>{});drag.classList.add('room-drag-handle');drag.setAttribute('aria-label',roomLabel(name)+' 순서 이동');let saved=null;
    drag.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary)return;e.preventDefault();saved=[...person.rooms];drag.setPointerCapture(e.pointerId);});
    drag.addEventListener('pointermove',e=>{if(!saved)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.phone-person-rank');if(!target||target.parentElement!==list||target===row)return;const from=person.rooms.indexOf(name),to=person.rooms.indexOf(target.dataset.rankName);person.rooms.splice(from,1);person.rooms.splice(to,0,name);list.insertBefore(row,from<to?target.nextSibling:target);drag.setPointerCapture(e.pointerId);});
    drag.addEventListener('pointerup',()=>{saved=null;renderPhonePeople();changedPhoneDraft();});drag.addEventListener('pointercancel',()=>{if(saved)person.rooms=saved;saved=null;renderPhonePeople();});
    drag.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const from=person.rooms.indexOf(name),to=from+(e.key==='ArrowUp'?-1:1);if(to>=0&&to<person.rooms.length){[person.rooms[from],person.rooms[to]]=[person.rooms[to],person.rooms[from]];renderPhonePeople();changedPhoneDraft();}});
    row.append(remove,drag);list.append(row);
  });wrap.append(list);return wrap;
}
function renderPhonePeople(){
  const area=$('phonePeople');if(!area)return;area.replaceChildren();
  phonePeople.forEach((person,index)=>{
    const card=node('article',undefined,'phone-person-card'),heading=node('div',undefined,'phone-person-heading');heading.append(node('h3','예약자 '+(index+1)));
    if(phonePeople.length>1){const remove=makeButton('×',()=>{if(confirm('현재 일정에서 예약자 '+(index+1)+'을 제외할까요? 저장된 예약자와 실제 예약은 유지합니다.')){phonePeople.splice(index,1);renderPhonePeople();changedPhoneDraft();}});remove.setAttribute('aria-label','예약자 제외');heading.append(remove);}card.append(heading);
    const saved=node('select');saved.setAttribute('aria-label','예약자 '+(index+1)+' 저장 목록');saved.add(new Option('직접 입력 / 저장 예약자 선택',''));for(const p of vault.profiles)saved.add(new Option(p.name,p.id));saved.addEventListener('change',()=>{const p=vault.profiles.find(p=>p.id===saved.value);if(p){Object.assign(person,{name:p.name,payer:p.payer||'',phone:p.phone});renderPhonePeople();changedPhoneDraft();}});card.append(saved);
    const fields=node('div',undefined,'grid two identity-fields');for(const[key,label]of[['name','예약자명'],['payer','입금자명 (선택)'],['phone','휴대폰 번호']]){const row=node('label',label),input=node('input');input.value=person[key]||'';input.autocomplete='off';if(key==='phone')input.inputMode='numeric';if(key==='payer')input.placeholder='미입력 시 예약자명';input.addEventListener('input',()=>{person[key]=input.value;});row.append(input);fields.append(row);}card.append(fields,makeButton('예약자 저장',()=>{vault=api('profilePut',{name:person.name,payer:person.payer,phone:person.phone});renderProfiles();renderPhonePeople();}),makePersonRanks(person));area.append(card);
  });
  const add=makeButton('+',()=>{phonePeople.push({name:'',payer:'',phone:'',rooms:[]});renderPhonePeople();changedPhoneDraft();});add.classList.add('phone-person-add');add.setAttribute('aria-label','예약자 추가');add.disabled=phonePeople.length>=vault.rooms.length;area.append(add);
}
function requestPhoneLookup(profiles){try{featureLookupKey='';api('lookup',profiles?{profiles}:{});$('phoneLookupStatus').textContent='예약 내역 조회 중…';}catch(e){showError(e);}}
function renderPhoneLookup(result){
  const status=$('phoneLookupStatus'),list=$('phoneLookupResults');if(!status||!list)return;status.textContent=result.pending?'예약 내역 조회 중…':result.cancelled?'조회 중지됨':result.error||result.capturedAt?result.error||`조회 완료 · ${(result.rows||[]).length}건 / 실패 ${(result.errors||[]).length}명`:'';
  list.replaceChildren();for(const profile of result.profiles||[]){const group=node('section',undefined,'reservation-person-group');group.append(node('h3',profile.label));const rows=(result.rows||[]).filter(row=>row.profileIndex===profile.profileIndex),error=(result.errors||[]).find(e=>e.profileIndex===profile.profileIndex);
    if(error)group.append(node('p','조회 실패: '+error.message,'error'));else if(!rows.length)group.append(node('p','내역 없음 · 입력한 이름과 연락처도 확인하세요.'));
    for(const row of rows){const card=node('div',undefined,'phone-receipt');card.append(node('strong',roomLabel(row.room)),node('span',row.status),node('small',row.stayDate+' · '+row.nights),node('span',row.total));const details=node('details'),summary=node('summary','상세');details.append(summary,node('p','예약번호 '+row.id));if(row.depositDeadline)details.append(node('p','입금 기한 '+row.depositDeadline));details.append(node('p','취소는 캠핑장에 전화 문의해 주세요.'));card.append(details);group.append(card);}list.append(group);
  }
}
function requestPhoneMonth(){try{api('monthly',{month:$('monthlyMonth').value});$('monthlyContent').textContent='월별 현황 조회 중…';}catch(e){showError(e);}}
function renderPhoneMonth(result){
  if(!result.month||result.month!==$('monthlyMonth').value)return;const area=$('monthlyContent');area.replaceChildren();
  if(result.pending){area.textContent='월별 현황 조회 중…';return;}if(!result.ok){area.textContent=result.error||'조회 실패 · 0곳으로 판단하지 않습니다.';return;}
  const table=node('table',undefined,'monthly-calendar counts-only'),head=node('tr');for(const name of ['일','월','화','수','목','금','토'])head.append(node('th',name));const thead=node('thead');thead.append(head);table.append(thead);
  const body=node('tbody'),[year,month]=result.month.split('-').map(Number),length=new Date(Date.UTC(year,month,0)).getUTCDate(),offset=new Date(Date.UTC(year,month-1,1)).getUTCDay();let row=node('tr');
  for(let i=0;i<Math.ceil((offset+length)/7)*7;i++){const cell=node('td'),day=i-offset+1;if(day>=1&&day<=length){const date=result.month+'-'+String(day).padStart(2,'0'),count=result.days?.[date],before=date>result.openThrough,past=date<seoulToday(),valid=Number.isInteger(count)&&count>=0;const button=makeButton('',()=>{switchTab('priority');$('startDate').value=date;$('startDate').dispatchEvent(new Event('change',{bubbles:true}));window.scrollTo({top:0,behavior:'smooth'});});button.className='monthly-day';button.disabled=past||!before&&valid&&count===0;button.classList.toggle('past',past);button.append(node('span',String(day),'monthly-day-number'));const label=past?'지난 날짜':before?'예정':valid?count+'곳':'미확인',badge=node('span',label,'monthly-cell monthly-count '+(before||!valid||past?'unknown':count>0?'available':'booked'));button.setAttribute('aria-label',date+' · '+(valid&&!before&&!past?'예약 가능 '+count+'곳':label));button.append(badge);cell.append(button);}row.append(cell);if(i%7===6){body.append(row);row=node('tr');}}
  table.append(body);area.append(table);$('phoneMonthStatus').textContent=`예약 허용 체크인 ${result.openThrough}까지 · 숫자는 예약 가능한 사이트 수 · 개별 사이트·연속 박수는 빈자리 조회로 확인`;
}
window.refreshPhoneMaps=function(){try{const maps=api('maps');$('siteMapImage').src=maps.selected?'map/'+maps.selected+'.jpg':'site-map.png';$('galleryCount').textContent=maps.photos.length+'/6';const gallery=$('mapGallery');gallery.replaceChildren();for(const id of maps.photos){const card=node('article',undefined,'phone-map-card'),image=node('img');image.src='map/'+id+'.jpg';image.alt='등록한 배치도';image.addEventListener('click',()=>{$('mapZoomImage').src=image.src;$('mapZoomDialog').showModal();});const check=node('input');check.type='checkbox';check.setAttribute('aria-label','사진 삭제 대상 선택');check.checked=gallerySelected.has(id);check.addEventListener('change',()=>{check.checked?gallerySelected.add(id):gallerySelected.delete(id);});card.append(image,check,makeButton(maps.selected===id?'사용 중':'적용',()=>{api('mapAction',{action:'select',id});refreshPhoneMaps();}));gallery.append(card);}const add=makeButton('',()=>api('mapPick'));add.id='galleryAddButton';add.className='gallery-add';add.setAttribute('aria-label','배치도 사진 추가');const plus=node('span','＋','gallery-add-symbol');plus.setAttribute('aria-hidden','true');add.append(plus,node('span',maps.photos.length>=6?'6장 가득 참':'추가'));add.disabled=maps.photos.length>=6;gallery.append(add);$('siteMapUploadButton').disabled=add.disabled;return maps;}catch(e){showError(e);}};
document.addEventListener('DOMContentLoaded',()=>{
  if(document.documentElement.dataset.error)return;
  draftByMode=structuredClone(vault.drafts||{});
  const people=node('div');people.id='phonePeople';$('firstBookingProfilePanel').after(people);const note=node('p','폰에서는 사람·사이트별 세션을 순차 실행합니다. 완료된 예약은 유지하며 불확실한 제출 뒤 나머지를 자동 제출하지 않습니다.','phone-inline-note');note.id='phoneBatchNote';people.after(note);
  const common=node('div',undefined,'grid two identity-fields');for(const id of ['campAdults','campArrival','campRequest'])common.append($(id).closest('label'));note.after(common);
  const interval=node('label','다인·다중 최종 제출 간격(초)');const input=node('input');input.id='phoneSubmitInterval';input.type='number';input.min=0;input.max=60;input.value=String(submissionInterval);interval.append(input);$('settingsCard').append(interval);input.addEventListener('change',()=>{submissionInterval=Number(input.value);changedPhoneDraft();});
  $('watchEndsAtField').hidden=false;$('watchEndsAtDetails').querySelector('summary').textContent='조회 간격·감시 종료 시각';$('watchHelp').textContent='시작한 일정만 최소 10분 간격으로 조회합니다. 기본 마감은 입실일 00시이며 종료 시각을 직접 지정할 수 있습니다.';
  const lookup=$('lookupCard');lookup.replaceChildren(node('h2','예약 조회'));const status=node('p');status.id='phoneLookupStatus';const results=node('div');results.id='phoneLookupResults';const actions=node('div',undefined,'phone-plan-actions');actions.append(makeButton('저장 예약자 전체 조회',()=>requestPhoneLookup()),makeButton('조회 중지',()=>api('lookupStop')),makeButton('공식 예약 조회',()=>api('openReceipts')));lookup.append(actions,status,results);const once=node('details'),summary=node('summary','1회성 조회'),name=node('input'),phone=node('input');name.placeholder='예약자명';name.setAttribute('aria-label','1회성 조회 예약자명');phone.placeholder='휴대폰 번호';phone.inputMode='numeric';phone.setAttribute('aria-label','1회성 조회 휴대폰 번호');once.append(summary,name,phone,makeButton('조회',()=>requestPhoneLookup([{name:name.value.trim(),phone:phone.value.replace(/\D/g,'') }])));lookup.append(once);
  const monthly=$('monthlyDialog'),controls=monthly.querySelector('.monthly-controls');$('monthlyContent').before(controls);const footer=monthly.querySelector('.monthly-footer');const meta=node('p');meta.id='phoneMonthStatus';footer.replaceChildren(meta,makeButton('공식 달력 열기',()=>api('openMonthly')));monthly.querySelector('.monthly-legend').textContent='초록: 예약 가능 · 빨강: 잔여 없음 · 회색: 오픈 전·미확인';$('monthlyContent').textContent='조회 버튼을 누르세요.';
  for(const[id,delta]of[['monthlyPrevButton',-1],['monthlyNextButton',1]])action(id,()=>{const[y,m]=$('monthlyMonth').value.split('-').map(Number);$('monthlyMonth').value=new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);requestPhoneMonth();});action('monthlyQueryButton',requestPhoneMonth);$('monthlyMonth').addEventListener('change',requestPhoneMonth);
  $('serverTimeTitle').textContent='공식 사이트 서버 시간';$('siteTimeSyncButton').hidden=false;action('siteTimeSyncButton',()=>api('syncTime'));
  for(const tab of ['multiple','profiles-parallel']){document.querySelector('[data-workspace-tab="'+tab+'"]').textContent=labels[tab];}
  $('settingsCard').querySelector('.app-update').textContent='제출 간격·다인·다중 예약은 폰 내부 엔진에 적용합니다. APK 업데이트는 별도 버튼에서 확인합니다.';
  $('siteMapUploadButton').hidden=false;action('siteMapUploadButton',()=>api('mapPick'));document.querySelector('.gallery-heading').hidden=false;$('mapGallery').hidden=false;$('siteMapMessage').textContent='폰 내부 전용 사진 · 최대 6장. 사진을 눌러 확대하고 적용·선택 삭제할 수 있습니다. HA 사진은 바꾸지 않습니다.';
  for(const[id,all]of[['galleryDeleteSelected',false],['galleryDeleteAll',true]]){$(id).hidden=false;action(id,()=>{const maps=api('maps'),ids=all?maps.photos:maps.photos.filter(id=>gallerySelected.has(id));if(ids.length&&confirm(ids.length+'장 사진을 삭제할까요? 삭제한 사진은 복구할 수 없습니다.')){for(const id of ids)api('mapAction',{action:'delete',id,confirmed:true});gallerySelected.clear();refreshPhoneMaps();}});}
  $('siteMapImage').addEventListener('click',()=>{$('mapZoomImage').src=$('siteMapImage').src;});
  $('bookingHelpDialog').replaceChildren(node('h2','폰 예약 사용 방법'),node('p','단독: 우선순위 중 하나. 다중: 선택한 사이트 각각. 다인: 사람별 우선순위 중 하나. 폰 세션은 순차 실행하며 완료 예약은 유지합니다. 취소 대기는 최소 10분 간격입니다.'),node('p','예약 조회·월별 현황은 읽기 전용이며 온라인 취소는 공식 사이트가 제공하지 않아 전화로 요청해야 합니다. 무통장입금 신청 후 입금은 직접 진행하세요.'),makeButton('닫기',()=>$('bookingHelpDialog').close()));
  featuresReady=true;renderPhonePeople();switchTab(workspaceTab);refreshPhoneMaps();poll();try{api('syncTime');}catch(e){showError(e);}
  for(const event of ['input','change','roomorderchange'])document.addEventListener(event,()=>queueMicrotask(updatePhoneResetVisibility));
  const reset=document.querySelector('.phone-reset-floating');if(reset){const replacement=reset.cloneNode(true);reset.replaceWith(replacement);replacement.addEventListener('click',()=>{if(confirm('현재 화면의 예약 입력만 초기화할까요? 다른 화면의 초안·저장 예약자·등록 일정·실제 예약은 유지합니다.')){const mode=tabMode(workspaceTab);delete draftByMode[mode];delete modeEditorMeta[mode];api('draftReset',{mode});loadPlan({mode});$('planName').value='';editingPlan='';updatePhoneResetVisibility();}});}
  for(const id of ['startDate','nights','campAdults'])$(id).addEventListener('change',queuePhonePeriodCheck);
  updatePhoneResetVisibility();
});

function updatePhoneResetVisibility(){
  const button=document.querySelector('.phone-reset-floating');if(!button)return;
  if(!['priority','watch','multiple','profiles-parallel'].includes(workspaceTab)){button.hidden=true;return;}
  try{
    const p=readPlan(),emptyPerson=person=>!person.name&&!person.payer&&!person.phone&&!person.rooms?.length;
    button.hidden=!(p.date||p.trigger||p.watchUntil||p.name||p.payer||p.phone||p.birth||p.consent||p.rooms||p.nights!==1||p.adults!==2||p.arrival||p.request||
      p.pollSeconds!==600||p.submitInterval!==5||$('planName').value||editingPlan||
      p.people.length>1||p.people.some(person=>!emptyPerson(person))||
      roomOrder.some((name,i)=>name!==vault.rooms[i]));
  }catch(error){button.hidden=false;}
}

let phonePeriodTimer,phonePeriodQueued='',phonePeriodAttempted='';
function queuePhonePeriodCheck(){
  clearTimeout(phonePeriodTimer);phonePeriodTimer=setTimeout(()=>{
    if(!['priority','watch','multiple','profiles-parallel'].includes(workspaceTab))return;
    const key=roomQueryKey();if(!$('startDate').value)return;
    phonePeriodQueued=key;runPhonePeriodCheck();
  },650);
}
function runPhonePeriodCheck(){
  if(!phonePeriodQueued||nativeState.active||nativeState.lookup?.pending||nativeState.monthly?.pending||!nativeState.notifications||document.hidden||!['priority','watch','multiple','profiles-parallel'].includes(workspaceTab))return;
  const key=phonePeriodQueued;
  if(key!==roomQueryKey()){phonePeriodQueued='';return;}
  phonePeriodQueued='';
  if(key===phonePeriodAttempted||window.stayCalendar.planned($('startDate').value,Number($('nights').value)))return;
  phonePeriodAttempted=key;
  try{api('inspect',readPlan());}catch(error){showError(error);}
}

/* Local-only adapter. The add-on HTML/CSS/calendar are bundled; there is no HA API or UI network polling. */
"use strict";
const $=id=>document.getElementById(id);
const elements={startDate:$("startDate"),nights:$("nights")};
const defaults={fonts:{title:28,heading:18,body:14,field:16,button:13,room:14,status:12,calendar:12,list:14,log:12},stayRange:true,dateInputVersion:1,serverTime:true,reservationInfo:true,safety:true,watchInfo:true,mapIcon:true,menuCorner:"top-right",mapCorner:"bottom-right",floatingSize:46,menuSpacing:6};
let seenRunErrors=new Set();
let uiSettings=structuredClone(defaults),vault={profiles:[],plans:[]},roomOrder=[],selected=new Set(),workspaceTab="priority",editingPlan="",editingProfile="",lastStage="",nativeState={},dragRoom=null;
const labels={priority:"단독 예약",multiple:"다중 예약","profiles-parallel":"다인 예약",watch:"취소 대기",book:"예약자 정보",people:"예약 조회",monthly:"월별 예약 현황",logs:"로그",settings:"설정"};
function api(action,data={}){const response=JSON.parse(Phone.request(JSON.stringify({action,data})));if(!response.ok)throw Error(response.error||"폰 내부 처리 실패");return response.data;}
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function showError(error){$("phoneError").textContent=error.message||String(error);$("phoneError").hidden=true;window.showFloatingMessage?.(error.message||String(error),{error:true});}
function action(id,handler){const button=$(id);button.disabled=false;button.addEventListener("click",event=>{event.preventDefault();try{handler(event);}catch(error){showError(error);}});}
function makeButton(text,handler,style="secondary"){const button=node("button",text,style);button.type="button";button.addEventListener("click",()=>{try{handler();}catch(error){showError(error);}});return button;}
function seoulToday(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function currentSiteTime(){return Date.now();} // Display-only phone time, never described as synchronized server time.
function bookingOpenIso(start){if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return "";const [year,month]=start.split("-").map(Number);const day=new Date(Date.UTC(year,month-3,1));return day.toISOString().slice(0,10)+"T00:00:00";}
function stayEndDate(start,nights){if(!start)return "";const date=new Date(start+"T00:00:00Z");date.setUTCDate(date.getUTCDate()+Number(nights));return date.toISOString().slice(0,10);}
function updateStayFields(){const start=$("startDate").value,nights=Number($("nights").value);$("checkoutDate").value=stayEndDate(start,nights);$("checkoutField").hidden=!uiSettings.stayRange;$("nightsField").hidden=uiSettings.stayRange;$("stayNightsDisplay").hidden=!uiSettings.stayRange;$("stayNightsDisplay").textContent=nights+"박";const opening=bookingOpenIso(start);$("stayOpeningDate").hidden=!opening;$("stayOpeningDate").textContent=opening?"예약 오픈일 "+opening.slice(0,10):"";$("openAtValue").textContent=opening?opening.replace("T"," "):"—";$("reservationUrl").textContent=start?"선택한 입실일의 공식 예약 페이지 열기":"입실일을 먼저 선택해 주세요.";}
function readPlan(){const mode=workspaceTab==="watch"?"watch":"reserve";if(!["priority","watch"].includes(workspaceTab))throw Error("이 예약 방식은 아직 폰 엔진에 이식되지 않았습니다.");if(!$("watchInterval").checkValidity())throw Error("취소 대기 조회 간격은 10~60분의 정수입니다.");const trigger=mode==="watch"?"":$("triggerAt").value;return {date:$("startDate").value,nights:Number($("nights").value),name:$("reserverName").value.trim(),payer:$("depositorName").value.trim(),phone:$("phone").value.replace(/\D/g,""),birth:$("birthDate").value.trim(),rooms:roomOrder.filter(name=>selected.has(name)).join(", "),mode,trigger:trigger?Date.parse(trigger+"+09:00"):0,pollSeconds:Number($("watchInterval").value)*60,consent:true,siteVersion:"swimozicamp-v1",adults:Number($("campAdults").value),arrival:$("campArrival").value,request:$("campRequest").value};}
function fillProfile(profile={}){for(const [id,key] of [["reserverName","name"],["depositorName","payer"],["phone","phone"],["birthDate","birth"]])$(id).value=profile[key]||"";}
function loadPlan(plan={}){workspaceTab=plan.mode==="watch"?"watch":"priority";$("startDate").value=plan.date||"";$("nights").value=String(plan.nights||1);fillProfile(plan);$("campAdults").value=String(plan.adults||2);$("campRequest").value=plan.request||"";$("campArrival").value=plan.arrival||"";$("triggerAt").value=plan.trigger?new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date(plan.trigger)).replace(" ","T"):"";$("watchInterval").value=String(Math.max(10,Math.round((plan.pollSeconds||600)/60)));const saved=String(plan.rooms||"").split(/[,\n]/).map(value=>value.trim()).filter(Boolean);selected=new Set(saved);roomOrder=[...new Set([...saved,...vault.rooms])];$("phoneConsent").checked=true;updateStayFields();renderRooms();switchTab(workspaceTab);}
function roomLabel(name){return name.replace("_"," · ");}
function moveRoom(name,delta){const index=roomOrder.indexOf(name),target=index+delta;if(target>=0&&target<roomOrder.length){[roomOrder[index],roomOrder[target]]=[roomOrder[target],roomOrder[index]];renderRooms();}}
let roomDragSession=null, availabilitySnapshot=null, availabilityKey='';
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&roomDragSession){event.preventDefault();endRoomDrag(true);}});
function roomQueryKey(){return $('startDate').value+'/'+$('nights').value+'/'+$('campAdults').value;}
function endRoomDrag(cancel=false){
  const session=roomDragSession;if(!session)return;roomDragSession=null;dragRoom=null;cancelAnimationFrame(session.frame);
  if(cancel)roomOrder=session.order;
  if(session.handle.hasPointerCapture(session.id))session.handle.releasePointerCapture(session.id);
  renderRooms();document.dispatchEvent(new Event('roomorderchange'));
  [...$('roomList').querySelectorAll('.room-drag-handle')].find(button=>button.dataset.roomHandle===session.name)?.focus({preventScroll:true});
}
function moveDraggedRoom(){
  const s=roomDragSession;if(!s)return;
  const target=document.elementFromPoint(s.x,s.y)?.closest('#roomList [data-room]');
  if(!target||target.dataset.room===s.name)return;
  const from=roomOrder.indexOf(s.name),to=roomOrder.indexOf(target.dataset.room);
  const box=target.getBoundingClientRect(),source=s.row.getBoundingClientRect(),horizontal=Math.abs(box.top-source.top)<2;
  const point=horizontal?s.x:s.y,middle=horizontal?box.left+box.width/2:box.top+box.height/2;
  if(from<to&&point<middle||from>to&&point>middle)return;
  roomOrder.splice(from,1);roomOrder.splice(to,0,s.name);$('roomList').insertBefore(s.row,from<to?target.nextSibling:target);
  s.handle.setPointerCapture(s.id);
  s.handle.focus({preventScroll:true});
}
function phoneChoiceState(name){
  const date=$('startDate').value,nights=Number($('nights').value),snapshot=availabilitySnapshot?.key===roomQueryKey()?availabilitySnapshot:null;
  if(!date)return {kind:'unknown',label:'입실·퇴실일 선택 필요',selectable:false};
  const planned=window.stayCalendar?.planned(date,nights)||Date.parse(bookingOpenIso(date)+'+09:00')>currentSiteTime();
  if(workspaceTab==='watch')return {kind:'unknown',label:planned?'예정 · 취소 대기 후보':'취소 대기 후보',selectable:true};
  if(planned)return {kind:'before-open-no-data',label:'예정 · 오픈 전 후보',selectable:true};
  if(snapshot?.pending)return {kind:'checking',label:'전체 기간 조회 중',selectable:false};
  const found=snapshot?.rooms?.find(room=>room.name===name);
  if(snapshot?.ok&&found&&typeof found.available==='boolean'&&Date.now()-snapshot.capturedAt>=0&&Date.now()-snapshot.capturedAt<60000)
    return {kind:found.available?'available':'unavailable',label:found.available?(nights>1?'연박 가능':'예약 가능'):(nights>1?'선택 기간 연박 불가':'예약 불가'),selectable:found.available};
  return {kind:'unknown',label:snapshot&&!snapshot.ok?'조회 실패 · 미확인':'전체 기간 미확인',selectable:false};
}
function phoneChoiceMessage(){
  if(!$('startDate').value)return '입실일·퇴실일을 먼저 선택하세요.';
  const states=vault.rooms.map(phoneChoiceState);
  if(states.some(s=>s.kind==='before-open-no-data'))return '예정 일정은 전체 사이트를 후보로 선택할 수 있습니다. 실제 가능 여부는 오픈 후 다시 확인합니다.';
  if(workspaceTab==='watch')return '취소 대기는 현재 마감된 사이트도 감시 후보로 선택할 수 있습니다.';
  if(states.some(s=>s.kind==='checking'||s.kind==='unknown'))return '선택한 전체 기간을 조회한 뒤 가능한 사이트만 추가할 수 있습니다. 미확인은 0곳이 아닙니다.';
  return states.some(s=>s.selectable)?'목록에는 같은 사이트로 전체 숙박 기간이 가능한 곳만 표시합니다.':'선택 기간에 예약 가능한 사이트가 없습니다. 날짜별 빈자리가 있어도 같은 사이트의 연박은 불가능할 수 있습니다.';
}
function phonePruneChoices(){
  let removed=0;
  for(const name of [...selected])if(phoneChoiceState(name).kind==='unavailable'){selected.delete(name);removed++;}
  if(workspaceTab==='profiles-parallel'&&typeof phonePeople!=='undefined')for(const person of phonePeople){
    person.rooms=person.rooms.filter(name=>{if(phoneChoiceState(name).kind==='unavailable'){removed++;return false;}return true;});
  }
  if(removed){$('roomDragStatus').textContent='선택 기간에 예약 불가한 사이트 '+removed+'개를 선택에서 제외했습니다.';document.dispatchEvent(new Event('roomorderchange'));}
}
function phoneSelectionControls(){
  const groups=workspaceTab==='profiles-parallel'?phonePeople.map(p=>p.rooms):[[...selected]];
  $('watchDeselectAll').hidden=!groups.some(names=>names.length);
  $('watchSelectAll').disabled=!groups.some(names=>vault.rooms.some(name=>!names.includes(name)&&phoneChoiceState(name).selectable));
}
function phoneSelectAll(enabled){
  if(workspaceTab==='profiles-parallel')for(const person of phonePeople){
    const order=[...new Set([...(person.order||person.rooms),...vault.rooms])];person.order=order;person.rooms=enabled?order.filter(name=>person.rooms.includes(name)||phoneChoiceState(name).selectable):[];
  }else selected=enabled?new Set([...selected,...roomOrder.filter(name=>phoneChoiceState(name).selectable)]):new Set();
  renderRooms();if(typeof renderPhoneRankEditors==='function')renderPhoneRankEditors();document.dispatchEvent(new Event('roomorderchange'));
}
function renderRooms(){
  phonePruneChoices();
  const items=roomOrder.map(name=>({name,enabled:selected.has(name)}));
  $('roomList').replaceChildren(createSiteChoiceEditor({items,canSelect:name=>phoneChoiceState(name).selectable,status:phoneChoiceState,ranked:workspaceTab!=='multiple'&&workspaceTab!=='watch',message:phoneChoiceMessage(),onChange:()=>{
    roomOrder=items.map(item=>item.name);selected=new Set(items.filter(item=>item.enabled).map(item=>item.name));renderRooms();document.dispatchEvent(new Event('roomorderchange'));
  }}));
  if(typeof renderPhoneRankEditors==='function'&&featuresReady)renderPhoneRankEditors();
  if(typeof phonePeople!=='undefined')phoneSelectionControls();
}
function fillSelector(){const select=$("bookingProfileSelect1"),previous=select.value;select.replaceChildren(new Option("직접 입력 / 저장한 예약자 선택",""));for(const profile of vault.profiles)select.add(new Option(profile.name,profile.id));select.value=vault.profiles.some(profile=>profile.id===previous)?previous:"";}
function renderProfiles(){fillSelector();const list=$("bookingBookList");list.replaceChildren();if(!vault.profiles.length)list.append(node("p","저장한 예약자가 없습니다."));for(const profile of vault.profiles){const card=node("article",undefined,"plan-entry");card.append(node("strong",profile.name),node("p",profile.phone));const buttons=node("div",undefined,"phone-plan-actions");buttons.append(makeButton("수정",()=>{editingProfile=profile.id;$("bookEditor").hidden=false;for(const [id,key] of [["bookReserverName","name"],["bookDepositorName","payer"],["bookPhone","phone"],["bookBirthDate","birth"]])$(id).value=profile[key];}),makeButton("삭제",()=>{if(confirm("저장한 예약자를 삭제할까요? 이미 등록된 일정은 바뀌지 않습니다.")){vault=api("profileDelete",{id:profile.id});renderProfiles();}},"danger"));card.append(buttons);list.append(card);}}
function profileFromEditor(){return {name:$("reserverName").value,payer:$("depositorName").value,phone:$("phone").value,birth:$("birthDate").value};}
function phoneRunTime(epoch){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date(epoch))+" (한국 시간)";}
function updatePlanControls(){
 const state=nativeState,pending=!!state.confirmationPending,count=state.activeCount??(state.active?1:0),capacity=state.capacity??1,busy=count>=capacity;
 const stages={WAITING:"예약 대기 중",WATCHING:"취소 자리 감시 중",STARTING:"시작 준비 중",PREPARING:"예약 진행 중",SUBMITTING:"최종 제출 중",SUCCESS:"예약 신청 완료",NO_ROOM:"예약 가능 객실 없음",PARTIAL:"일부 완료 · 내역 확인 필요",FAILED:"실행 실패 · 로그 확인",CHECK_REQUIRED:"예약 결과 확인 필요",STOPPED:"정지됨",INSPECTED:"조회 완료"};
 for(const card of document.querySelectorAll('#executionPlanList [data-plan-id]')){
  const record=state.runs?.find(r=>r.planId===card.dataset.planId)||{planId:state.runPlanId,active:state.active,lookup:state.runLookup,uncertain:state.uncertain,stage:state.stage,message:state.message,trigger:state.runTrigger};const own=record.planId===card.dataset.planId&&!record.lookup,active=!!record.active&&own,confirming=pending&&state.pendingPlanId===card.dataset.planId;
  card.querySelector('[data-plan-action=start]').disabled=active||busy||pending||state.legacyUnbound||own&&(record.uncertain||['SUCCESS','PARTIAL'].includes(record.stage));
  card.querySelector('[data-plan-action=stop]').disabled=!active;
  card.querySelector('[data-plan-action=delete]').disabled=active||confirming;
  const label=card.querySelector('[data-plan-status]'),text=confirming?'시작 확인 중':own?(stages[record.stage]||(active?'예약 진행 중':'정지 상태')):'시작 전 · 정지 상태';
  const detail=active&&record.stage==='WAITING'&&record.trigger?' · 실행 예정 '+phoneRunTime(record.trigger):own&&record.message?' · '+record.message:'';
  if(label.textContent!==text+detail)label.textContent=text+detail;
  label.className='phone-plan-state '+(active?(record.stage==='WAITING'?'waiting':'running'):['FAILED','CHECK_REQUIRED','PARTIAL'].includes(record.stage)&&own?'failed':'idle');
 }
 document.querySelectorAll('[data-phone-run]').forEach(e=>e.disabled=busy||pending||state.legacyUnbound);
 document.querySelectorAll('[data-phone-stop]').forEach(e=>e.disabled=!state.active);
 if($('stopButton'))$('stopButton').disabled=!state.active;
 const editingActive=editingPlan&&(state.runs?.some(r=>r.active&&r.planId===editingPlan)||state.active&&state.runPlanId===editingPlan);
 if($('addPlanButton'))$('addPlanButton').disabled=!!editingActive;
}
function renderPlans(){
 const list=$("executionPlanList");list.replaceChildren();if(!vault.plans.length)list.append(node("p","등록된 일정이 없습니다.","history-empty"));
 for(const entry of vault.plans){
  const card=node("article",undefined,"plan-entry");card.dataset.planId=entry.id;
  card.append(node("strong",entry.title),node("p",entry.plan.date+" · "+entry.plan.nights+"박 · "+(entry.plan.mode==="watch"?"취소 대기":entry.plan.mode==="multiple"?"다중 예약":entry.plan.mode==="profiles-parallel"?"다인 예약":"단독 예약")),node("p",entry.plan.name+" · "+entry.plan.rooms));
  card.append(node('p',entry.plan.trigger?'실행 예정 '+phoneRunTime(entry.plan.trigger):'실행 예정: 시작 확인 후 바로 실행','phone-plan-time'));
  const status=node('p');status.dataset.planStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');card.append(status);
  const buttons=node("div",undefined,"phone-plan-actions");
  const start=makeButton("시작",()=>{if(nativeState.confirmationPending)throw Error('시작 확인을 먼저 마쳐 주세요.');if(entry.plan.trigger&&entry.plan.trigger<=currentSiteTime())throw Error("실행 시각이 지났습니다. 불러온 뒤 시각을 변경하거나 즉시 실행하세요.");api("run",{planId:entry.id});poll();});start.dataset.planAction='start';
  const load=makeButton("불러오기",()=>{loadPlan(entry.plan);$("planName").value=entry.title;editingPlan=entry.id;$("planEditNotice").hidden=false;$("addPlanButton").textContent="수정 저장";updatePlanControls();window.scrollTo({top:0,behavior:"smooth"});});
  const stop=makeButton("중지",()=>{api("stop",{planId:entry.id});poll();});stop.dataset.planAction='stop';
  const remove=makeButton("삭제",()=>{if(nativeState.runs?.some(r=>r.active&&r.planId===entry.id)||nativeState.active&&nativeState.runPlanId===entry.id)throw Error('진행 중인 일정을 먼저 중지하세요.');if(confirm("저장된 일정을 삭제할까요?")){vault=api("planDelete",{id:entry.id});renderPlans();}},"danger");remove.dataset.planAction='delete';
  buttons.append(start,load,stop,remove);card.append(buttons);list.append(card);
 }
 updatePlanControls();
}
function switchTab(tab){workspaceTab=tab;$("workspaceMenu").hidden=true;$("workspaceMenuButton").setAttribute("aria-expanded","false");$("workspaceMenuLabel").textContent=labels[tab];document.querySelectorAll("[data-workspace-tab]").forEach(button=>button.classList.toggle("active",button.dataset.workspaceTab===tab));const booking=["priority","watch"].includes(tab);for(const section of document.querySelectorAll("main.shell > section.card"))section.hidden=true;for(const section of [$("startDate").closest("section"),$("reserverName").closest("section"),$("roomList").closest("section"),$("historyCard")])section.hidden=!booking;$("bookingBookCard").hidden=tab!=="book";$("lookupCard").hidden=tab!=="people";$("logCard").hidden=tab!=="logs";$("settingsCard").hidden=tab!=="settings";$("monthlyDialog").hidden=tab!=="monthly";if(tab==="monthly")$("monthlyDialog").setAttribute("open","");else $("monthlyDialog").removeAttribute("open");$("phoneUnsupported").hidden=!["multiple","profiles-parallel"].includes(tab);$("phoneUnsupported").textContent=(labels[tab]||"")+" 메뉴는 애드온과 동일하게 배치했습니다. 이 폰 엔진은 아직 해당 방식의 실행을 지원하지 않습니다. 단독 예약·취소 대기를 이용하세요. 애드온은 변경하지 않았습니다.";$("planCard").hidden=!booking;$("watchHelp").hidden=tab!=="watch";document.querySelector(".watch-settings-row").hidden=tab!=="watch"||!uiSettings.watchInfo;$("reservationConnectionDetails").hidden=tab==="watch"||!uiSettings.reservationInfo;$("roomDragHelp").textContent=tab==="watch"?"선택한 객실 중 조건에 맞는 하나를 예약합니다. 순위는 적용하지 않습니다.":"오른쪽 손잡이를 위아래로 끌어 순서를 바꿉니다. 선택한 객실의 동그라미 숫자가 우선순위입니다.";$("phoneError").textContent="";renderRooms();}
window.refreshPhoneRuntime=()=>poll();
function poll(){if(document.hidden)return;try{const state=api("state");nativeState=state;updatePlanControls();for(const row of state.runs||[{stage:state.stage,message:state.message,planId:state.runPlanId}]){if(['FAILED','CHECK_REQUIRED','PARTIAL'].includes(row.stage)){const key=[row.planId,row.stage,row.message,row.updated].join('|');if(!seenRunErrors.has(key)){seenRunErrors.add(key);window.showFloatingMessage?.(row.message||'예약 결과를 확인해 주세요.',{error:true});}}}const newAvailabilityKey=JSON.stringify(state.availability||{});if(newAvailabilityKey!==availabilityKey){availabilityKey=newAvailabilityKey;availabilitySnapshot=state.availability;renderRooms();}const status={IDLE:"설정 중",WAITING:"예약 대기",WATCHING:"취소 대기",PREPARING:"자동 실행 중",STARTING:"시작 준비",SUBMITTING:"최종 제출 중",SUCCESS:"예약 신청 완료",NO_ROOM:"예약 가능 객실 없음",INSPECTED:"조회 완료",FAILED:"확인 필요",CHECK_REQUIRED:"결과 확인 필요",STOPPED:"중지됨"};$("statusBadge").textContent=(state.activeCount>1?state.activeCount+"개 일정 · ":"")+(status[state.stage]||state.stage);$("statusBadge").className="badge "+(state.active?(state.stage==="WAITING"?"waiting":"running"):["FAILED","CHECK_REQUIRED"].includes(state.stage)?"failed":state.stage==="SUCCESS"?"success":"idle");$("phoneStatus").textContent=(state.legacyUnbound?"이전 버전 실행을 연결할 수 없습니다. 전체 중지 후 다시 시작해 주세요.":state.message)+(state.uncertain?" · 이전 제출 내역 확인 필요":"");$("statusText").textContent=state.message;$("logList").textContent=state.log||"실행 기록이 없습니다.";$("phoneHealth").textContent="알림 "+(state.notifications?"허용":"필요")+" · 배터리 예외 "+(state.battery?"허용":"필요")+" · 정확한 알람 "+(state.alarm?"허용":"필요")+" · 일정 "+(state.activeCount||0)+"/"+(state.capacity||1);$("inspectButton").disabled=state.inspectBusy||state.confirmationPending||!state.multiProfile&&state.active;lastStage=state.stage;$("siteClock").textContent=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date());}catch(error){showError(error);}}
function settingToggle(key,title){const row=node("div",undefined,"phone-toggle"),label=node("label",title),input=node("input");input.id="setting-"+key;label.htmlFor=input.id;input.type="checkbox";input.checked=uiSettings[key];input.addEventListener("change",()=>{uiSettings[key]=input.checked;applyUi();});row.append(label,input);return row;}
function settings(){const controls=$("settingsControls");controls.replaceChildren(node("h3","잠금 중 실행 준비"));const health=node("p");health.id="phoneHealth";controls.append(health);const permissions=node("div",undefined,"phone-permissions");for(const [label,method] of [["알림 허용","notifications"],["배터리 설정 열기","batterySettings"],["배터리 예외 허용 요청","batteryRequest"],["정확한 알람 설정","alarmSettings"],["모의 예약 엔진 테스트","demo"],["이전 제출 내역 확인 완료","acknowledge"]])permissions.append(makeButton(label,()=>api(method)));controls.append(permissions,node("p","이미 배터리 예외가 허용돼 있으면 재요청할 필요가 없습니다. 모의 테스트는 실제 사이트에 접속하지 않습니다.","phone-inline-note"),node("h3","표시"));for(const [key,title] of [["stayRange","입실·퇴실일 선택 · 최대 6박 자동 계산"],["serverTime","상단 시계 표시 · 동기화 상태 구분"],["reservationInfo","예약 실행일·정보"],["watchInfo","취소 대기 조회 간격"],["safety","안전 안내"],["mapIcon","배치도 아이콘 · 모바일에서는 글자만"]])controls.append(settingToggle(key,title));controls.append(node("h3","글자 크기"));for(const [key,title] of Object.entries({title:"앱 제목",heading:"구역 제목",body:"본문",field:"입력칸",button:"버튼·메뉴",room:"객실",status:"상태",calendar:"달력",list:"일정 목록",log:"로그"})){const row=node("label",title),input=node("input");input.id="font-"+key;input.type="number";input.min="10";input.max=key==="title"?"42":"24";input.value=uiSettings.fonts[key];input.addEventListener("input",()=>{if(input.checkValidity()&&input.value){uiSettings.fonts[key]=Number(input.value);applyUi();}});row.append(input);controls.append(row);}controls.append(node("h3","버튼 위치·크기"));for(const [key,title] of [["menuCorner","메뉴 위치"],["mapCorner","배치도 위치"]]){const row=node("label",title),select=node("select");for(const [value,label] of [["top-left","상단 왼쪽"],["top-right","상단 오른쪽"],["bottom-left","하단 왼쪽"],["bottom-right","하단 오른쪽"]])select.add(new Option(label,value));select.value=uiSettings[key];select.addEventListener("change",()=>{uiSettings[key]=select.value;applyUi();});row.append(select);controls.append(row);}for(const [key,title,min,max] of [["floatingSize","플로팅 크기(px)",44,64],["menuSpacing","메뉴 간격",0,16]]){const row=node("label",title),input=node("input");input.type="number";input.min=min;input.max=max;input.value=uiSettings[key];input.addEventListener("input",()=>{if(input.checkValidity()&&input.value){uiSettings[key]=Number(input.value);applyUi();}});row.append(input);controls.append(row);}}
function applyUi(){for(const [key,value] of Object.entries(uiSettings.fonts))document.documentElement.style.setProperty("--font-"+key,Math.max(10,Math.min(key==="title"?42:24,Number(value)))+"px");const size=Math.max(44,Math.min(64,Number(uiSettings.floatingSize)||46));document.documentElement.style.setProperty("--floating-size",size+"px");document.documentElement.style.setProperty("--menu-gap",Math.max(0,Math.min(16,Number(uiSettings.menuSpacing)||0))+"px");$("workspaceMenuButton").style.height=size+"px";document.querySelector(".workspace-menu-floating").dataset.corner=uiSettings.menuCorner;$("siteMapButton").dataset.corner=uiSettings.mapCorner;$("siteMapButton").style.height=size+"px";$("scrollTopButton").style.width=size+"px";$("scrollTopButton").style.height=size+"px";document.querySelector(".site-map-icon").style.display=uiSettings.mapIcon?"":"none";$("serverTimeButton").hidden=!uiSettings.serverTime;$("safetyNotice").hidden=!uiSettings.safety;$("reservationConnectionDetails").hidden=!uiSettings.reservationInfo||workspaceTab==="watch";document.querySelector(".watch-settings-row").hidden=!uiSettings.watchInfo||workspaceTab!=="watch";updateStayFields();}
function init(){
    const updateButton=makeButton('앱 업데이트 확인',()=>api('checkUpdates'));$('settingsCard').append(updateButton);
    for(const time of ['14:00 ~ 15:00','15:00 ~ 16:00','16:00 ~ 17:00','17:00 ~ 18:00','18:00 ~ 19:00','19:00 이후'])$('campArrival').add(new Option(time,time));
    document.querySelectorAll("button").forEach(button=>button.disabled=true);
    vault=api("load");uiSettings={...structuredClone(defaults),...vault.ui,fonts:{...defaults.fonts,...(vault.ui?.fonts||{})}};
    if(vault.ui?.dateInputVersion!==1){uiSettings.stayRange=true;uiSettings.dateInputVersion=1;api("ui",uiSettings);vault.ui=structuredClone(uiSettings);}
    const title=document.querySelector("header");const notice=node("p","폰 내부 독립 실행 · "+vault.version+" · 새 공식 사이트 · 무통장입금 예약. 실제 폰 예약은 미검증이며, 서버와 실행 기능 범위는 다릅니다.","phone-notice");title.after(notice);const error=node("p");error.id="phoneError";error.hidden=true;notice.after(error);const state=node("p",undefined,"phone-inline-note");state.id="phoneStatus";error.after(state);const unsupported=node("section",undefined,"phone-unavailable");unsupported.id="phoneUnsupported";unsupported.hidden=true;state.after(unsupported);
    $("serverTimeButton").querySelector("span").textContent="폰 시간";$("serverTimeTitle").textContent="폰 한국 시간";$("siteTimeMeta").textContent="폰의 자동 날짜·시간을 사용합니다. 이 버전은 예약 사이트 서버 시간 동기화를 지원하지 않습니다.";$("serverTimeValue").textContent="서버 시간 미동기화";$("siteTimeSyncButton").hidden=true;
    $("bookingHelpDialog").replaceChildren(node("h2","폰 예약 도우미 사용 방법"),node("p","날짜·박수(또는 입실·퇴실일), 예약자와 객실을 선택하고 일정을 등록한 뒤 시작하세요. 폰 앱은 지정 시각에 객실 조회부터 시작합니다. 애드온의 최종 제출 시각 동기화와는 다릅니다."),node("p","단독 예약·취소 대기만 실행할 수 있습니다. 다인·다중, 앱 내 예약 조회·월별 현황 수집은 아직 이식하지 않았습니다. 취소 대기는 최소 10분이며 대기 일정을 시작한 경우에만 조회합니다."),makeButton("닫기",()=>$("bookingHelpDialog").close()));
    $("safetyNotice").replaceChildren(node("strong","폰 실행 안전 안내"),node("p","HA 서버 없이 폰에서 실행합니다. 화면 잠금은 지원하지만 전원 꺼짐·강제 종료·기기별 절전 제한에서 무중단 실행을 보장하지 않습니다. 미래 시각 대기에는 서비스·지속 알림이 없으며, 실행·취소 감시 중에는 중지 알림을 유지합니다. HA와 같은 예약을 동시에 실행하지 마세요."));
    const profileSection=$("reserverName").closest("section"),roomSection=$("roomList").closest("section");roomSection.before(profileSection);
    const history=$("historyCard");history.querySelector(".section-title").after($("planCard"));history.querySelector(".section-title p").textContent="일정을 등록한 뒤 시작·불러오기·삭제하세요. 최대 20개 저장, 동시 진행은 최대 5개이며 예약별로 세션을 분리합니다.";history.append($("executionPlanList"));$("historyList").hidden=true;$("executionCard").hidden=true;$("logCard").prepend($("statusText"));document.querySelector(".log-help").textContent="폰 내부 실행 기록입니다. 예약자 개인정보는 기록하지 않습니다.";
    $("planCard").querySelector(".plan-registration").after(node("p","폰 앱의 예약 시각은 최종 제출이 아니라 객실 조회부터 엔진을 켜는 시각입니다. 다인·다중은 순차 실행하며 애드온의 동시 실행과는 다릅니다.","phone-inline-note"));
    const consent=node("label",undefined,"phone-consent"),checkbox=node("input");checkbox.id="phoneConsent";checkbox.type="checkbox";checkbox.checked=true;consent.hidden=true;consent.append(checkbox,node("span","공식 이용·환불 약관을 확인했으며 이 일정의 자동 예약과 최종 제출에 동의합니다."));const executionActions=node("div",undefined,"phone-plan-actions");executionActions.append(makeButton("지금 바로 예약",()=>{const plan=readPlan();if(window.stayCalendar?.planned(plan.date,plan.nights))throw Error("오픈 전 예정 일정입니다. 공식 오픈 시각을 확인해 실행 시각을 지정하거나 취소 대기를 등록하세요.");plan.trigger=0;api("run",plan);}),makeButton("진행 중 작업 중지",()=>api("stop"),"danger"));executionActions.children[0].dataset.phoneRun="";executionActions.children[1].dataset.phoneStop="";$("planCard").append(consent,executionActions);
    $("triggerDetails").hidden=false;$("triggerAt").closest("label").firstChild.textContent="엔진 시작 시각 · 한국 시간 (비우면 즉시)";$("startDate").closest("section").querySelector(".section-title p").textContent="애드온과 같은 달력에서 선택합니다. 입실·퇴실 선택은 설정에서 켤 수 있습니다.";
    $("watchInterval").min="10";$("watchInterval").max="60";$("watchInterval").value="10";$("watchIntervalField").firstChild.textContent="조회 간격(분) · 최소 10";$("watchEndsAtField").hidden=true;$("watchEndsAtDetails").querySelector("summary").textContent="조회 간격 · 입실일 00시에 감시 종료";$("watchHelp").textContent="시작한 취소 대기 일정이 있을 때만 최소 10분 간격으로 확인합니다. 빈 객실 발견 시 1개 예약하며, 미확인 제출은 재시도하지 않습니다. 종료 시각을 지정하지 않으면 입실일 00시에 종료합니다.";
    for(const id of ["watchProfileField","multipleProfileField","profilePriorities","addProfileButton","extraProfiles","excludeFirstProfile","firstBookingProfileTitle","planEditNotice"])$(id).hidden=true;$("bookingMode").closest(".booking-mode-field").hidden=true;$("profileModeHelp").textContent="폰에 암호화해 최대 20명까지 저장합니다. 등록된 일정은 예약자 정보를 바꿔도 변경되지 않습니다.";
    const controls=$("firstBookingProfilePanel").querySelector(".booking-selector-actions");controls.append(makeButton("공식 약관·예약 페이지",()=>api("openReservation",{date:$("startDate").value})));
    const bookPage=$("bookingBookCard");bookPage.querySelector("p").textContent="폰 내부에 예약자를 최대 20명까지 암호화해 저장합니다. 이미 등록한 일정의 정보는 변경되지 않습니다.";
    $("lookupCard").replaceChildren(node("h2","예약 조회"),node("p","앱 내 자동 예약 조회·취소 관리는 아직 이식하지 않았습니다. 공식 사이트에서 직접 확인하세요. 예약자 정보는 URL에 넣지 않습니다."),makeButton("공식 예약 내역 조회 열기",()=>api("openReceipts")));
    const monthly=$("monthlyDialog");monthly.classList.add("monthly-page");document.querySelector("main.shell").insertBefore(monthly,$("safetyNotice"));monthly.querySelector(".monthly-footer").replaceChildren(node("p","폰 앱의 월별 현황 수집은 아직 지원하지 않습니다. 확인되지 않은 잔여 정보를 표시하지 않습니다."),makeButton("선택 월의 공식 현황 열기",()=>api("openMonthly",{month:$("monthlyMonth").value})));$("monthlyMonth").value=seoulToday().slice(0,7);$("monthlyContent").textContent="앱 내 월별 조회 미지원 · 공식 사이트에서 확인하세요.";
    $("settingsCard").querySelector(".app-update").replaceChildren(node("p","폰 엔진은 객실 하나만 예약하므로 다인·다중 최종 제출 간격 설정은 아직 적용하지 않습니다. 기존 HA 설정과는 별개입니다."));$("installedAppVersion").textContent="쉼오지 폰 예약 "+vault.version+" · HA와 독립 실행";
    $("siteMapImage").src="site-map.png";$("siteMapMessage").textContent="앱에 포함된 기본 배치도입니다. 애드온에 업로드한 사진과는 별도로 관리됩니다. 이 버전은 사진 변경을 지원하지 않습니다.";document.querySelector(".gallery-heading").hidden=true;$("mapGallery").hidden=true;$("siteMapFile").hidden=true;
    for(const id of ["siteMapUploadButton","galleryDeleteSelected","galleryDeleteAll","refreshLogsButton","saveLogsButton","startAllPlans","stopSelectedPlans","deleteSelectedPlans","startSelectedPlans","runNowButton"])$(id).hidden=true;
    action("workspaceMenuButton",()=>{$("workspaceMenu").hidden=!$("workspaceMenu").hidden;$("workspaceMenuButton").setAttribute("aria-expanded",String(!$("workspaceMenu").hidden));});for(const button of document.querySelectorAll("[data-workspace-tab]")){button.disabled=false;button.addEventListener("click",()=>switchTab(button.dataset.workspaceTab));}
    action("bookingHelpButton",()=>$("bookingHelpDialog").showModal());action("serverTimeButton",()=>$("serverTimeDialog").showModal());action("serverTimeClose",()=>$("serverTimeDialog").close());
    action("watchSelectAll",()=>phoneSelectAll(true));action("watchDeselectAll",()=>phoneSelectAll(false));action("inspectButton",()=>api("inspect",readPlan()));action("stopButton",()=>{api("stop");poll();});$("inspectButton").textContent="새로 고침 · 실제 객실 조회";
    action("addPlanButton",()=>{vault=api("planPut",{id:editingPlan,title:$("planName").value,plan:readPlan()});editingPlan="";$("planEditNotice").hidden=true;$("addPlanButton").textContent="일정 등록";renderPlans();$("planMessage").textContent="일정을 저장했습니다. 목록에서 시작을 누르세요. 저장만으로 예약하지 않습니다.";});action("cancelPlanEdit",()=>{editingPlan="";$("planEditNotice").hidden=true;$("addPlanButton").textContent="일정 등록";updatePlanControls();});
    action("saveProfilesButton",()=>{vault=api("profilePut",profileFromEditor());renderProfiles();$("phoneError").textContent="예약자 정보를 폰에 암호화해 저장했습니다.";});$("bookingProfileSelect1").addEventListener("change",()=>fillProfile(vault.profiles.find(profile=>profile.id===$("bookingProfileSelect1").value)));
    action("bookNewButton",()=>{editingProfile="";for(const id of ["bookReserverName","bookDepositorName","bookPhone","bookBirthDate"])$(id).value="";$("bookEditor").hidden=false;});action("bookCancelButton",()=>$("bookEditor").hidden=true);action("bookAddButton",()=>{vault=api("profilePut",{id:editingProfile,name:$("bookReserverName").value,payer:$("bookDepositorName").value,phone:$("bookPhone").value,birth:$("bookBirthDate").value});$("bookEditor").hidden=true;renderProfiles();});
    action("copyLogsButton",()=>api("copyLogs"));action("settingsSave",()=>{if([...$("settingsControls").querySelectorAll("input[type=number]")].some(input=>!input.reportValidity()))return;vault=api("ui",uiSettings);$("settingsMessage").textContent="화면 설정을 폰 내부에 저장했습니다.";});action("settingsReset",()=>{uiSettings=structuredClone(defaults);settings();applyUi();});
    action("siteMapButton",()=>$("siteMapDialog").showModal());action("siteMapCloseButton",()=>$("siteMapDialog").close());$("siteMapImage").addEventListener("click",()=>{$("mapZoomImage").src="site-map.png";$("mapZoomDialog").showModal();});action("mapZoomClose",()=>$("mapZoomDialog").close());action("scrollTopButton",()=>window.scrollTo({top:0,behavior:"smooth"}));window.addEventListener("scroll",()=>$("scrollTopButton").hidden=window.scrollY<300,{passive:true});
    $("reservationUrl").addEventListener("click",event=>{event.preventDefault();try{api("openReservation",{date:$("startDate").value});}catch(error){showError(error);}});
    for(const id of ["startDate","nights"])$(id).addEventListener("change",()=>{updateStayFields();const opening=bookingOpenIso($("startDate").value);if(!$("triggerAt").value&&opening&&Date.parse(opening+"+09:00")>Date.now())$("triggerAt").value=opening;});$("checkoutDate").addEventListener("change",()=>{const nights=(Date.parse($("checkoutDate").value)-Date.parse($("startDate").value))/86400000;if(nights>=1&&nights<=6){$("nights").value=String(nights);$("nights").dispatchEvent(new Event("change",{bubbles:true}));}else showError("퇴실일은 입실일 다음 날부터 6박 이내로 선택하세요.");updateStayFields();});
    settings();renderProfiles();renderPlans();loadPlan(vault.draft||{});for(const id of ["datePickerPrev","datePickerNext","datePickerCancel","datePickerApply","datePickerCheckin","datePickerCheckout"])$(id).disabled=false;initializeDatePicker();applyUi();poll();setInterval(poll,1000);document.addEventListener("visibilitychange",poll);
    let saveTimer;const saveDraft=()=>{if(!['priority','watch','multiple','profiles-parallel'].includes(workspaceTab))return;try{api('draft',readPlan());}catch(error){showError(error);}};
    for(const event of ['input','change','roomorderchange'])document.addEventListener(event,e=>{if(e.target.closest?.('#settingsCard,#bookingBookCard'))return;clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,200);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(saveTimer);saveDraft();}});
    const reset=makeButton('초기화',()=>{if(confirm('입력한 예약 정보를 초기화할까요? 저장 예약자·등록 일정·실제 예약은 유지합니다.')){loadPlan({});api('draft',readPlan());}});reset.classList.add('phone-reset-floating');document.body.append(reset);
    for(const id of ['startDate','nights','campAdults'])$(id).addEventListener('change',()=>renderRooms());
    for(const tab of ['multiple','profiles-parallel']){const button=document.querySelector('[data-workspace-tab="'+tab+'"]');button.textContent=labels[tab]+' · 준비 중';button.setAttribute('aria-description','이 버전은 실행 미지원');}
    updateButton.disabled=false;
    document.documentElement.dataset.ready="true";
}
document.addEventListener("DOMContentLoaded",()=>{try{init();}catch(error){const failure=node("p","화면 초기화 실패. 저장 정보는 삭제하지 않았습니다. "+error.message,"phone-notice");document.body.prepend(failure);document.documentElement.dataset.error=error.message;}});

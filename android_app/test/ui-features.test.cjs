const test=require('node:test'),assert=require('node:assert/strict'),{readFile}=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'../app/src/main/assets/ui');
async function setup(browser,width=390,storedUi={}){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<600,isMobile:width<600}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.clock.setFixedTime(new Date('2026-10-25T10:00:00+09:00'));
  await page.addInitScript(storedUi=>{
    const rooms=['해_하늘존','달_하늘존','별_하늘존','빛_하늘존','강_하늘존','산_하늘존','들_하늘존','숲_하늘존','샘_산맥존','온_산맥존','숨_산맥존','꿈_산맥존','솔_산맥존','결_산맥존'];
    window.nativeMock={vault:{rooms,profiles:[{id:'test-person',name:'모의예약자',payer:'',phone:'01000000000'}],plans:[],ui:storedUi,draft:{date:'2026-12-22',nights:1,mode:'reserve',rooms:'해_하늘존, 달_하늘존',siteVersion:'swimozicamp-v1'},version:'0.4.0-preview'},state:{stage:'IDLE',message:'모의 상태',active:false,uncertain:false,log:'',notifications:true,battery:true,alarm:true,catalog:rooms,clock:{synced:true,offset:120,updated:Date.now(),rtt:10}},calls:[],maps:{photos:[],selected:''}};
    window.Phone={request(raw){const {action,data}=JSON.parse(raw),s=window.nativeMock;s.calls.push({action,data});let result={};
      if(action==='load')result=s.vault;else if(action==='state')result=s.state;else if(action==='draft'){s.vault.draft=data;result=s.vault;}else if(action==='ui'){s.vault.ui=data;result=s.vault;}
      else if(action==='profilePut'){s.vault.profiles.push({id:'saved-'+s.vault.profiles.length,...data});result=s.vault;}
      else if(action==='planPut'){s.vault.plans.push({id:'plan-'+s.vault.plans.length,title:data.title||'모의 일정',plan:data.plan});result=s.vault;}
      else if(action==='draftReset'){s.vault.draft={mode:data.mode};delete (s.vault.drafts||{})[data.mode];result=s.vault;}
      else if(action==='planDelete'){s.vault.plans=s.vault.plans.filter(p=>p.id!==data.id);result=s.vault;}
      else if(action==='run'){s.state.confirmationPending=true;s.state.pendingPlanId=data.planId||'';}
      else if(action==='stop'){if(!data.planId||data.planId===s.state.runPlanId){s.state.active=false;s.state.stage='STOPPED';s.state.message='사용자가 중지했습니다.';}}
      else if(action==='maps')result=s.maps;
      else if(action==='mapAction'){if(data.action==='select')s.maps.selected=data.id;else{s.maps.photos=s.maps.photos.filter(id=>id!==data.id);if(s.maps.selected===data.id)s.maps.selected='';}result=s.maps;}
      else if(action==='inspect'&&s.autoAvailability){s.state.availability={key:data.date+'/'+data.nights+'/'+data.adults,ok:true,capturedAt:Date.now(),rooms:s.vault.rooms.map(name=>({name,available:s.autoAvailability.includes(name)}))};}
      else if(action==='calendarMonth')result=s.calendarData?.[data.month]||{ok:true,month:data.month,openThrough:'2026-12-31',days:{[data.month+'-17']:3,[data.month+'-18']:0,[data.month+'-19']:4,[data.month+'-22']:2}};
      else if(action==='monthly'){s.state.monthly={month:data.month,pending:false,ok:true,openThrough:data.month+'-28',days:{[data.month+'-01']:0,[data.month+'-02']:14},capturedAt:Date.now()};}
      else if(action==='lookup'){s.state.lookup={pending:false,capturedAt:Date.now(),profiles:[{label:'모*자',profileIndex:0,ok:true,count:1}],errors:[],rows:[{profileIndex:0,id:'TEST123-ABC',room:'해_하늘존',status:'입금 대기',stayDate:'2026-12-22',nights:'1박',total:'60,000원',depositDeadline:'12월 1일 10:00'}]};}
      return JSON.stringify({ok:true,data:result});
    }};
  },storedUi);
  await page.route('https://phone.swim.invalid/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1);if(name.startsWith('api/')||name==='favicon.ico')return route.fulfill({status:403,body:''});if(name.startsWith('map/'))return route.fulfill({contentType:'image/png',body:await readFile(path.join(root,'site-map.png'))});return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(path.join(root,name))});});
  await page.goto('https://phone.swim.invalid/index.html');await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&featuresReady);return {page,errors};
}
async function siteChoices(picker){const page=picker.page();await picker.getByRole('button',{name:'사이트 선택',exact:true}).click();const dialog=page.locator('.site-choice-dialog');const choices=await dialog.locator('input:not(:disabled):not(:checked)').evaluateAll(es=>es.map(e=>e.value));await dialog.getByRole('button',{name:'취소',exact:true}).click();return choices;}
async function addSite(picker,name){const page=picker.page();await picker.getByRole('button',{name:'사이트 선택',exact:true}).click();const dialog=page.locator('.site-choice-dialog');await dialog.locator('input').filter({hasNot:page.locator('[disabled]')}).count();await dialog.locator('input').evaluateAll((es,name)=>{const input=es.find(e=>e.value===name);if(!input||input.disabled)throw Error('Unavailable test site');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));},name);await dialog.getByRole('button',{name:'완료',exact:true}).click();}
test('추가 목록에는 전체 기간 가능 사이트만, 선택한 사이트는 드래그·취소·키보드 정렬한다',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());
 for(const width of [320,390,1280]){
  const{page,errors}=await setup(browser,width);
  await page.evaluate(()=>{nativeMock.state.availability={key:roomQueryKey(),ok:true,capturedAt:Date.now(),rooms:vault.rooms.map(name=>({name,available:true}))};poll();});
  const picker=page.locator('#roomList');
  assert.equal(await picker.locator('input[type=checkbox]').count(),0);
  for(const name of ['별_하늘존','빛_하늘존']){await addSite(picker,name);}
  assert.equal(await picker.locator('.site-choice-row').count(),4);
  const rows=picker.locator('.site-choice-row'),a=await rows.nth(0).boundingBox(),b=await rows.nth(1).boundingBox();assert.ok(a.height<=70&&b.y-a.y-a.height<=5);
  await rows.first().locator('.room-drag-handle').focus();await page.keyboard.press('ArrowDown');assert.match(await page.evaluate(()=>readPlan().rooms),/^달_하늘존, 해_하늘존/);
  await picker.locator('.site-choice-list').evaluate(el=>el.scrollIntoView({block:'center'}));
  const handle=picker.locator('[data-choice-name="해_하늘존"] .room-drag-handle');await handle.scrollIntoViewIfNeeded();
  const start=await handle.boundingBox(),target=await picker.locator('[data-choice-name="빛_하늘존"]').boundingBox();
  await page.evaluate(()=>{window.pickerDebug=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.addEventListener(type,e=>pickerDebug.push({type,x:e.clientX,y:e.clientY,primary:e.isPrimary,target:e.target.className,hit:document.elementFromPoint(e.clientX,e.clientY)?.closest('.site-choice-row')?.dataset.choiceName}));});
  await page.mouse.move(start.x+22,start.y+22);await page.mouse.down();await page.mouse.move(start.x+22,target.y+target.height/2,{steps:6});await page.mouse.up();
  assert.match(await page.evaluate(()=>readPlan().rooms),/빛_하늘존, 해_하늘존$/,JSON.stringify({width,start,target,events:await page.evaluate(()=>pickerDebug)}));
  const before=await page.evaluate(()=>readPlan().rooms);const h=picker.locator('[data-choice-name="달_하늘존"] .room-drag-handle');await h.scrollIntoViewIfNeeded();const point=await h.boundingBox();
  await page.mouse.move(point.x+22,point.y+22);await page.mouse.down();await page.mouse.move(point.x+22,point.y+100,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.evaluate(()=>readPlan().rooms),before);
  await page.evaluate(()=>{nativeMock.state.availability={key:roomQueryKey(),ok:true,capturedAt:Date.now(),rooms:vault.rooms.map((name,i)=>({name,available:i===0}))};poll();});
  assert.equal(await picker.locator('.site-choice-row').count(),1);
  assert.match(await picker.locator('.availability').innerText(),/예약 가능/);
  assert.deepEqual(await siteChoices(picker),[]);
  await page.locator('#checkoutDate').fill('2026-12-24');assert.match(await picker.locator('.availability').innerText(),/미확인/);
  assert.deepEqual(await siteChoices(picker),[]);assert.deepEqual(errors,[]);await page.close();
 }
});
test('날짜 확인 숫자는 제거하고 입실·퇴실 기본 입력과 박수 자동 계산, 기존 날짜 복원을 유지한다',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);
  assert.equal(await page.locator('#epochValue').count(),0);assert.equal(await page.locator('#checkoutField').isVisible(),true);assert.equal(await page.locator('#nightsField').isVisible(),false);assert.equal(await page.locator('#checkoutDate').inputValue(),'2026-12-23');
  await page.locator('#checkoutDate').fill('2026-12-25');assert.equal(await page.evaluate(()=>readPlan().nights),3);assert.equal(await page.locator('#stayNightsDisplay').textContent(),'3박');
  await page.evaluate(()=>loadPlan({date:'2026-12-28',nights:4,mode:'reserve'}));assert.equal(await page.locator('#checkoutDate').inputValue(),'2027-01-01');assert.equal(await page.evaluate(()=>readPlan().nights),4);
  await page.evaluate(()=>{nativeMock.vault.ui={stayRange:false};});await page.reload();await page.waitForFunction(()=>featuresReady);assert.equal(await page.locator('#checkoutField').isVisible(),true);assert.equal(await page.evaluate(()=>nativeMock.vault.ui.dateInputVersion),1);assert.deepEqual(errors,[]);await page.close();
  const oldUi=await setup(browser,390,{stayRange:false});assert.equal(await oldUi.page.locator('#checkoutField').isVisible(),true);await oldUi.page.close();
  const chosen=await setup(browser,390,{stayRange:false,dateInputVersion:1});assert.equal(await chosen.page.locator('#nightsField').isVisible(),true);await chosen.page.close();
});
test('배치도 사진 목록은 빈 상태와 기존 사진 뒤에 추가 타일을 표시하고 6장 한도를 지킨다',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());
  for(const width of [320,390,1280]){const{page,errors}=await setup(browser,width);await page.locator('#siteMapButton').click();const add=page.getByRole('button',{name:'배치도 사진 추가',exact:true});assert.equal(await add.isEnabled(),true);await add.click();assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='mapPick').length),1);
    await page.evaluate(()=>{nativeMock.maps.photos=Array.from({length:2},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));refreshPhoneMaps();});assert.equal(await page.locator('#mapGallery .phone-map-card').count(),2);assert.equal(await page.locator('#mapGallery > :last-child').getAttribute('id'),'galleryAddButton');assert.equal(await add.isEnabled(),true);
    assert.equal(await page.locator('#siteMapUploadButton').isVisible(),false);await page.getByRole('button',{name:'다운로드',exact:true}).first().click();assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='mapExport').at(-1).data.id),'00000000-0000-4000-8000-000000000001');assert.equal(await page.locator('#mapGallery .phone-map-card').count(),2);
    if(process.env.GALLERY_SCREENSHOT&&width===390)await page.locator('#siteMapDialog').screenshot({path:process.env.GALLERY_SCREENSHOT});
    await page.evaluate(()=>{nativeMock.maps.photos=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));refreshPhoneMaps();});assert.equal(await add.isDisabled(),true);assert.match(await add.textContent(),/6장 가득 참/);assert.equal(await page.locator('#siteMapUploadButton').isVisible(),false);
    await page.getByRole('button',{name:'전체 삭제',exact:true}).click();assert.equal(await page.locator('#mapGallery .phone-map-card').count(),0);assert.equal(await add.isEnabled(),true);assert.deepEqual(errors,[]);await page.close();
  }
});
test('모드별 입력을 보존하고, 완료 초안만 비우며, 명시적 초기화는 저장 예약자를 유지한다',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);
  await page.locator('#reserverName').fill('단독초안');await page.evaluate(()=>switchTab('watch'));await page.locator('#reserverName').fill('대기초안');await page.evaluate(()=>switchTab('priority'));assert.equal(await page.locator('#reserverName').inputValue(),'단독초안');await page.evaluate(()=>switchTab('watch'));assert.equal(await page.locator('#reserverName').inputValue(),'대기초안');
  await page.evaluate(()=>{nativeMock.state.clearedDraft=structuredClone(readPlan());nativeMock.state.draftClearedAt=1;});await page.locator('#reserverName').fill('수정된초안');await page.evaluate(()=>poll());assert.equal(await page.locator('#reserverName').inputValue(),'수정된초안');
  await page.evaluate(()=>{nativeMock.state.clearedDraft=structuredClone(readPlan());nativeMock.state.draftClearedAt=2;poll();});assert.equal(await page.locator('#reserverName').inputValue(),'');
  await page.locator('#reserverName').fill('초기화대상');await page.locator('.phone-reset-floating').click();assert.equal(await page.locator('#reserverName').inputValue(),'');assert.equal(await page.evaluate(()=>nativeMock.vault.profiles.length),1);assert.equal(await page.evaluate(()=>Object.keys(draftByMode).includes('reserve')),true);assert.deepEqual(errors,[]);await page.close();
});
test('다인·다중 입력과 등록, 조회·월별·서버 시간·사진 관리가 실제 native 요청과 연결된다',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);
  await page.evaluate(()=>switchTab('profiles-parallel'));assert.equal(await page.locator('#phoneUnsupported').isVisible(),false);await page.locator('#phonePeople').getByRole('button',{name:'예약자 추가',exact:true}).click();assert.equal(await page.locator('.phone-person-card').count(),2);
  await page.evaluate(()=>{$('startDate').value='2026-12-22';updateStayFields();nativeMock.state.availability={key:roomQueryKey(),ok:true,capturedAt:Date.now(),rooms:vault.rooms.map(name=>({name,available:true}))};poll();});
  await page.locator('.phone-person-card').nth(1).getByRole('combobox',{name:'예약자 2 저장 목록'}).selectOption('test-person');await addSite(page.locator('.phone-person-card').nth(1).locator('.site-choice-editor'),'별_하늘존');
  assert.equal(await page.evaluate(()=>readPlan().consent),true);const plan=await page.evaluate(()=>readPlan());assert.equal(plan.mode,'profiles-parallel');assert.equal(plan.people.length,2);assert.equal(plan.people[1].rooms,'별_하늘존');
  await page.locator('#addPlanButton').click();assert.equal(await page.evaluate(()=>nativeMock.vault.plans[0].plan.people.length),2);
  await page.evaluate(()=>switchTab('multiple'));assert.equal(await page.evaluate(()=>readPlan().mode),'multiple');assert.equal(await page.locator('#planCard').isVisible(),true);
  await page.evaluate(()=>switchTab('people'));await page.getByRole('button',{name:'저장 예약자 전체 조회'}).click();await page.evaluate(()=>poll());assert.match(await page.locator('#phoneLookupResults').innerText(),/입금 대기/);await page.locator('#phoneLookupResults summary').click();assert.match(await page.locator('#phoneLookupResults').innerText(),/TEST123-ABC/);
  await page.evaluate(()=>switchTab('monthly'));await page.locator('#monthlyMonth').fill('2026-11');await page.locator('#monthlyQueryButton').click();await page.evaluate(()=>poll());assert.equal(await page.locator('.monthly-count.booked').first().textContent(),'0곳');assert.equal(await page.locator('.monthly-count.available').first().textContent(),'14곳');assert.equal(await page.locator('#monthlyContent .monthly-room-row').count(),0);
  await page.evaluate(()=>{nativeMock.maps={photos:['00000000-0000-4000-8000-000000000001'],selected:''};refreshPhoneMaps();});await page.locator('#siteMapButton').click();await page.getByRole('button',{name:'적용',exact:true}).click();assert.match(await page.locator('#siteMapImage').getAttribute('src'),/^map\//);await page.getByRole('button',{name:'전체 삭제',exact:true}).click();assert.equal(await page.locator('#siteMapImage').getAttribute('src'),'site-map.png');
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='run').length),0);await page.close();
});

test('가능 수·마감·예정 달력, 퇴실일 제외와 현재 화면만 초기화',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());
 const {page,errors}=await setup(browser);
 await page.evaluate(()=>loadPlan({date:'2026-12-17',mode:'reserve'}));
 await page.locator('#startDate').click();
 await page.waitForFunction(()=>document.querySelector('[data-date="2026-12-17"] small')?.textContent==='3곳');
 assert.equal(await page.locator('[data-date="2026-12-18"]').isDisabled(),true);
 await page.locator('[data-date="2026-12-17"]').click();
 assert.equal(await page.locator('[data-date="2026-12-18"]').isEnabled(),true);
 assert.equal(await page.locator('[data-date="2026-12-19"]').isDisabled(),true);
 await page.locator('[data-date="2026-12-18"]').click();
 assert.equal(await page.locator('#checkoutDate').inputValue(),'2026-12-18');
 await page.evaluate(()=>switchTab('watch'));await page.locator('#reserverName').fill('다른 화면');
 await page.evaluate(()=>switchTab('priority'));await page.locator('.phone-reset-floating').click();
 assert.equal(await page.locator('.phone-reset-floating').isVisible(),false);
 await page.evaluate(()=>switchTab('watch'));assert.equal(await page.locator('#reserverName').inputValue(),'다른 화면');
 await page.evaluate(()=>switchTab('settings'));assert.equal(await page.locator('.phone-reset-floating').isVisible(),false);
 await page.evaluate(()=>{switchTab('priority');loadPlan({date:'2027-01-17',mode:'reserve'});});
 await page.locator('#startDate').click();await page.waitForFunction(()=>document.querySelector('[data-date="2027-01-17"] small')?.textContent==='예정');
 assert.equal(await page.locator('[data-date="2027-01-17"]').isEnabled(),true);
 await page.locator('#datePickerDialog').screenshot({path:'/tmp/swim-planned-calendar.png'});
 await page.locator('#datePickerCancel').click();
 assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);assert.deepEqual(errors,[]);await page.close();
});

test('날짜별 3곳이어도 같은 사이트로 2박 불가면 추가 목록은 비고, 예정은 전체 후보를 표시한다',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const {page,errors}=await setup(browser);
 await page.evaluate(()=>{
   nativeMock.autoAvailability=[];nativeMock.calendarData={'2026-12':{ok:true,month:'2026-12',openThrough:'2026-12-31',days:{'2026-12-17':3,'2026-12-18':3}}};
   loadPlan({mode:'reserve',date:'2026-12-17',nights:2,rooms:'해_하늘존'});
 });
 await page.locator('#startDate').click();await page.waitForFunction(()=>document.querySelector('[data-date="2026-12-18"] small')?.textContent==='3곳');
 await page.locator('#datePickerCancel').click();
 await page.waitForFunction(()=>nativeMock.state.availability?.key==='2026-12-17/2/2');await page.evaluate(()=>poll());
 assert.equal(await page.locator('#roomList select option[value]:not([value=""])').count(),0);
 assert.match(await page.locator('#roomList .site-choice-message').innerText(),/연박은 불가능/);
 assert.equal(await page.evaluate(()=>readPlan().rooms),'');
 assert.ok(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='inspect'&&c.data.date==='2026-12-17'&&c.data.nights===2)));
 await page.evaluate(()=>{nativeMock.autoAvailability=['달_하늘존'];loadPlan({mode:'profiles-parallel',date:'2026-12-19',nights:2,people:[{name:'모의예약자',payer:'',phone:'01000000000',rooms:'해_하늘존'}]});});
 await page.waitForFunction(()=>nativeMock.state.availability?.key==='2026-12-19/2/2');await page.evaluate(()=>poll());
 const picker=page.locator('#phonePeople .site-choice-editor').first();
 assert.deepEqual(await siteChoices(picker),['달_하늘존']);
 await addSite(picker,'달_하늘존');
 assert.equal(await page.evaluate(()=>readPlan().people[0].rooms),'달_하늘존');
 await page.evaluate(()=>{nativeMock.autoAvailability=null;loadPlan({mode:'profiles-parallel',date:'2027-01-17',nights:2,people:[{name:'모의예약자',payer:'',phone:'01000000000',rooms:''}]});});
 assert.equal((await siteChoices(picker)).length,14);
 await page.locator('#phonePeople').screenshot({path:'/tmp/swim-phone-site-choice.png'});
 assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);assert.deepEqual(errors,[]);
 await page.close();
});

test('일정 시작 확인·취소, 예약 대기·실행·중지 상태와 일정별 버튼을 연결한다',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});t.after(()=>browser.close());
 const {page,errors}=await setup(browser);t.after(()=>page.close());
 await page.evaluate(()=>{vault.plans=[{id:'first',title:'예약 일정',plan:{...vault.draft,trigger:Date.parse('2026-11-22T00:00:00+09:00')}},{id:'second',title:'다른 일정',plan:{...vault.draft,trigger:0}}];nativeMock.vault=vault;renderPlans();});
 const first=page.locator('[data-plan-id=first]'),second=page.locator('[data-plan-id=second]');
 const btn=(card,name)=>card.locator('[data-plan-action='+name+']');
 assert.equal(await btn(first,'start').isEnabled(),true);assert.equal(await btn(first,'delete').isEnabled(),true);assert.equal(await btn(first,'stop').isDisabled(),true);
 assert.match(await first.locator('.phone-plan-time').innerText(),/2026-11-22 00:00:00 \(한국 시간\)/);
 await btn(first,'start').click();assert.deepEqual(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='run').at(-1).data),{planId:'first'});
 assert.equal(await btn(first,'start').isDisabled(),true);assert.equal(await btn(first,'stop').isDisabled(),true);assert.match(await first.locator('[data-plan-status]').innerText(),/시작 확인 중/);
 await page.evaluate(()=>{Object.assign(nativeMock.state,{confirmationPending:false,pendingPlanId:''});refreshPhoneRuntime();});
 assert.equal(await btn(first,'start').isEnabled(),true);assert.equal(await btn(first,'delete').isEnabled(),true);assert.equal(await btn(first,'stop').isDisabled(),true);
 await btn(first,'start').click();await page.evaluate(()=>{Object.assign(nativeMock.state,{confirmationPending:false,pendingPlanId:'',active:true,runPlanId:'first',runTrigger:Date.parse('2026-11-22T00:00:00+09:00'),stage:'WAITING',message:'예약 대기'});refreshPhoneRuntime();});
 assert.equal(await btn(first,'start').isDisabled(),true);assert.equal(await btn(first,'delete').isDisabled(),true);assert.equal(await btn(first,'stop').isEnabled(),true);
 assert.equal(await btn(second,'start').isDisabled(),true);assert.equal(await btn(second,'stop').isDisabled(),true);assert.equal(await btn(second,'delete').isEnabled(),true);
 assert.match(await first.locator('[data-plan-status]').innerText(),/예약 대기 중.*2026-11-22 00:00:00/);
 assert.equal(await page.locator('[data-phone-run]').isDisabled(),true);assert.equal(await page.locator('[data-phone-stop]').isEnabled(),true);
 for(const stage of ['STARTING','PREPARING','SUBMITTING','WATCHING']){await page.evaluate(stage=>{nativeMock.state.stage=stage;refreshPhoneRuntime();},stage);assert.equal(await btn(first,'stop').isEnabled(),true);assert.equal(await btn(first,'delete').isDisabled(),true);}
 await btn(first,'stop').click();assert.deepEqual(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='stop').at(-1).data),{planId:'first'});
 assert.equal(await btn(first,'stop').isDisabled(),true);assert.equal(await btn(first,'start').isEnabled(),true);assert.equal(await btn(first,'delete').isEnabled(),true);assert.equal(await btn(second,'start').isEnabled(),true);
 assert.match(await first.locator('[data-plan-status]').innerText(),/정지됨/);assert.equal(await page.locator('[data-phone-stop]').isDisabled(),true);
 for(const stage of ['FAILED','SUCCESS','CHECK_REQUIRED']){await page.evaluate(stage=>{nativeMock.state.stage=stage;refreshPhoneRuntime();},stage);assert.equal(await btn(first,'start').isEnabled(),stage!=='SUCCESS');assert.equal(await btn(first,'delete').isEnabled(),true);assert.equal(await btn(first,'stop').isDisabled(),true);}
 assert.deepEqual(errors,[]);
});
test('다시 연 화면도 native 실행 ID로 대기 상태를 복원하고, 조회를 일정 실행으로 표시하지 않는다',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});t.after(()=>browser.close());
 const {page,errors}=await setup(browser);t.after(()=>page.close());
 await page.addInitScript(()=>{nativeMock.vault.plans=[{id:'restored',title:'복원 일정',plan:nativeMock.vault.draft}];Object.assign(nativeMock.state,{active:true,stage:'WAITING',runPlanId:'restored',runTrigger:Date.parse('2026-11-22T00:00:00+09:00')});});
 await page.reload();await page.waitForFunction(()=>featuresReady);const card=page.locator('[data-plan-id=restored]');
 assert.equal(await card.locator('[data-plan-action=start]').isDisabled(),true);assert.equal(await card.locator('[data-plan-action=delete]').isDisabled(),true);assert.equal(await card.locator('[data-plan-action=stop]').isEnabled(),true);
 await page.evaluate(()=>{nativeMock.state.runLookup=true;poll();});assert.equal(await card.locator('[data-plan-action=stop]').isDisabled(),true);assert.match(await card.locator('[data-plan-status]').innerText(),/시작 전/);
 await page.evaluate(()=>{nativeMock.state.active=false;nativeMock.state.stage='INSPECTED';poll();});assert.equal(await card.locator('[data-plan-action=start]').isEnabled(),true);
 assert.equal(await page.locator('#executionPlanList').evaluate(e=>e.scrollWidth<=e.clientWidth),true);assert.deepEqual(errors,[]);
});

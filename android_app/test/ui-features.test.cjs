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
      else if(action==='draftReset'){s.vault.draft={};s.vault.drafts={};result=s.vault;}
      else if(action==='maps')result=s.maps;
      else if(action==='mapAction'){if(data.action==='select')s.maps.selected=data.id;else{s.maps.photos=s.maps.photos.filter(id=>id!==data.id);if(s.maps.selected===data.id)s.maps.selected='';}result=s.maps;}
      else if(action==='monthly'){s.state.monthly={month:data.month,pending:false,ok:true,openThrough:data.month+'-28',days:{[data.month+'-01']:0,[data.month+'-02']:14},capturedAt:Date.now()};}
      else if(action==='lookup'){s.state.lookup={pending:false,capturedAt:Date.now(),profiles:[{label:'모*자',profileIndex:0,ok:true,count:1}],errors:[],rows:[{profileIndex:0,id:'TEST123-ABC',room:'해_하늘존',status:'입금 대기',stayDate:'2026-12-22',nights:'1박',total:'60,000원',depositDeadline:'12월 1일 10:00'}]};}
      return JSON.stringify({ok:true,data:result});
    }};
  },storedUi);
  await page.route('https://phone.swim.invalid/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1);if(name.startsWith('api/')||name==='favicon.ico')return route.fulfill({status:403,body:''});if(name.startsWith('map/'))return route.fulfill({contentType:'image/png',body:await readFile(path.join(root,'site-map.png'))});return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(path.join(root,name))});});
  await page.goto('https://phone.swim.invalid/index.html');await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&featuresReady);return {page,errors};
}
test('드래그 손잡이만 표시·촘촘한 간격·순위 보존·키보드·마우스·터치 취소·조회 색상·날짜 변경 무효화',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());
  for(const width of [320,390,1280]){const{page,errors}=await setup(browser,width);
    assert.equal(await page.locator('#roomList .room-drag-handle').count(),14);assert.equal(await page.locator('#roomList button').filter({hasText:/^[↑↓]$/}).count(),0);
    const rows=page.locator('#roomList .phone-room'),a=await rows.nth(0).boundingBox(),b=await rows.nth(1).boundingBox();assert.ok(a.height<=62&&b.y-a.y-a.height<=5);
    await rows.nth(0).locator('.room-drag-handle').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>roomOrder[0]),'달_하늘존');
    const handle=page.locator('[data-room="해_하늘존"] .room-drag-handle');await handle.scrollIntoViewIfNeeded();const start=await handle.boundingBox(),target=await page.locator('[data-room="빛_하늘존"]').boundingBox();await page.evaluate(()=>{window.dragDebug=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.addEventListener(type,e=>dragDebug.push({type,y:e.clientY,primary:e.isPrimary,target:e.target.className,drag:Boolean(roomDragSession),order:roomOrder.slice(0,5)}));});await page.mouse.move(start.x+22,start.y+22);await page.mouse.down();await page.mouse.move(start.x+22,target.y+target.height/2,{steps:6});await page.mouse.up();assert.equal(await page.evaluate(()=>roomOrder.indexOf('해_하늘존')),3,JSON.stringify({width,start,target,events:await page.evaluate(()=>dragDebug),errors}));
    const before=await page.evaluate(()=>roomOrder.join('|'));await page.locator('[data-room="해_하늘존"] .room-drag-handle').scrollIntoViewIfNeeded();const point=await page.locator('[data-room="해_하늘존"] .room-drag-handle').boundingBox();await page.mouse.move(point.x+22,point.y+22);await page.mouse.down();await page.mouse.move(point.x+22,point.y+90,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await page.evaluate(()=>roomOrder.join('|')),before);
    if(width===390){const cdp=await page.context().newCDPSession(page),box=await page.locator('[data-room="해_하늘존"] .room-drag-handle').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+22,y:box.y+22}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+22,y:box.y+100}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await page.evaluate(()=>roomOrder.join('|')),before);assert.equal(await page.evaluate(()=>roomDragSession===null),true);}
    await page.evaluate(()=>{nativeMock.state.availability={key:roomQueryKey(),ok:true,capturedAt:Date.now(),rooms:vault.rooms.map((name,i)=>({name,available:i===0}))};poll();});assert.match(await page.locator('[data-room="해_하늘존"] small').textContent(),/예약 가능/);assert.match(await page.locator('[data-room="달_하늘존"] small').textContent(),/잔여 없음/);
    if(width===390&&process.env.UI_SCREENSHOT){await page.locator('#roomList').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.UI_SCREENSHOT});}
    await page.locator('#checkoutDate').fill('2026-12-24');assert.match(await page.locator('[data-room="해_하늘존"] small').textContent(),/미확인/);assert.deepEqual(errors,[]);await page.close();
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
    if(process.env.GALLERY_SCREENSHOT&&width===390)await page.locator('#siteMapDialog').screenshot({path:process.env.GALLERY_SCREENSHOT});
    await page.evaluate(()=>{nativeMock.maps.photos=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));refreshPhoneMaps();});assert.equal(await add.isDisabled(),true);assert.match(await add.textContent(),/6장 가득 참/);assert.equal(await page.locator('#siteMapUploadButton').isDisabled(),true);
    await page.getByRole('button',{name:'전체 삭제',exact:true}).click();assert.equal(await page.locator('#mapGallery .phone-map-card').count(),0);assert.equal(await add.isEnabled(),true);assert.deepEqual(errors,[]);await page.close();
  }
});
test('모드별 입력을 보존하고, 완료 초안만 비우며, 명시적 초기화는 저장 예약자를 유지한다',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);
  await page.locator('#reserverName').fill('단독초안');await page.evaluate(()=>switchTab('watch'));await page.locator('#reserverName').fill('대기초안');await page.evaluate(()=>switchTab('priority'));assert.equal(await page.locator('#reserverName').inputValue(),'단독초안');await page.evaluate(()=>switchTab('watch'));assert.equal(await page.locator('#reserverName').inputValue(),'대기초안');
  await page.evaluate(()=>{nativeMock.state.clearedDraft=structuredClone(readPlan());nativeMock.state.draftClearedAt=1;});await page.locator('#reserverName').fill('수정된초안');await page.evaluate(()=>poll());assert.equal(await page.locator('#reserverName').inputValue(),'수정된초안');
  await page.evaluate(()=>{nativeMock.state.clearedDraft=structuredClone(readPlan());nativeMock.state.draftClearedAt=2;poll();});assert.equal(await page.locator('#reserverName').inputValue(),'');
  await page.locator('#reserverName').fill('초기화대상');await page.locator('.phone-reset-floating').click();assert.equal(await page.locator('#reserverName').inputValue(),'');assert.equal(await page.evaluate(()=>nativeMock.vault.profiles.length),1);assert.equal(await page.evaluate(()=>Object.keys(draftByMode).length),0);assert.deepEqual(errors,[]);await page.close();
});
test('다인·다중 입력과 등록, 조회·월별·서버 시간·사진 관리가 실제 native 요청과 연결된다',async t=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);
  await page.evaluate(()=>switchTab('profiles-parallel'));assert.equal(await page.locator('#phoneUnsupported').isVisible(),false);await page.locator('#phonePeople').getByRole('button',{name:'예약자 추가',exact:true}).click();assert.equal(await page.locator('.phone-person-card').count(),2);
  await page.locator('.phone-person-card').nth(1).getByRole('combobox',{name:'예약자 2 저장 목록'}).selectOption('test-person');await page.locator('.phone-person-card').nth(1).getByRole('combobox',{name:'추가할 사이트'}).selectOption('별_하늘존');await page.locator('.phone-person-card').nth(1).getByRole('button',{name:'사이트 추가',exact:true}).click();
  await page.locator('#phoneConsent').check();const plan=await page.evaluate(()=>readPlan());assert.equal(plan.mode,'profiles-parallel');assert.equal(plan.people.length,2);assert.equal(plan.people[1].rooms,'별_하늘존');
  await page.locator('#addPlanButton').click();assert.equal(await page.evaluate(()=>nativeMock.vault.plans[0].plan.people.length),2);
  await page.evaluate(()=>switchTab('multiple'));assert.equal(await page.evaluate(()=>readPlan().mode),'multiple');assert.equal(await page.locator('#planCard').isVisible(),true);
  await page.evaluate(()=>switchTab('people'));await page.getByRole('button',{name:'저장 예약자 전체 조회'}).click();await page.evaluate(()=>poll());assert.match(await page.locator('#phoneLookupResults').innerText(),/입금 대기/);await page.locator('#phoneLookupResults summary').click();assert.match(await page.locator('#phoneLookupResults').innerText(),/TEST123-ABC/);
  await page.evaluate(()=>switchTab('monthly'));await page.locator('#monthlyMonth').fill('2026-11');await page.locator('#monthlyQueryButton').click();await page.evaluate(()=>poll());assert.equal(await page.locator('.monthly-count.booked').first().textContent(),'0곳');assert.equal(await page.locator('.monthly-count.available').first().textContent(),'14곳');assert.equal(await page.locator('#monthlyContent .monthly-room-row').count(),0);
  await page.evaluate(()=>{nativeMock.maps={photos:['00000000-0000-4000-8000-000000000001'],selected:''};refreshPhoneMaps();});await page.locator('#siteMapButton').click();await page.getByRole('button',{name:'적용',exact:true}).click();assert.match(await page.locator('#siteMapImage').getAttribute('src'),/^map\//);await page.getByRole('button',{name:'전체 삭제',exact:true}).click();assert.equal(await page.locator('#siteMapImage').getAttribute('src'),'site-map.png');
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='run').length),0);await page.close();
});

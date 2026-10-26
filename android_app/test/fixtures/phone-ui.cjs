const {readFile}=require('node:fs/promises'),path=require('node:path');const root=path.resolve(__dirname,'../../app/src/main/assets/ui');
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

module.exports={setup};

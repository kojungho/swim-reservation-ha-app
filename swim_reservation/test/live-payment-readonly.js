// Explicit opt-in only. Real public GET pages, synthetic guests, NEVER submit.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {ReservationEngine} from '../src/camp-engine.js';
import {normalizeConfig} from '../src/config.js';
import {catalog,checkoutDate} from '../src/camp-site.js';
import {fillCampForm} from '../src/camp-form.js';
if(process.env.SWIM_LIVE_READONLY!=='1')throw Error('Set SWIM_LIVE_READONLY=1; no final submission is permitted.');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const native=await readFile(new URL('../../android_app/app/src/main/assets/camp-engine.js',import.meta.url),'utf8')+await readFile(new URL('../../android_app/app/src/main/assets/camp-step.js',import.meta.url),'utf8');
const date=process.env.SWIM_CHECK_DATE||'2027-01-27',checks=[],requests=[],traces=[];
let group='discovery',blockedMutations=0,records=0;
const store={updateStatus:async()=>{},recordLog:async(level,event,message,details)=>{traces.push({group,step:details?.step,outcome:details?.outcome});},bookings:{begin(){records++;throw Error('Live booking records forbidden.');}}};
class ReadOnlyEngine extends ReservationEngine{
 async ensurePage(){await super.ensurePage();if(this.protectedPage===this.page)return;this.protectedPage=this.page;
  await this.context.addInitScript(()=>{window.__readOnlySubmitEvents=0;document.addEventListener('submit',e=>{window.__readOnlySubmitEvents++;e.preventDefault();e.stopImmediatePropagation();},true);});
  await this.context.route('**/*',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){blockedMutations++;return route.abort();}if(['image','font','media'].includes(req.resourceType()))return route.abort();if(req.isNavigationRequest())requests.push({group,method:req.method(),path:new URL(req.url()).pathname});return route.continue();});
 }
 async runSingle(config,options={}){
  const result=await super.runSingle(config,{...options,checkOnly:true});
  const payment=await this.page.locator('form.js-book').evaluate(form=>({options:[...form.querySelectorAll('[name=pay_method]')].map(e=>({type:e.type,value:e.value})),values:new FormData(form).getAll('pay_method'),valid:form.checkValidity(),submitEvents:window.__readOnlySubmitEvents}));
  assert.deepEqual(payment.values,['bank']);assert.equal(payment.valid,true);assert.equal(payment.submitEvents,0);
  const profile=config.profiles[0],input={catalog:[...catalog.values()],site:catalog.get(result.room).siteId,date:config.startDate,checkout:checkoutDate(config.startDate,config.nights),nights:config.nights,adults:config.adults,name:profile.reserverName,phone:profile.phone,payer:profile.depositorName||profile.reserverName,request:config.request||'',arrival:config.arrivalTime||'',consent:true};
  const selectMethod=async value=>this.page.locator('form.js-book').evaluate((form,value)=>{const radio=[...form.querySelectorAll('[name=pay_method]')].find(e=>e.value===value);if(!radio)throw Error('Payment option missing');radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const alternatives=[];
  for(const value of ['bank','card','iche']){
   await selectMethod(value);
   const addon=await this.page.locator('form.js-book').evaluate(fillCampForm,{fields:{name:input.name,phone:input.phone,depositor:input.payer,request:input.request,arrive_time:input.arrival}});
   assert.equal(addon.ok,true,JSON.stringify(addon));await this.assertForm(config,catalog.get(result.room),{verifyInputs:true});
   await selectMethod(value);
   const app=await this.page.evaluate(new Function('p',native+';const prepared=campStep("prepare",p);return {prepared,verified:prepared.ok?campStep("preflight",p):null};'),input);
   assert.equal(app.prepared.ok,true,JSON.stringify(app.prepared));assert.equal(app.verified.ok,true,JSON.stringify(app.verified));assert.equal(app.verified.checks.bank,true);
   const submit=this.page.locator('button.js-pay');assert.equal(await submit.count(),1);assert.equal(await submit.isEnabled(),true);assert.equal(await submit.getAttribute('formaction'),null);assert.equal(await submit.innerText(),'예약 신청하기');alternatives.push(value);
  }
  checks.push({mode:group,room:result.room,addonVerified:result.verified,appVerified:true,payment:payment.values[0],initialMethodsVerified:alternatives,paymentOptions:payment.options.map(e=>e.value),submitButtonReady:true,submitted:false});return result;
 }
}
const guest=n=>({reserverName:n===0?'점검예약자':'확인예약자',phone:n===0?'01000000000':'01000000001',depositorName:''});
const base=normalizeConfig({startDate:date,nights:1,adults:2,triggerAt:'2026-11-01T00:00:00',paymentMethod:'bank',autoFinalSubmit:false,profiles:[guest(0)]});
const engines=[];
try{
 const discovery=new ReadOnlyEngine({store,executablePath});engines.push(discovery);const rooms=(await discovery.inspect(base)).filter(r=>r.available===true);assert.ok(rooms.length>=2,'Two available sites required for mode checks.');await discovery.close();
 const names=rooms.slice(0,2).map(r=>r.name),selected=names.map(name=>({name,enabled:true}));
 for(const mode of ['priority','multiple','profiles-parallel']){
  group=mode;const engine=new ReadOnlyEngine({store,executablePath,getFinalSubmitInterval:async()=>0});engines.push(engine);
  const config=normalizeConfig({...base,bookingMode:mode,roomPriority:mode==='priority'?selected.slice(0,1):selected,profiles:mode==='profiles-parallel'?[{...guest(0),roomPriority:[selected[0]]},{...guest(1),roomPriority:[selected[1]]}]:[guest(0)]});
  await engine.run(config);await engine.close();
  assert.equal(checks.filter(r=>r.mode===mode).length,mode==='priority'?1:2);
 }
 assert.equal(blockedMutations,0);assert.equal(records,0);assert.equal(traces.filter(t=>['submit-click','final-submit'].includes(t.step)).length,0);
 const report={checkedAt:new Date().toISOString(),date,checkout:checkoutDate(date,1),checks,blockedMutations,bookingRecords:records,finalSubmissionEvents:0,requests:requests.length,scope:'Real form preparation and verification only. No final submission or receipt verification.'};
 await writeFile('/tmp/swim-live-payment-readonly-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await Promise.allSettled(engines.map(e=>e.close()));}

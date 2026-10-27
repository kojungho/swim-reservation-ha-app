package kr.swim.phone;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
/** Synthetic active state prevents any reservation/inspection service start in UI verification. */
public final class SiteChoiceTestRunner extends EngineTestRunner {
 @Override public void onStart(){
  app=getTargetContext();store=new LocalStore(app);JSONObject backup=null;AppUpdates.MetadataSource original=AppUpdates.source;
  try{
   PhoneReads.testMode=true;store.state("WAITING","사이트 선택 UI 모의 대기",true);
   AppUpdates.source=()->new JSONObject().put("packageId","kr.swim.phone").put("versionCode",BuildConfig.VERSION_CODE).put("versionName",BuildConfig.VERSION_NAME).put("sha256","0".repeat(64)).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/mock.apk");
   PhoneRepository repository=new PhoneRepository(app);backup=repository.load();
   activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
   check(MainActivity.localUi(android.net.Uri.parse("https://phone.swim.invalid/site-choice.js"),false),"shared site picker is served by the native UI allowlist");
   Plan p=Plan.sample();p.mode="reserve";p.date="2026-12-17";p.nights=2;p.rooms="";
   store.availability(p,java.util.Set.of(RoomCatalog.id("달_하늘존")),true);
   js("loadPlan({mode:'reserve',date:'2026-12-17',nights:2});poll()");
   check(js("JSON.stringify([...document.querySelector('#roomList select').options].map(o=>o.value).filter(Boolean))").equals("[\"달_하늘존\"]"),"only the same-site whole-stay result is offered, not fourteen unchecked sites");
   js("const s=document.querySelector('#roomList select');s.value='달_하늘존';s.dispatchEvent(new Event('change'));document.querySelector('#roomList .site-choice-tools button').click()");
   check(js("readPlan().rooms").equals("달_하늘존"),"dropdown addition feeds the actual native plan");
   store.availability(p,java.util.Set.of(),true);js("poll()");
   check(js("readPlan().rooms===''&&document.querySelectorAll('#roomList option[value]:not([value=\\\"\\\"])').length===0").equals("true"),"verified no-common-site stay clears invalid choices and leaves no available candidate");
   js("loadPlan({mode:'profiles-parallel',date:'2027-01-17',nights:2,people:[{name:'모의예약자',payer:'',phone:'01000000000',rooms:''}]})");
   check(js("[...document.querySelector('#phonePeople select[aria-label*=추가할]').options].filter(o=>o.value).length").equals("14"),"pre-opening multi-person stay exposes all fourteen candidates");
   check(js("document.querySelectorAll('#phonePeople input[type=checkbox]').length===0").equals("true"),"phone uses the shared add-and-rank picker, not a separate checkbox workflow");
   check(js("!$('checkoutField').hidden&&$('nightsField').hidden").equals("true"),"check-in/checkout calendar UI remains enabled");
   check(!ReservationService.alive()&&store.active(),"UI verification never started or stopped a booking service");
   js("phonePeriodQueued='';clearTimeout(phonePeriodTimer)");
   Bundle done=new Bundle();done.putString("stream",assertions+" native site-choice assertions passed\n");finish(Activity.RESULT_OK,done);
  }catch(Throwable error){Bundle result=new Bundle();result.putString("stream","FAILED: "+error+"\n");finish(Activity.RESULT_CANCELED,result);}
  finally{AppUpdates.source=original;PhoneReads.testMode=false;try{if(backup!=null)store.saveDocument("phone-ui-v1",backup);}catch(Exception ignored){}releaseActivity();store.state("IDLE","사이트 선택 UI 검증 종료",false);}
 }
}

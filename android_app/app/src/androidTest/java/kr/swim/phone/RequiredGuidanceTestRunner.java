package kr.swim.phone;
import android.app.*;import android.content.*;import android.os.*;import android.view.WindowInsets;import org.json.*;
/** Dedicated emulator only. No booking engine; restore private editor data and IME setting. */
public final class RequiredGuidanceTestRunner extends EngineTestRunner {
 boolean keyboardVisible(){boolean[] visible={false};runOnMainSync(()->{WindowInsets insets=((MainActivity)activity).screen.getRootWindowInsets();visible[0]=insets!=null&&Build.VERSION.SDK_INT>=30&&insets.isVisible(WindowInsets.Type.ime());});return visible[0];}
 @Override public void onStart(){
  app=getTargetContext();store=new LocalStore(app);JSONObject backup=null;String oldIme=null;AppUpdates.MetadataSource original=AppUpdates.source;
  try{
   if(store.active()||store.uncertain()||PhoneRuns.count(app)>0)throw new AssertionError("Emulator has an active or uncertain operation");
   backup=new PhoneRepository(app).load();oldIme=shell("settings get secure show_ime_with_hard_keyboard").trim();shell("settings put secure show_ime_with_hard_keyboard 1");
   PhoneReads.testMode=true;AppUpdates.source=()->new JSONObject().put("packageId","kr.swim.phone").put("versionCode",BuildConfig.VERSION_CODE).put("versionName",BuildConfig.VERSION_NAME).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/mock.apk");
   activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
   long ready=System.currentTimeMillis()+10000;while(!js("typeof window.finishBookingReset==='function'&&featuresReady").equals("true")&&System.currentTimeMillis()<ready)Thread.sleep(100);
   js("switchTab('priority');loadPlan({mode:'reserve',name:'키패드 모의',phone:''});document.getElementById('phone').focus();document.getElementById('phone').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))");Thread.sleep(400);
   check(js("document.activeElement.id").equals("phone"),"missing phone is focused before reset");
   js("window.beginBookingReset();api('draftReset',{mode:'reserve'});loadPlan({mode:'reserve'});document.getElementById('planName').value='';window.finishBookingReset()");Thread.sleep(500);
   check(js("document.activeElement.id").equals("reserverName"),"reset focuses the first required name field");
   check(js("document.getElementById('floatingMessage').textContent.includes('예약자명')").equals("true"),"reset replaces the previous phone message");
   await(this::keyboardVisible,5000);check(keyboardVisible(),"Android IME is actually visible after reset guidance");
   js("vault.profiles=[{id:'saved-fixture',name:'저장목록 모의',phone:'01000000000',payer:''}];renderProfiles();document.getElementById('bookingProfileSelect1').focus()");
   await(()->!keyboardVisible(),5000);check(!keyboardVisible(),"saved selector dismisses IME instead of reopening the missing-name keyboard");
   check(js("document.activeElement.id").equals("bookingProfileSelect1"),"required validation does not steal saved-selector focus");
   js("const saved=document.getElementById('bookingProfileSelect1');saved.value='saved-fixture';saved.dispatchEvent(new Event('change',{bubbles:true}))");Thread.sleep(400);
   check(js("document.getElementById('reserverName').value==='저장목록 모의'&&document.getElementById('phone').value==='01000000000'").equals("true"),"saved profile fills both mandatory identity fields");
   check(!store.active()&&PhoneRuns.count(app)==0,"keyboard/reset never starts a reservation");
   Bundle done=new Bundle();done.putString("stream",assertions+" required guidance assertions passed\n");finish(Activity.RESULT_OK,done);
  }catch(Throwable error){Bundle done=new Bundle();done.putString("stream","FAILED: "+error+"\n");finish(Activity.RESULT_CANCELED,done);}
  finally{releaseActivity();waitForIdleSync();AppUpdates.source=original;PhoneReads.testMode=false;try{if(backup!=null)store.saveDocument("phone-ui-v1",backup);if(oldIme!=null)shell(oldIme.equals("null")?"settings delete secure show_ime_with_hard_keyboard":"settings put secure show_ime_with_hard_keyboard "+oldIme);}catch(Exception ignored){}}
 }
}

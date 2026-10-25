package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import org.json.*;

/** Dedicated emulator: only synthetic drafts and public-calendar fixtures. No booking requests. */
public final class UiSafetyTestRunner extends EngineTestRunner {
    @Override public void onStart(){
        app=getTargetContext();store=new LocalStore(app);AppUpdates.MetadataSource original=AppUpdates.source;JSONObject backup=null;
        try{
            PhoneReads.testMode=true;store.state("IDLE","UI 안전 검증",false);
            AppUpdates.source=()->new JSONObject().put("packageId","kr.swim.phone").put("versionCode",BuildConfig.VERSION_CODE).put("versionName",BuildConfig.VERSION_NAME).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/mock.apk");
            PhoneRepository repository=new PhoneRepository(app);backup=repository.load();int profiles=backup.getJSONArray("profiles").length(),plans=backup.getJSONArray("plans").length();
            repository.saveDraft(new JSONObject().put("mode","reserve").put("name","단독모의").put("date","2026-12-17"));
            repository.saveDraft(new JSONObject().put("mode","watch").put("name","대기모의").put("date","2027-01-17"));
            activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
            js("api('draftReset',{mode:'reserve'})");
            JSONObject state=repository.load();check(!state.getJSONObject("drafts").has("reserve"),"native reset removes only the requested mode");
            check(state.getJSONObject("drafts").getJSONObject("watch").getString("name").equals("대기모의"),"other mode draft survives encrypted readback");
            check(state.getJSONObject("draft").getString("name").equals("대기모의"),"latest draft from another page is not overwritten");
            check(state.getJSONArray("profiles").length()==profiles&&state.getJSONArray("plans").length()==plans,"saved guests and registered schedules remain unchanged");
            String month="2098-11";store.saveDocument("calendar-"+month,new JSONObject());
            JSONObject calendar=PhoneReads.calendar(app,month);long deadline=System.currentTimeMillis()+5000;
            while(calendar.optBoolean("pending")&&System.currentTimeMillis()<deadline){Thread.sleep(50);calendar=PhoneReads.calendar(app,month);}
            check(calendar.optBoolean("ok")&&calendar.getJSONObject("days").getInt(month+"-01")==0&&calendar.getJSONObject("days").getInt(month+"-02")==4,"calendar normalizes known zero and positive counts");
            check(calendar.getJSONObject("days").isNull(month+"-03"),"missing calendar values remain unknown instead of sold out");
            store.state("WAITING","모의 대기",true);
            check(PhoneReads.calendar(app,month).optBoolean("ok"),"cached calendar may be read without interrupting an active booking");
            check(PhoneReads.calendar(app,"2098-12").optBoolean("busy"),"new calendar network work is skipped while a booking is active");
            check(store.active(),"calendar reads never stop the booking");
            store.state("IDLE","모의 종료",false);
            check(ApkDownload.allowed(new java.net.URL("https://release-assets.githubusercontent.com/example.apk"))&&!ApkDownload.allowed(new java.net.URL("http://github.com/a.apk"))&&!ApkDownload.allowed(new java.net.URL("https://evil.invalid/a.apk")),"APK redirects require HTTPS and an explicit GitHub asset host");
            UpdateApkProvider provider=new UpdateApkProvider();boolean rejected=false;
            try{provider.getType(Uri.parse("content://kr.swim.phone.updates/../private"));}catch(IllegalArgumentException expected){rejected=true;}
            check(rejected,"update provider rejects all paths except the verified APK");
            rejected=false;try{provider.openFile(UpdateApkProvider.URI,"w");}catch(java.io.FileNotFoundException expected){rejected=true;}
            check(rejected,"installer APK access is read-only");
            Bundle done=new Bundle();done.putString("stream",assertions+" UI safety assertions passed\n");finish(Activity.RESULT_OK,done);
        }catch(Throwable error){Bundle result=new Bundle();result.putString("stream","FAILED: "+error+"\n");finish(Activity.RESULT_CANCELED,result);}
        finally{AppUpdates.source=original;PhoneReads.testMode=false;store.state("IDLE","UI 안전 검증 종료",false);try{if(backup!=null)store.saveDocument("phone-ui-v1",backup);}catch(Exception ignored){}releaseActivity();}
    }
}

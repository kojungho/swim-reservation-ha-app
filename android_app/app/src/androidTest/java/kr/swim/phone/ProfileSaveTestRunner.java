package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;

/** Real JS bridge + Keystore persistence on a dedicated emulator; no reservations or network. */
public final class ProfileSaveTestRunner extends EngineTestRunner {
    @Override public void onStart(){
        app=getTargetContext();store=new LocalStore(app);AppUpdates.MetadataSource original=AppUpdates.source;
        try{
            PhoneReads.testMode=true;store.state("IDLE","예약자 저장 검증",false);
            AppUpdates.source=()->new JSONObject().put("packageId","kr.swim.phone").put("versionCode",BuildConfig.VERSION_CODE).put("versionName",BuildConfig.VERSION_NAME).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/mock.apk");
            PhoneRepository repository=new PhoneRepository(app);int before=repository.load().getJSONArray("profiles").length();
            activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
            js("switchTab('priority');$('reserverName').value='저장검증단독';$('depositorName').value='';$('phone').value='01000000001';$('saveProfilesButton').click()");
            check(repository.load().getJSONArray("profiles").length()==before+1,"single booking form saves an empty depositor through the real native bridge");
            check(repository.load().getJSONArray("profiles").getJSONObject(before).getString("payer").isEmpty(),"empty depositor remains empty after encrypted readback");
            js("switchTab('book');$('bookNewButton').click();$('bookReserverName').value='저장검증정보';$('bookDepositorName').value='';$('bookPhone').value='01000000002';$('bookAddButton').click()");
            check(repository.load().getJSONArray("profiles").length()==before+2,"guest information editor saves without a depositor or birth date");
            js("switchTab('profiles-parallel');phonePeople=[{name:'저장검증다인',payer:'',phone:'01000000003',rooms:[]}];renderPhonePeople();[...document.querySelectorAll('#phonePeople button')].find(b=>b.textContent==='예약자 저장').click()");
            check(repository.load().getJSONArray("profiles").length()==before+3,"multi-person guest card saves without a depositor");
            for(int i=0;i<3;i++){JSONObject saved=repository.load().getJSONArray("profiles").getJSONObject(before);repository.delete("profiles",saved.getString("id"));}
            check(repository.load().getJSONArray("profiles").length()==before,"only synthetic test profiles are removed after verification");
            Bundle b=new Bundle();b.putString("stream",assertions+" native profile-save assertions passed\n");finish(Activity.RESULT_OK,b);
        }catch(Throwable e){Bundle b=new Bundle();b.putString("stream","FAILED: "+e+"\n");finish(Activity.RESULT_CANCELED,b);}
        finally{AppUpdates.source=original;PhoneReads.testMode=false;releaseActivity();}
    }
}

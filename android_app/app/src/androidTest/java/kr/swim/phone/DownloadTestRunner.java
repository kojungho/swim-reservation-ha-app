package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicReference;

/** Dedicated emulator on the previous app build. Public release GET only; never confirms installation. */
public final class DownloadTestRunner extends EngineTestRunner {
    @Override public void onStart(){
        app=getTargetContext();store=new LocalStore(app);AppUpdates.MetadataSource original=AppUpdates.source;
        try{
            PhoneReads.testMode=true;store.state("IDLE","업데이트 다운로드 검증",false);
            JSONObject metadata=AppUpdates.validate(AppUpdates.fetch());
            int installedCode=app.getPackageManager().getPackageInfo(app.getPackageName(),0).versionCode;
            if(metadata.getInt("versionCode")<=installedCode)throw new AssertionError("Run this on the previous APK");
            AppUpdates.source=()->metadata;AppUpdates.preferences(app).edit().clear().commit();
            activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
            MainActivity main=(MainActivity)activity;long deadline=System.currentTimeMillis()+10000;
            while(main.updates.dialog==null&&System.currentTimeMillis()<deadline)Thread.sleep(50);
            check(main.updates.dialog!=null,"new public release offers an update inside the app");
            runOnMainSync(()->main.updates.dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick());
            deadline=System.currentTimeMillis()+90000;
            while(main.updates.download.ready==null&&System.currentTimeMillis()<deadline)Thread.sleep(100);
            check(main.updates.download.ready!=null&&main.updates.download.ready.length()>100000,"GitHub redirect download completes in private app storage");
            ApkDownload.verify(app,main.updates.download.ready,metadata);
            check(true,"downloaded APK digest, package, future version and installed signer all match");
            JSONObject wrong=new JSONObject(metadata.toString()).put("sha256","0".repeat(64));boolean rejected=false;
            try{ApkDownload.verify(app,main.updates.download.ready,wrong);}catch(Exception expected){rejected=true;}
            check(rejected,"a modified digest is rejected before installation");
            check(!store.active(),"updater does not start a reservation");
            if(app.getPackageManager().canRequestPackageInstalls()){
                deadline=System.currentTimeMillis()+10000;
                while(main.updates.download.installPending&&System.currentTimeMillis()<deadline)Thread.sleep(100);
                check(!main.updates.download.installPending,"verified APK is handed to Android installer");
                android.view.accessibility.AccessibilityNodeInfo root=null;deadline=System.currentTimeMillis()+10000;
                while(System.currentTimeMillis()<deadline){root=getUiAutomation().getRootInActiveWindow();if(root!=null&&root.getPackageName()!=null&&root.getPackageName().toString().contains("packageinstaller"))break;Thread.sleep(100);}
                check(root!=null&&root.getPackageName()!=null&&root.getPackageName().toString().contains("packageinstaller"),"system package installer displays the installation confirmation");
            }
            check(app.getPackageManager().getPackageInfo(app.getPackageName(),0).versionCode==installedCode,"Android installation is not silently confirmed by the app");
            Bundle done=new Bundle();done.putString("stream",assertions+" real download assertions passed\n");finish(Activity.RESULT_OK,done);
        }catch(Throwable error){Bundle result=new Bundle();result.putString("stream","FAILED: "+error+"\n");finish(Activity.RESULT_CANCELED,result);}
        finally{AppUpdates.source=original;PhoneReads.testMode=false;releaseActivity();}
    }
}

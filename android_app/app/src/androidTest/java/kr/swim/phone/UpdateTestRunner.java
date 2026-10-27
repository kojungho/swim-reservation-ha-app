package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;

/** Dedicated emulator only. Public update metadata is mocked; no APK is downloaded or installed. */
public final class UpdateTestRunner extends Instrumentation {
    int assertions;Context app;MainActivity activity;final AtomicInteger reads=new AtomicInteger();
    final AtomicReference<JSONObject> response=new AtomicReference<>();volatile boolean networkFailure=false,slow=false;
    void check(boolean value,String text){if(!value)throw new AssertionError(text);assertions++;Bundle b=new Bundle();b.putString("stream","PASS "+text+"\n");sendStatus(0,b);}
    void await(BooleanSupplier p)throws Exception{long end=System.currentTimeMillis()+10000;while(!p.getAsBoolean()&&System.currentTimeMillis()<end)Thread.sleep(50);if(!p.getAsBoolean())throw new AssertionError("update timeout");}
    JSONObject metadata(int code,int minimum,String kind)throws Exception{return new JSONObject().put("packageId","kr.swim.phone").put("versionCode",code).put("versionName","test-"+code).put("minSupportedVersionCode",minimum).put("changeType",kind).put("sha256","0".repeat(64)).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/swim-test.apk");}
    void request(boolean manual)throws Exception{int before=reads.get();runOnMainSync(()->activity.updates.check(manual));await(()->reads.get()>before);await(()->!activity.updates.running);waitForIdleSync();}
    void close()throws Exception{runOnMainSync(()->{if(activity.updates.dialog!=null)activity.updates.dialog.dismiss();});await(()->activity.updates.dialog==null);}
    @Override public void onCreate(Bundle b){super.onCreate(b);start();}
    @Override public void onStart(){app=getTargetContext();AppUpdates.MetadataSource original=AppUpdates.source;
        try{
            PhoneReads.testMode=true;new LocalStore(app).state("IDLE","업데이트 모의 검증",false);AppUpdates.preferences(app).edit().clear().commit();
            response.set(metadata(BuildConfig.VERSION_CODE,0,"fix"));
            AppUpdates.source=()->{reads.incrementAndGet();if(slow)Thread.sleep(600);if(networkFailure)throw new java.io.IOException("mock");return new JSONObject(response.get().toString());};
            activity=(MainActivity)startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));await(()->reads.get()==1&&!activity.updates.running);
            check(activity.updates.dialog==null,"launch checks once and does not notify for the current version");
            final int resumeBefore=reads.get();getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME").close();await(()->!activity.updates.foreground);
            app.startActivity(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));await(()->activity.updates.foreground&&reads.get()>resumeBefore&&!activity.updates.running);
            check(!activity.isDestroyed(),"returning to an already running Activity checks again without a five-minute or daily throttle");
            response.set(metadata(BuildConfig.VERSION_CODE+1,BuildConfig.VERSION_CODE,"design"));request(false);
            check(activity.updates.dialog!=null&&activity.updates.dialog.getButton(AlertDialog.BUTTON_NEGATIVE).getText().equals("나중에"),"design-only update is optional and offers Later");
            runOnMainSync(()->activity.updates.dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick());await(()->activity.updates.dialog==null);AppUpdates.requireSupported(app);check(activity.updates.dialog==null,"Later keeps the installed app usable");
            request(false);check(activity.updates.dialog==null,"same optional version is checked but its reminder is deferred for 24 hours");
            request(true);check(activity.updates.dialog!=null,"manual check bypasses optional reminder deferral");close();
            response.set(metadata(BuildConfig.VERSION_CODE+1,BuildConfig.VERSION_CODE+1,"compatibility"));request(false);
            check(activity.updates.dialog!=null&&activity.updates.dialog.getButton(AlertDialog.BUTTON_NEGATIVE).getText().equals("닫기"),"compatibility minimum overrides optional deferral");
            boolean blocked=false;try{AppUpdates.requireSupported(app);}catch(IllegalStateException e){blocked=true;}check(blocked,"required compatibility update blocks new actual bookings");close();
            Plan actual=Plan.sample();actual.mode="reserve";blocked=false;try{PlanScheduler.start(app,actual,false);}catch(IllegalStateException e){blocked=e.getMessage().contains("업데이트");}check(blocked&&!new LocalStore(app).active(),"actual scheduler rejects a required update before starting a booking");
            new LocalStore(app).state("WAITING","모의 실행 보존",true);int before=reads.get();runOnMainSync(()->activity.updates.check(false));Thread.sleep(150);
            check(reads.get()==before&&new LocalStore(app).active(),"active reservation is not checked, interrupted or cleared");new LocalStore(app).state("IDLE","모의 종료",false);
            networkFailure=true;request(true);check(activity.updates.dialog!=null,"manual network failure is visible");close();networkFailure=false;
            response.set(metadata(BuildConfig.VERSION_CODE,0,"fix"));slow=true;before=reads.get();runOnMainSync(()->{activity.updates.check(false);activity.updates.check(false);activity.updates.check(true);});await(()->!activity.updates.running);
            check(reads.get()==before+1,"concurrent lifecycle and manual checks share one request");close();slow=false;
            JSONObject invalid=metadata(BuildConfig.VERSION_CODE+1,BuildConfig.VERSION_CODE+2,"compatibility");boolean rejected=false;try{AppUpdates.validate(invalid);}catch(Exception e){rejected=true;}check(rejected,"minimum above the published version is rejected");
            invalid=metadata(BuildConfig.VERSION_CODE+1,0,"fix").put("apkUrl","https://evil.invalid/app.apk");rejected=false;try{AppUpdates.validate(invalid);}catch(Exception e){rejected=true;}check(rejected,"foreign download destinations are rejected");
            Bundle done=new Bundle();done.putString("stream",assertions+" update assertions passed\n");finish(Activity.RESULT_OK,done);
        }catch(Throwable e){Bundle b=new Bundle();b.putString("stream","FAILED: "+e);finish(Activity.RESULT_CANCELED,b);}
        finally{AppUpdates.source=original;PhoneReads.testMode=false;new LocalStore(app).state("IDLE","업데이트 검증 종료",false);AppUpdates.preferences(app).edit().clear().commit();if(activity!=null)runOnMainSync(()->activity.finish());}
    }
}

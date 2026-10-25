package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.os.*;
import android.net.Uri;
import java.io.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** On-device integration tests; only intercepted demo pages, never real site bookings. */
public class EngineTestRunner extends Instrumentation {
    int assertions=0;StringBuilder report=new StringBuilder();Context app;LocalStore store;Activity activity;boolean liveInspect=false;
    void check(boolean value,String message){assertions++;if(!value)throw new AssertionError(message);report.append("PASS ").append(message).append('\n');Bundle b=new Bundle();b.putString("stream","PASS "+message+"\n");sendStatus(0,b);}
    void await(BooleanSupplier predicate,long timeout)throws Exception{long end=System.currentTimeMillis()+timeout;while(!predicate.getAsBoolean()&&System.currentTimeMillis()<end)Thread.sleep(100);if(!predicate.getAsBoolean())throw new AssertionError("Timed out: "+store.stage()+" / "+store.message());}
    String shell(String command)throws Exception {try(ParcelFileDescriptor fd=getUiAutomation().executeShellCommand(command);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);liveInspect=arguments!=null&&"live-inspect".equals(arguments.getString("scenario"));start();}
    void startDemo(String action)throws Exception{
        startPlan(Plan.sample(),action);
    }
    void startPlan(Plan p,String action)throws Exception{
        activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        store.state("IDLE",p.demo()?"모의 테스트 준비":"읽기 전용 연결 확인",false);
        PlanScheduler.start(app,p,"INSPECT".equals(action));
    }
    void waitDone()throws Exception{await(()->!store.active()&&!store.stage().equals("IDLE"),45000);}
    void releaseActivity(){if(activity!=null){runOnMainSync(()->activity.finish());activity=null;}}
    void preview(String name)throws Exception{waitForIdleSync();Thread.sleep(300);android.graphics.Bitmap bitmap=getUiAutomation().takeScreenshot();if(bitmap!=null){try(FileOutputStream out=new FileOutputStream(new File(app.getExternalFilesDir(null),name))){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}}
    String js(String code)throws Exception{CountDownLatch ready=new CountDownLatch(1);String[] value=new String[1];runOnMainSync(()->((MainActivity)activity).screen.evaluateJavascript(code,result->{value[0]=result;ready.countDown();}));if(!ready.await(5,TimeUnit.SECONDS))throw new AssertionError("UI script timeout");return String.valueOf(new org.json.JSONTokener(value[0]).nextValue());}
    void uiReady()throws Exception{long end=System.currentTimeMillis()+15000;while(System.currentTimeMillis()<end){String error=js("document.documentElement.dataset.error||''");if(!error.isEmpty())throw new AssertionError("UI init: "+error);if(js("document.documentElement.dataset.ready||''").equals("true"))return;Thread.sleep(100);}throw new AssertionError("UI not ready");}
    @Override public void onStart(){
        app=getTargetContext();store=new LocalStore(app);
        AppUpdates.MetadataSource originalUpdateSource=AppUpdates.source;
        try{
            shell("pm grant "+app.getPackageName()+" android.permission.POST_NOTIFICATIONS");
            shell("appops set "+app.getPackageName()+" SCHEDULE_EXACT_ALARM allow");
            if(liveInspect){
                Plan readOnly=Plan.sample();readOnly.mode="reserve";readOnly.name="";readOnly.payer="";readOnly.phone="";readOnly.birth="";
                startPlan(readOnly,"INSPECT");waitDone();
                Bundle result=new Bundle();result.putString("stream","READ-ONLY SITE RESULT: "+store.stage()+" / "+store.message()+"\nNo booking forms submitted.\n");finish(Activity.RESULT_OK,result);return;
            }
            PhoneReads.testMode=true;
            AppUpdates.source=()->new org.json.JSONObject().put("packageId","kr.swim.phone").put("versionCode",BuildConfig.VERSION_CODE).put("versionName",BuildConfig.VERSION_NAME).put("minSupportedVersionCode",0).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/mock.apk");
            check(PhoneEngine.permitted(Uri.parse("https://www.swimozicamp.com/camp/book.php"),true,false),"new official reservation route allowed");
            check(!PhoneEngine.permitted(Uri.parse("https://evil.invalid/reservation/order_ok3.php"),true,false),"foreign origin blocked");
            check(!PhoneEngine.permitted(Uri.parse("http://newpension.logosweb.or.kr/reservation/order_ok3.php"),true,false),"cleartext blocked");
            check(!PhoneEngine.permitted(Uri.parse("https://newpension.logosweb.or.kr/reservation/order_del3.php"),true,false),"cancellation navigation blocked");
            Plan p=Plan.sample();p.validate(false);store.save("test",p);
            check(store.load("test").phone.equals(p.phone),"Keystore encrypted round trip");
            check(!app.getSharedPreferences("phone-private",0).getString("test","").contains(p.phone),"stored envelope excludes plaintext phone");
            p.birth="";p.payer="";p.validate(false);check(true,"new site needs no birthday and payer is optional");boolean rejected=false;
            store.markSubmitted();check(new LocalStore(app).uncertain(),"pre-submit marker survives store recreation");store.acknowledgeReceiptCheck();
            check(!store.uncertain(),"explicit receipt acknowledgement clears lock");
            check(new Plan().pollSeconds==600,"default vacancy interval is ten minutes");
            Plan minimum=Plan.sample();minimum.pollSeconds=599;rejected=false;try{minimum.validate(false);}catch(Exception e){rejected=true;}
            check(rejected,"interval shorter than ten minutes rejected");
            minimum.pollSeconds=600;minimum.validate(false);check(true,"ten-minute interval accepted");
            check(Plan.from(Plan.sample().json().put("pollSeconds",60)).pollSeconds==600,"legacy one-minute setting migrates to ten minutes");
            check(RoomCatalog.NAMES.size()==14&&RoomCatalog.NAMES.stream().distinct().count()==14,"all fourteen add-on sites available without duplicate names");
            check(RoomCatalog.NAMES.stream().filter(n->n.endsWith("_하늘존")).count()==8&&RoomCatalog.NAMES.stream().filter(n->n.endsWith("_산맥존")).count()==6,"sky and mountain zone inventories match the add-on");
            java.util.List<String> ordered=RoomCatalog.parse("솔_산맥존, 꿈_산맥존, 솔_산맥존");RoomCatalog.move(ordered,1,-1);
            check(ordered.equals(java.util.List.of("꿈_산맥존","솔_산맥존")),"site priorities deduplicate and reorder without renaming");
            Uri official=Uri.parse(SiteLinks.reservation(Plan.sample().date));
            check(Plan.sample().date.equals(official.getQueryParameter("ci")),"official browser link includes selected stay date");
            check(official.getQueryParameterNames().equals(java.util.Set.of("ci","co","ad","ch","in"))&&SiteLinks.receipts().getPath().endsWith("lookup.php"),"separate receipt and reservation links contain no guest fields");
            check(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS.equals(DeviceSettings.batterySettings().getAction()),"battery settings button targets settings rather than the permission request");
            check(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.equals(DeviceSettings.batteryRequest(app).getAction()),"battery allowlist request remains a separate action");
            activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            uiReady();
            check(js("document.querySelectorAll('[data-workspace-tab]').length").equals("9"),"all nine add-on workspace menu entries present");
            check(js("document.querySelectorAll('#roomList input[type=checkbox]').length").equals("14"),"add-on styled room list provides all fourteen checkboxes");
            js("selected=new Set(['꿈_산맥존','솔_산맥존']);moveRoom('솔_산맥존',-1);renderRooms()");
            check(js("readPlan().rooms").equals("솔_산맥존, 꿈_산맥존"),"room selection and order feed the actual phone plan");
            store.save("test-room-choice",Plan.from(new org.json.JSONObject(js("JSON.stringify(readPlan())"))));check(store.load("test-room-choice").rooms.equals("솔_산맥존, 꿈_산맥존"),"selected sites and rank survive encrypted storage");
            js("$('startDate').value='2026-12-22';$('nights').value='2';uiSettings.stayRange=true;applyUi();$('startDate').click()");
            check(js("$('datePickerDialog').open&&$('datePickerMonth').textContent==='2026년 12월'").equals("true"),"same add-on calendar opens at the selected month");preview("phone-calendar.png");
            js("document.querySelector('[data-date=\\\"2026-12-23\\\"]').click();document.querySelector('[data-date=\\\"2026-12-25\\\"]').click()");
            check(js("$('startDate').value+','+$('checkoutDate').value+','+$('nights').value").equals("2026-12-23,2026-12-25,2"),"check-in and checkout calendar calculates two nights");
            js("$('startDate').click();document.querySelector('[data-date=\\\"2026-12-26\\\"]').click();$('datePickerCancel').click()");
            check(js("$('startDate').value").equals("2026-12-23"),"canceling range selection preserves the previous stay");
            js("$('startDate').click();document.querySelector('[data-date=\\\"2026-12-23\\\"]').click()");
            check(js("document.querySelector('[data-date=\\\"2026-12-30\\\"]').disabled").equals("true"),"calendar blocks stays longer than six nights");js("$('datePickerCancel').click()");
            js("$('triggerAt').value='2026-12-01T00:00:00';$('triggerAt').click();$('datePickerTime').value='12:34:56';$('datePickerApply').click()");
            check(js("$('triggerAt').value").equals("2026-12-01T12:34:56"),"shared datetime picker preserves hour minute and second");
            js("$('startDate').click();$('datePickerNext').click()");check(js("$('datePickerMonth').textContent").equals("2027년 1월"),"calendar crosses the year boundary");js("$('datePickerCancel').click()");
            js("switchTab('settings');uiSettings.stayRange=false;applyUi()");check(js("$('checkoutField').hidden&&!$('nightsField').hidden").equals("true"),"settings switches between nights and checkout-date selection");preview("phone-settings.png");
            js("switchTab('multiple')");check(js("$('phoneUnsupported').hidden&&!$('planCard').hidden&&readPlan().mode==='multiple'").equals("true"),"multiple booking is connected to a native plan");
            check(js("document.querySelectorAll('#roomList .room-drag-handle').length===14&&![...document.querySelectorAll('#roomList button')].some(b=>['↑','↓'].includes(b.textContent))").equals("true"),"drag handles replace visible rank arrows");
            js("switchTab('watch')");check(js("readPlan().trigger").equals("0"),"vacancy watch does not inherit a hidden scheduled start time");
            js("$('watchInterval').value='1'");check(js("(()=>{try{readPlan();return false}catch(e){return true}})()").equals("true"),"phone UI rejects a one-minute query interval");js("$('watchInterval').value='10'");
            js("switchTab('priority');window.scrollTo(0,0)");preview("phone-addon-ui.png");
            check(MainActivity.localUi(Uri.parse("https://phone.swim.invalid/index.html"),true)&&!MainActivity.localUi(Uri.parse("https://evil.invalid/index.html"),true),"UI bridge is confined to bundled app origin");
            check(!MainActivity.localUi(Uri.parse("https://phone.swim.invalid/phone.js"),true)&&!MainActivity.localUi(Uri.parse("file:///index.html"),true),"remote files and script documents cannot host the UI bridge");
            PhoneRepository repository=new PhoneRepository(app);Plan snapshot=Plan.sample();snapshot.mode="reserve";
            org.json.JSONObject registered=repository.put("plans",new org.json.JSONObject().put("title","모의 일정").put("plan",snapshot.json()));String id=registered.getJSONArray("plans").getJSONObject(0).getString("id");
            org.json.JSONObject savedProfile=repository.put("profiles",new org.json.JSONObject().put("name","모의예약자").put("payer","모의입금자").put("phone","01000000000").put("birth","19900101"));
            String profileId=savedProfile.getJSONArray("profiles").getJSONObject(0).getString("id");repository.delete("profiles",profileId);
            check(repository.load().getJSONArray("plans").getJSONObject(0).getJSONObject("plan").getString("name").equals(snapshot.name),"registered plan retains profile snapshot after profile deletion");
            check(!app.getSharedPreferences("phone-private",0).getString("phone-ui-v1","").contains(snapshot.name),"profiles and plan history vault excludes plaintext identity");
            repository.saveDraft(snapshot.json());Plan watchDraft=Plan.from(snapshot.json());watchDraft.mode="watch";repository.saveDraft(watchDraft.json());
            check(repository.load().getJSONObject("drafts").has("reserve")&&repository.load().getJSONObject("drafts").has("watch"),"encrypted drafts retain separate booking modes");
            repository.completeDraft(snapshot);check(repository.load().getJSONObject("drafts").getJSONObject("reserve").getString("name").isEmpty()&&repository.load().getJSONObject("draft").getString("mode").equals("watch"),"completion clears only its matching mode and preserves another draft");
            Plan edited=Plan.from(snapshot.json());edited.request="새로 편집";repository.saveDraft(edited.json());repository.completeDraft(snapshot);
            check(repository.load().getJSONObject("draft").getString("request").equals("새로 편집"),"completion cannot erase a newly edited draft");
            repository.delete("plans",id);releaseActivity();

            activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
            js("$('monthlyMonth').value='2026-11';switchTab('monthly');requestPhoneMonth()");
            await(()->{try{return !store.loadDocument("monthly-result").optBoolean("pending");}catch(Exception e){return false;}},5000);
            js("poll()");check(js("document.querySelector('.monthly-count.booked').textContent").equals("0곳"),"native monthly result renders a one-line zero badge");
            check(js("document.querySelector('.monthly-count.available').textContent").equals("4곳"),"native monthly result distinguishes available counts");
            PhoneReads.time(app);await(()->{try{return SiteClock.state(app).optBoolean("synced");}catch(Exception e){return false;}},5000);check(Math.abs(SiteClock.offset(app))<1000,"server clock round-trip correction is bounded");
            org.json.JSONArray lookupPeople=new org.json.JSONArray().put(new org.json.JSONObject().put("name","모의예약자").put("phone","01000000000")).put(new org.json.JSONObject().put("name","내역없음").put("phone","01000000001"));
            runOnMainSync(()->{try{CampLookup.begin(app,lookupPeople);}catch(Exception e){throw new RuntimeException(e);}});
            await(()->CampLookup.active==null,20000);org.json.JSONObject lookupResult=store.loadDocument("lookup-result");
            check(lookupResult.getJSONArray("errors").length()==0&&lookupResult.getJSONArray("rows").length()==2,"native original lookup form and two detail POSTs produce validated records");
            check(lookupResult.getJSONArray("profiles").getJSONObject(1).getInt("count")==0,"explicit empty lookup is zero, not an error");
            check(!lookupResult.toString().contains("01000000000")&&!lookupResult.toString().contains("fake-"),"stored lookup results exclude contact and detail-selection tokens");
            android.graphics.Bitmap photo=android.graphics.Bitmap.createBitmap(80,80,android.graphics.Bitmap.Config.ARGB_8888);photo.eraseColor(android.graphics.Color.GREEN);java.io.File photoFile=new java.io.File(app.getCacheDir(),"map-test.png");try(java.io.FileOutputStream output=new java.io.FileOutputStream(photoFile)){photo.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}photo.recycle();
            MapPhotos maps=new MapPhotos(app);maps.add(Uri.fromFile(photoFile));org.json.JSONObject gallery=maps.state();String photoId=gallery.getJSONArray("photos").getString(gallery.getJSONArray("photos").length()-1);
            check(maps.file(photoId).isFile()&&gallery.getString("selected").equals(photoId),"photo selection is decoded, stored privately and applied");
            maps.apply("select","");check(maps.state().getString("selected").isEmpty(),"default campground map can be restored without deleting history");maps.apply("delete",photoId);check(!maps.file(photoId).exists(),"confirmed gallery deletion removes only the selected private photo");
            releaseActivity();

            for(String batchMode:java.util.List.of("multiple","profiles-parallel")){
                PhoneEngine.demoScenario="camp";PhoneEngine.demoDocumentRequests=0;Plan batchPlan=Plan.sample();batchPlan.simulation=true;batchPlan.mode=batchMode;batchPlan.submitInterval=0;batchPlan.rooms="해_하늘존, 달_하늘존";
                if(batchMode.equals("profiles-parallel"))batchPlan.people=new org.json.JSONArray().put(new org.json.JSONObject().put("name","모의예약자").put("phone","01000000000").put("rooms","해_하늘존, 달_하늘존")).put(new org.json.JSONObject().put("name","다음예약자").put("phone","01000000001").put("rooms","달_하늘존"));
                startPlan(batchPlan,"START");await(()->!store.active(),70000);check(store.stage().equals("SUCCESS")&&PhoneEngine.demoDocumentRequests==4,"native "+batchMode+" completes two verified isolated sessions without duplicate submits");releaseActivity();
            }
            PhoneEngine.demoScenario="camp-429";PhoneEngine.demoDocumentRequests=0;Plan blockedBatch=Plan.sample();blockedBatch.simulation=true;blockedBatch.mode="multiple";blockedBatch.rooms="해_하늘존, 달_하늘존";startPlan(blockedBatch,"START");waitDone();check(store.stage().equals("CHECK_REQUIRED")&&PhoneEngine.demoDocumentRequests==2,"batch 429 halts remaining tasks without replay");releaseActivity();

            for(String scenario:java.util.List.of("camp-wrong-date","camp-not-open","camp","camp-429","camp-wrong-receipt")){
                PhoneEngine.demoScenario=scenario;PhoneEngine.demoDocumentRequests=0;startDemo("START");
                if(scenario.equals("camp")){await(()->store.message().contains("12초"),15000);releaseActivity();shell("cmd deviceidle whitelist +"+app.getPackageName());shell("dumpsys battery unplug");shell("dumpsys deviceidle force-idle");}
                waitDone();String expected=scenario.equals("camp")?"SUCCESS":scenario.equals("camp-429")||scenario.equals("camp-wrong-receipt")?"CHECK_REQUIRED":"FAILED";
                check(store.stage().equals(expected),"new site "+scenario+" returns "+expected+" without retry");
                check(PhoneEngine.demoDocumentRequests==(scenario.equals("camp-wrong-date")||scenario.equals("camp-not-open")?1:2),"new site only expected document count: "+scenario);
                shell("dumpsys deviceidle unforce");shell("dumpsys battery reset");releaseActivity();
            }
            PhoneEngine.demoScenario="";PhoneEngine.demoDocumentRequests=0;
            startDemo("START");await(()->store.message().contains("12초"),15000);
            check(store.active(),"native engine reached personal form and remains active");
            check(shell("dumpsys power").matches("(?s).*PARTIAL_WAKE_LOCK[^\\n]*'SwimPhone:ReservationEngine'.*"),"partial CPU wake lock held during execution");
            check(shell("dumpsys activity services "+app.getPackageName()).contains("isForeground=true"),"actual engine service is foreground");
            android.graphics.Bitmap preview=getUiAutomation().takeScreenshot();
            if(preview!=null){try(FileOutputStream out=new FileOutputStream(new File(app.getExternalFilesDir(null),"phone-preview.png"))){preview.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}preview.recycle();}
            releaseActivity();
            shell("cmd deviceidle whitelist +"+app.getPackageName());
            shell("dumpsys battery unplug");
            String idle=shell("dumpsys deviceidle force-idle");report.append("IDLE RESULT ").append(idle).append('\n');
            waitDone();check(store.stage().equals("SUCCESS"),"same WebView engine completes after Activity destroyed and forced idle");
            check(PhoneEngine.demoDocumentRequests==5,"room/terms/personal/final/receipt were each visited exactly once");
            check(!store.log().contains("01000000000")&&!store.log().contains("모의예약자"),"logs contain no guest identity");
            shell("dumpsys deviceidle unforce");shell("dumpsys battery reset");
            check(!shell("dumpsys power").matches("(?s).*PARTIAL_WAKE_LOCK[^\\n]*'SwimPhone:ReservationEngine'.*"),"CPU wake lock released after completion");

            PhoneEngine.demoScenario="";PhoneEngine.demoDocumentRequests=0;startDemo("INSPECT");waitDone();
            check(store.stage().equals("INSPECTED")&&PhoneEngine.demoDocumentRequests==1,"lookup cannot submit forms");releaseActivity();
            PhoneEngine.demoScenario="wrong-date";PhoneEngine.demoDocumentRequests=0;startDemo("START");waitDone();
            check(store.stage().equals("FAILED")&&PhoneEngine.demoDocumentRequests==1,"wrong stay date stops before any POST");releaseActivity();
            PhoneEngine.demoScenario="429";PhoneEngine.demoDocumentRequests=0;startDemo("START");waitDone();
            check(store.stage().equals("CHECK_REQUIRED")&&PhoneEngine.demoDocumentRequests==4,"429 final response stops without retry or receipt request");releaseActivity();
            PhoneEngine.demoScenario="wrong-receipt";startDemo("START");waitDone();
            check(store.stage().equals("CHECK_REQUIRED"),"mismatched receipt cannot become success");releaseActivity();
            PhoneEngine.demoScenario="";startDemo("START");await(()->store.message().contains("12초"),15000);
            app.startService(new Intent(app,ReservationService.class).setAction("STOP"));waitDone();
            check(store.stage().equals("STOPPED"),"notification stop cancels pending final submission");releaseActivity();
            Thread.sleep(13000);check(store.stage().equals("STOPPED"),"canceled native delay never submits later");

            PhoneEngine.demoScenario="no-room";PhoneEngine.demoDocumentRequests=0;
            Plan watch=Plan.sample();watch.mode="watch";watch.simulation=true;startPlan(watch,"START");
            await(()->store.stage().equals("WATCHING"),15000);releaseActivity();
            check(store.active()&&PhoneEngine.demoDocumentRequests==1,"vacancy watch remains active without an Activity and never submits a booked room");
            check(store.watchDueElapsed()-SystemClock.elapsedRealtime()>590000,"next watch query scheduled at least ten minutes after the prior cycle");
            check(!shell("dumpsys power").matches("(?s).*PARTIAL_WAKE_LOCK[^\\n]*'SwimPhone:ReservationEngine'.*"),"watch releases CPU wake lock between queries");
            runOnMainSync(()->new AlarmReceiver().onReceive(app,new Intent("TICK")));
            Thread.sleep(500);check(PhoneEngine.demoDocumentRequests==1,"early watch alarm does not query the site");
            store.watchDueElapsed(SystemClock.elapsedRealtime()-1);
            runOnMainSync(()->new AlarmReceiver().onReceive(app,new Intent("TICK")));
            await(()->PhoneEngine.demoDocumentRequests==2&&store.stage().equals("WATCHING"),15000);
            check(store.watchDueElapsed()-SystemClock.elapsedRealtime()>590000,"due watch runs once and parks for another ten minutes");
            app.startService(new Intent(app,ReservationService.class).setAction("STOP"));waitDone();
            check(store.stage().equals("STOPPED"),"watch can be stopped while waiting for its next cycle");
            runOnMainSync(()->new AlarmReceiver().onReceive(app,new Intent("TICK")));
            Thread.sleep(500);check(PhoneEngine.demoDocumentRequests==2,"no registered waiting plan means no vacancy query");

            PhoneEngine.demoScenario="";PhoneEngine.demoDocumentRequests=0;
            shell("appops set "+app.getPackageName()+" SCHEDULE_EXACT_ALARM allow");
            check(AlarmReceiver.permitted(app),"exact alarm capability checked on the device");
            Plan scheduled=Plan.sample();scheduled.trigger=System.currentTimeMillis()+5000;startPlan(scheduled,"START");
            await(()->store.stage().equals("WAITING"),3000);
            check(!ReservationService.alive(),"future reservation waits without an engine service");
            check(java.util.Arrays.stream(app.getSystemService(NotificationManager.class).getActiveNotifications()).noneMatch(n->n.getId()==1&&n.getTag()==null),"future reservation has no ongoing notification");
            check(!shell("dumpsys power").matches("(?s).*PARTIAL_WAKE_LOCK[^\\n]*'SwimPhone:ReservationEngine'.*"),"future schedule does not keep a CPU wake lock while waiting");
            releaseActivity();shell("dumpsys battery unplug");shell("dumpsys deviceidle force-idle");waitDone();
            check(store.stage().equals("SUCCESS")&&PhoneEngine.demoDocumentRequests==5,"exact alarm wakes the independent reservation engine in forced idle");
            shell("dumpsys deviceidle unforce");shell("dumpsys battery reset");

            Plan canceled=Plan.sample();canceled.trigger=System.currentTimeMillis()+60000;startPlan(canceled,"START");
            PlanScheduler.stop(app);runOnMainSync(()->new AlarmReceiver().onReceive(app,new Intent("TICK")));
            Thread.sleep(500);check(store.stage().equals("STOPPED")&&!ReservationService.alive(),"quiet future plan can be canceled without starting a service");releaseActivity();

            PhoneEngine.demoDocumentRequests=0;Plan late=Plan.sample();late.trigger=System.currentTimeMillis()-20000;startPlan(late,"START");waitDone();
            check(store.stage().equals("FAILED")&&PhoneEngine.demoDocumentRequests==0,"overdue schedule cannot silently book late");releaseActivity();
            store.markSubmitted();store.state("SUBMITTING","모의 전송 중 앱 종료",true);
            activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            app.startForegroundService(new Intent(app,ReservationService.class).setAction("RECOVER"));waitDone();
            check(store.stage().equals("CHECK_REQUIRED")&&store.uncertain()&&PhoneEngine.demoDocumentRequests==0,"process recovery never replays an uncertain final submission");store.acknowledgeReceiptCheck();releaseActivity();

            store.state("WATCHING","모의 재부팅 상태",true);new RecoveryReceiver().onReceive(app,new Intent("untrusted"));
            check(store.stage().equals("WATCHING"),"spoofed recovery broadcast cannot modify a plan");
            new RecoveryReceiver().onReceive(app,new Intent(Intent.ACTION_BOOT_COMPLETED));
            check(store.stage().equals("STOPPED")&&!store.active(),"reboot stops a watch instead of secretly placing a booking");
            Bundle done=new Bundle();done.putString("stream","\n"+assertions+" assertions passed\n"+report);finish(Activity.RESULT_OK,done);
        }catch(Throwable e){Bundle result=new Bundle();result.putString("stream","FAILED: "+e+"\n"+store.log()+"\n"+report);finish(Activity.RESULT_CANCELED,result);}
        finally{AppUpdates.source=originalUpdateSource;PhoneEngine.demoScenario="";if(!liveInspect&&store.active())PlanScheduler.stop(app);try{shell("dumpsys deviceidle unforce");shell("dumpsys battery reset");}catch(Exception ignored){}releaseActivity();}
    }
}

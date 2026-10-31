package kr.swim.phone;
import android.app.*;import android.content.*;import org.json.*;import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.android.controller.ServiceController;import org.robolectric.annotation.*;import javax.crypto.spec.SecretKeySpec;import java.time.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28) @LooperMode(LooperMode.Mode.PAUSED)
public class PreflightTest {
 Context c;LocalStore store;Plan plan;ServiceController<PreflightService> controller;PreflightService service;PreflightService.Factory previous;int count;PreflightService.Result callback;
 long epoch(String value){return LocalDateTime.parse(value).atZone(Plan.SEOUL).toInstant().toEpochMilli();}
 @Before public void setup()throws Exception{
  c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");AppProblems.testPaused=true;
  for(int n=0;n<=5;n++)c.getSharedPreferences(n==0?"phone-private":"phone-run-"+n,0).edit().clear().commit();
  long now=System.currentTimeMillis();long daytime=PreflightPolicy.at(PreflightPolicy.day(now),11);c.getSharedPreferences("site-clock",0).edit().putLong("offset",daytime-now).commit();
  plan=Plan.sample();plan.mode="reserve";plan.trigger=PreflightPolicy.at(PreflightPolicy.day(SiteClock.now(c)).plusDays(1),0);
  store=new LocalStore(c,1);store.saveDocument("run",plan.json().put("_planId","private-plan").put("_lookup",false));store.state("WAITING","원래 예약 대기",true);
  previous=PreflightService.factory;PreflightService.factory=(ctx,p,result)->{count++;callback=result;return new PhoneExecution(){public void start(){}public void cancel(){}};};
  controller=Robolectric.buildService(PreflightService.class).create();service=controller.get();ReservationService.channel(c);
 }
 @After public void cleanup(){controller.destroy();PreflightService.factory=previous;LocalStore.testKey=null;AppProblems.testPaused=false;}
 void start(){service.onStartCommand(new Intent(c,PreflightService.class).setAction("CHECK").putExtra("slot",1),0,1);}
 @Test public void seoulDaytimeAndPreviousCalendarDayAreExact(){
  long target=epoch("2030-10-01T00:00:00");assertEquals(epoch("2030-09-30T10:00:00"),PreflightPolicy.due(target));
  assertFalse(PreflightPolicy.daytime(epoch("2030-09-30T07:59:59")));assertTrue(PreflightPolicy.daytime(epoch("2030-09-30T08:00:00")));assertTrue(PreflightPolicy.daytime(epoch("2030-09-30T18:59:59")));assertFalse(PreflightPolicy.daytime(epoch("2030-09-30T19:00:00")));
  assertEquals(0,PreflightPolicy.next(target,epoch("2030-09-30T20:00:00")));assertEquals(epoch("2030-09-30T10:00:00"),PreflightPolicy.next(target,epoch("2030-09-29T20:00:00")));
  long noon=epoch("2030-10-01T12:00:00");assertEquals(epoch("2030-10-01T08:00:00"),PreflightPolicy.next(noon,epoch("2030-09-30T20:00:00")));
  assertTrue(PreflightPolicy.dates(epoch("2030-09-30T10:00:00"),"2030-12-01").stream().allMatch(d->d.compareTo("2030-12-01")<0));
 }
 @Test public void checkDoesNotMutateWaitingRunOrSubmitRecordsAndNotifiesOnce()throws Exception{
  String original=store.loadDocument("run").toString();long heartbeat=store.heartbeat();start();assertEquals(1,count);callback.done("passed","","preflight");
  assertEquals("WAITING",store.stage());assertEquals("원래 예약 대기",store.message());assertTrue(store.active());assertFalse(store.uncertain());assertEquals(heartbeat,store.heartbeat());assertEquals(original,store.loadDocument("run").toString());assertEquals(0,new BookingRecords(c).list().length());
  assertEquals("passed",store.loadDocument("preflight-check").getString("state"));assertFalse(c.getSharedPreferences("phone-run-1",0).getString("preflight-check","").contains("passed"));
  Notification note=Shadows.shadowOf(c.getSystemService(NotificationManager.class)).getNotification(851);assertNotNull(note);assertEquals("예약 사전 점검 통과",note.extras.getString(Notification.EXTRA_TITLE));assertTrue(store.log().contains("최종 제출하지 않았으며"));
  start();assertEquals(1,count);
 }
 @Test public void errorsAndTimeoutLeaveRealAlarmAndWaitingActive()throws Exception{
  AlarmReceiver.schedule(c,plan.trigger,1);start();callback.done("failed","PAYMENT_METHOD_UNRECOGNIZED","prepare");assertEquals("WAITING",store.stage());assertTrue(store.active());assertFalse(store.uncertain());
  Notification note=Shadows.shadowOf(c.getSystemService(NotificationManager.class)).getNotification(851);assertTrue(note.extras.getString(Notification.EXTRA_TEXT).contains("무통장입금"));assertFalse(PreflightService.message("failed","SECRET_01012345678","SECRET_NAME").contains("SECRET"));
  assertNotEquals(AlarmReceiver.pending(c,1),PreflightReceiver.pending(c,1));assertNotEquals(PreflightReceiver.pending(c,1),PreflightReceiver.pending(c,2));
 }
 @Test public void interruptedMarkerReportsInsteadOfRepeatingEngine()throws Exception{
  store.saveDocument("preflight-check",new JSONObject().put("key",PreflightReceiver.key(c,1)).put("state","checking"));start();assertEquals(0,count);assertEquals("INTERRUPTED",store.loadDocument("preflight-check").getString("code"));assertEquals("WAITING",store.stage());
 }
 @Test public void modifiedOrStoppedRunSuppressesStaleResult()throws Exception{
  start();JSONObject run=store.loadDocument("run");run.put("phone","01099999999");store.saveDocument("run",run);callback.done("passed","","preflight");assertNull(Shadows.shadowOf(c.getSystemService(NotificationManager.class)).getNotification(851));assertEquals("WAITING",store.stage());
 }
 @Test public void busyBookingDefersCheckRatherThanTouchingRun()throws Exception{
  new LocalStore(c,2).state("PREPARING","실제 준비",true);start();assertEquals(0,count);assertEquals("WAITING",store.stage());assertNull(store.loadDocument("preflight-check"));
 }
 @Test public void stopCancelsOnlyTheCheckAndNoMisleadingResult()throws Exception{
  start();PlanScheduler.stopSlot(c,1);assertEquals("STOPPED",store.stage());assertNull(Shadows.shadowOf(c.getSystemService(NotificationManager.class)).getNotification(851));assertFalse(PreflightService.alive(1));
 }
 @Test public void updateRecoveryRestoresSeparateCheckAlarmWithoutStartingEngine()throws Exception{
  new RecoveryReceiver().onReceive(c,new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));assertEquals(0,count);assertTrue(store.active());assertEquals("WAITING",store.stage());
  assertTrue(Shadows.shadowOf(c.getSystemService(AlarmManager.class)).getScheduledAlarms().stream().anyMatch(alarm->PreflightReceiver.pending(c,1).equals(alarm.operation)));
 }
 @Test public void timeoutSignalsProblemButNeverStopsRealWaiting()throws Exception{
  start();Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(121));assertEquals("TIMEOUT",store.loadDocument("preflight-check").getString("code"));assertTrue(store.active());assertEquals("WAITING",store.stage());assertFalse(store.uncertain());
 }
}

package kr.swim.phone;
import org.junit.*;import static org.junit.Assert.*;
import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.android.controller.ServiceController;import org.robolectric.annotation.*;
import android.app.*;import android.content.*;import javax.crypto.spec.SecretKeySpec;import org.json.*;import java.util.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28) @LooperMode(LooperMode.Mode.PAUSED)
public class MultiRunTest {
 Context c;ServiceController<ReservationService> controller;ReservationService service;
 Map<Integer,Fake> engines=new HashMap<>();ReservationTask.Factory original;
 class Fake implements PhoneExecution {
  final Context context;final PhoneEngine.Events events;boolean canceled=false;
  Fake(Context c,PhoneEngine.Events e){context=c;events=e;}
  public void start(){events.stage("PREPARING","모의 엔진 실행");}
  public void cancel(){canceled=true;events.finished(new LocalStore(context).uncertain()?"CHECK_REQUIRED":"STOPPED","모의 중지");}
 }
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");PhoneSessions.testSupported=true;
  for(int n=0;n<=5;n++)c.getSharedPreferences(n==0?"phone-private":"phone-run-"+n,0).edit().clear().commit();
  original=ReservationTask.factory;ReservationTask.factory=(context,plan,lookup,events)->{Fake f=new Fake(context,events);engines.put(RunContext.slot(context),f);return f;};
  controller=Robolectric.buildService(ReservationService.class).create();service=controller.get();ReservationService.channel(c);
 }
 @After public void cleanup(){controller.destroy();ReservationTask.factory=original;PhoneSessions.testSupported=null;LocalStore.testKey=null;PhoneReads.testMode=false;}
 Plan plan(){Plan p=Plan.sample();p.mode="reserve";return p;}
 void start(int slot,String id)throws Exception{PlanScheduler.start(c,plan(),false);LocalStore s=new LocalStore(c,slot);s.saveDocument("run",s.loadDocument("run").put("_planId",id));service.onStartCommand(new Intent(c,ReservationService.class).setAction("RUN").putExtra("slot",slot),0,slot);}
 @Test public void fiveEnginesRunIndependentlyAndOneStopDoesNotStopOthers()throws Exception{
  for(int n=1;n<=5;n++)start(n,"plan-"+n);assertEquals(5,PhoneRuns.count(c));assertEquals(5,service.tasks.size());
  try{PlanScheduler.start(c,plan(),false);fail("sixth run accepted");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("5개"));}
  service.onStartCommand(new Intent(c,ReservationService.class).setAction("STOP").putExtra("slot",2),0,9);
  assertTrue(engines.get(2).canceled);assertFalse(new LocalStore(c,2).active());assertEquals(4,PhoneRuns.count(c));
  for(int n:new int[]{1,3,4,5}){assertFalse(engines.get(n).canceled);assertTrue(new LocalStore(c,n).active());}
  JSONArray runs=PhoneRuns.snapshot(c).getJSONArray("runs");assertEquals(5,runs.length());
 }
 @Test public void submissionMarkerAndStoppedStateArePerSchedule()throws Exception{
  start(1,"one");start(2,"two");engines.get(1).events.beforeFinal();assertTrue(new LocalStore(c,1).uncertain());assertFalse(new LocalStore(c,2).uncertain());
  try{engines.get(1).events.beforeFinal();fail("duplicate final accepted");}catch(IllegalStateException expected){}
  engines.get(2).events.beforeFinal();assertTrue(new LocalStore(c,2).uncertain());
  service.onStartCommand(new Intent(c,ReservationService.class).setAction("STOP").putExtra("slot",1),0,3);
  assertEquals("CHECK_REQUIRED",new LocalStore(c,1).stage());assertTrue(new LocalStore(c,2).active());
  assertEquals(3,PhoneRuns.allocate(c,false,"new"));
 }
 @Test public void alarmsAndRecoveryAreIndependentAndFutureWaitingAllowsCalendar()throws Exception{
  Plan p=Plan.sample();p.trigger=System.currentTimeMillis()+3600000;PlanScheduler.start(c,p,false);PlanScheduler.start(c,p,false);
  assertNotEquals(AlarmReceiver.pending(c,1),AlarmReceiver.pending(c,2));
  AlarmReceiver.cancel(c,1);assertTrue(new LocalStore(c,2).active());
  new RecoveryReceiver().onReceive(c,new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));assertEquals("WAITING",new LocalStore(c,1).stage());assertEquals("WAITING",new LocalStore(c,2).stage());
  PhoneReads.testMode=true;String month="2098-11";JSONObject first=PhoneReads.calendar(c,month,true);assertTrue(first.optBoolean("pending"));
  long until=System.currentTimeMillis()+5000;JSONObject result;do{Thread.sleep(20);result=PhoneReads.calendar(c,month);}while(result.optBoolean("pending")&&System.currentTimeMillis()<until);
  assertTrue(result.toString(),result.optBoolean("ok"));assertEquals(4,result.getJSONObject("days").getInt(month+"-02"));assertEquals(2,PhoneRuns.count(c));
 }
 @Test public void duplicatePlanAndUnsupportedProfileCannotShareSession()throws Exception{
  start(1,"same");try{PhoneRuns.allocate(c,false,"same");fail("same plan duplicated");}catch(IllegalStateException expected){}
  PhoneSessions.testSupported=false;try{PhoneRuns.allocate(c,false,"different");fail("unsupported parallel accepted");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("WebView"));}
 }
 @Test public void completedHistoryCannotBeRestartedAfterItsSlotIsReused()throws Exception{
  start(1,"done");engines.get(1).events.finished("SUCCESS","모의 완료");assertEquals(0,PhoneRuns.count(c));
  try{PhoneRuns.allocate(c,false,"done");fail("completed schedule restarted");}catch(IllegalStateException expected){}
  PhoneRuns.archive(c,1);new LocalStore(c,1).saveDocument("run",plan().json().put("_planId","new"));new LocalStore(c,1).state("STOPPED","새 일정",false);
  try{PhoneRuns.allocate(c,false,"done");fail("archived completed schedule restarted");}catch(IllegalStateException expected){}
  assertEquals(1,PhoneRuns.allocate(c,false,"different"));
 }
 @Test public void ambiguousSubmissionBlocksOverlappingRetryUntilExplicitReview()throws Exception{
  start(1,"uncertain");engines.get(1).events.beforeFinal();
  try{PhoneRuns.guardUncertain(c,plan());fail("overlapping uncertain booking retried");}catch(IllegalStateException expected){}
  Plan other=plan();other.phone="01011111111";PhoneRuns.guardUncertain(c,other);
  service.onStartCommand(new Intent(c,ReservationService.class).setAction("STOP").putExtra("slot",1),0,7);PhoneRuns.acknowledge(c);assertFalse(new LocalStore(c,1).uncertain());assertEquals("STOPPED",new LocalStore(c,1).stage());PhoneRuns.guardUncertain(c,plan());
 }
 @Test public void oldSingleRunBindsToItsUniqueSavedPlanBeforeStartingAnother()throws Exception{
  Plan p=plan();p.trigger=System.currentTimeMillis()+3600000;PhoneRepository repo=new PhoneRepository(c);JSONObject saved=repo.put("plans",new JSONObject().put("title","이전 일정").put("plan",p.json()));String id=saved.getJSONArray("plans").getJSONObject(0).getString("id");
  LocalStore old=new LocalStore(c,0);old.save("run",p);old.state("WAITING","이전 버전 대기",true);repo.bindLegacyRun();assertEquals(id,old.runPlanId());assertTrue(PhoneRuns.activePlan(c,id));
  try{PhoneRuns.allocate(c,false,id);fail("legacy run duplicated");}catch(IllegalStateException expected){}assertEquals(1,PhoneRuns.allocate(c,false,"different"));
 }
 @Test public void ambiguousOldRunBlocksNewStartsUntilExplicitStop()throws Exception{
  Plan p=plan();PhoneRepository repo=new PhoneRepository(c);for(int n=0;n<2;n++)repo.put("plans",new JSONObject().put("title","같은 일정 "+n).put("plan",p.json()));LocalStore old=new LocalStore(c,0);old.save("run",p);old.state("WAITING","이전 버전 대기",true);repo.bindLegacyRun();assertEquals("",old.runPlanId());
  try{PhoneRuns.allocate(c,false,"different");fail("ambiguous old run duplicated");}catch(IllegalStateException expected){}PlanScheduler.stopSlot(c,0);assertEquals(1,PhoneRuns.allocate(c,false,"different"));
 }
}

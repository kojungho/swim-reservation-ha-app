package kr.swim.phone;
import android.app.*;import android.content.*;import android.os.*;
import java.util.concurrent.*;import java.util.concurrent.atomic.*;
/** Synthetic local pages only; refuses to touch an active run and never submits a booking. */
public final class OpeningReadinessTestRunner extends Instrumentation {
 CampPhoneEngine engine;
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle result=new Bundle();String previous=PhoneEngine.demoScenario;try{
  Context app=getTargetContext();if(PhoneRuns.anyActive(app)||PhoneRuns.anyUncertain(app))throw new AssertionError("active/uncertain emulator run");
  scenario("camp-not-open",false,false,-5,false);
  scenario("camp-opens-second",false,false,2,true);
  scenario("camp-opening-429",false,false,1,false);
  scenario("camp-not-open",true,false,1,false);
  scenario("camp-not-open",false,true,1,false);
  result.putString("stream","PASS local WebView: up to 5 GETs within readiness window, second-read opening, no 429 retry, expired-window stop, cancellation; zero booking POSTs\n");finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("stream","FAILED "+e+"\n");finish(Activity.RESULT_CANCELED,result);}finally{runOnMainSync(()->{if(engine!=null)engine.cancel();});PhoneEngine.demoScenario=previous;PhoneEngine.demoDocumentRequests=0;}}
 void scenario(String scenario,boolean expired,boolean cancel,int expectedReads,boolean prepared)throws Exception{
  CountDownLatch done=new CountDownLatch(1);AtomicBoolean reachedForm=new AtomicBoolean(false),wouldSubmit=new AtomicBoolean(false);AtomicReference<String> outcome=new AtomicReference<>();
  PhoneEngine.demoScenario=scenario;PhoneEngine.demoDocumentRequests=0;
  runOnMainSync(()->{try{Plan plan=Plan.sample();plan.simulation=true;plan.mode="reserve";plan.trigger=SiteClock.now(getTargetContext())-(expired?11000:0);
   engine=new CampPhoneEngine(getTargetContext(),plan,false,new PhoneEngine.Events(){
    public void stage(String stage,String message){if(message.contains("입력값·무통장"))reachedForm.set(true);if(cancel&&message.contains("오픈 반영 대기"))new Handler(Looper.getMainLooper()).postDelayed(()->engine.cancel(),100);}
    public void beforeFinal(){wouldSubmit.set(true);throw new IllegalStateException("Test stops before any POST");}
    public void finished(String stage,String message){outcome.set(stage);done.countDown();}
   });engine.start();
  }catch(Exception e){throw new RuntimeException(e);}});
  if(!done.await(40,TimeUnit.SECONDS))throw new AssertionError(scenario+" timed out");
  if(cancel)Thread.sleep(2200);
  boolean readsCorrect=expectedReads<0?PhoneEngine.demoDocumentRequests>=2&&PhoneEngine.demoDocumentRequests<=-expectedReads:PhoneEngine.demoDocumentRequests==expectedReads;
  if(!readsCorrect||reachedForm.get()!=prepared||wouldSubmit.get()!=prepared)throw new AssertionError(scenario+" GET count="+PhoneEngine.demoDocumentRequests+", form="+reachedForm+", submit guard="+wouldSubmit);
  if(!("FAILED".equals(outcome.get())||cancel&&"STOPPED".equals(outcome.get())))throw new AssertionError("unexpected result "+outcome.get());
 }
}

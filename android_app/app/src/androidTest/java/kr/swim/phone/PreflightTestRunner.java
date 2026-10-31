package kr.swim.phone;
import android.app.*;import android.content.*;import android.net.Uri;import android.os.*;import org.json.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import java.time.*;
/** Offline mock HTML only. No live site access, booking/cancel/deposit or run mutation. */
public final class PreflightTestRunner extends Instrumentation {
 PhonePreflightEngine engine;
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle output=new Bundle();try{
  Context app=getTargetContext();if(PhoneRuns.anyActive(app)||PhoneRuns.anyUncertain(app))throw new AssertionError("active or uncertain emulator run");
  String original=new PhoneRepository(app).load().toString();int records=new BookingRecords(app).list().length();
  scenario("normal","passed",3);scenario("malicious-script","passed",3);scenario("card","failed",2);scenario("phone-missing","failed",2);scenario("no-vacancy","unavailable",7);scenario("http429","failed",1);
  if(!original.equals(new PhoneRepository(app).load().toString())||records!=new BookingRecords(app).list().length()||PhoneRuns.anyActive(app)||PhoneRuns.anyUncertain(app))throw new AssertionError("private data/run changed");
  output.putString("stream","PASS Android WebView preflight: two guests verified offline; site scripts/network/forms blocked; changed payment/phone, no vacancy and HTTP429 detected; GET-only mock transport; no booking record or active run changes\n");finish(Activity.RESULT_OK,output);
 }catch(Throwable error){output.putString("stream","FAILED "+error+"\n");finish(Activity.RESULT_CANCELED,output);}finally{runOnMainSync(()->{if(engine!=null)engine.cancel();});PhonePreflightEngine.testTransport=null;}}
 void scenario(String scenario,String expected,int requests)throws Exception{
  AtomicInteger reads=new AtomicInteger();AtomicReference<String> state=new AtomicReference<>(),code=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
  PhonePreflightEngine.testTransport=url->{reads.incrementAndGet();Uri u=Uri.parse(url);if(scenario.equals("http429"))throw new PhonePreflightEngine.HttpFailure(429);
   if(u.getPath().equals("/camp/"))return "<div class='room-list'>"+(scenario.equals("no-vacancy")?"":"<a class='room-card' href='/camp/site.php?"+u.getEncodedQuery()+"&site=1'><span class='room-name'>하늘존해</span></a>")+"</div>";
   String html="<div class='summary-card'><div class='sum-title'>하늘존해</div></div><form class='js-book' method='post' action='/camp/book.php'><input name='_csrf' type='hidden' value='FAKE'>";
   String[] names={"site","checkin","checkout","adults","children","infants"},values={u.getQueryParameter("site"),u.getQueryParameter("ci"),u.getQueryParameter("co"),u.getQueryParameter("ad"),"0","0"};for(int i=0;i<names.length;i++)html+="<input type='hidden' name='"+names[i]+"' value='"+values[i]+"'>";
   html+="<input name='name' required>"+(scenario.equals("phone-missing")?"":"<input name='phone' type='tel' required>")+"<input name='depositor'><textarea name='request'></textarea><select name='arrive_time'><option value=''></option></select><input name='pay_method' type='hidden' value='"+(scenario.equals("card")?"card":"bank")+"'><label><input name='agree_refund' class='js-agree' data-required='1' type='checkbox' required>필수 환불 규정</label><button class='js-pay' type='submit'>최종 예약</button></form>";
   if(scenario.equals("malicious-script"))html+="<script>document.querySelector('[name=name]').readOnly=true;fetch('/camp/book.php',{method:'POST'});document.querySelector('form').submit()</script><img src='https://www.swimozicamp.com/camp/book.php'>";
   return html;
  };
  runOnMainSync(()->{try{Plan plan=Plan.sample();plan.mode="profiles-parallel";plan.simulation=false;plan.date=LocalDate.now(Plan.SEOUL).plusMonths(4).withDayOfMonth(10).toString();plan.rooms="해_하늘존";plan.people=new JSONArray().put(new JSONObject().put("name","모의예약자").put("phone","01000000000").put("payer","모의입금자").put("rooms","해_하늘존")).put(new JSONObject().put("name","다른예약자").put("phone","01000000001").put("rooms","해_하늘존"));engine=new PhonePreflightEngine(getTargetContext(),plan,(s,c,step)->{state.set(s);code.set(c);done.countDown();});engine.start();}catch(Exception e){throw new RuntimeException(e);}});
  if(!done.await(20,TimeUnit.SECONDS))throw new AssertionError(scenario+" timed out");if(!expected.equals(state.get())||reads.get()!=requests)throw new AssertionError(scenario+" state="+state+" code="+code+" GETs="+reads);
 }
}

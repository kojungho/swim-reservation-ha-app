package kr.swim.phone;
import android.content.Context;import android.os.*;import org.json.JSONObject;
/** Activity-visible read-only inspection. Never a foreground service or reservation notification. */
final class PhoneInspection {
 static PhoneInspection active;final Context context;final LocalStore store;PhoneExecution engine;boolean ended;
 PhoneInspection(Context c){context=new RunContext(c.getApplicationContext(),6);store=new LocalStore(context);}
 static boolean alive(int slot){return slot==6&&active!=null&&!active.ended;}
 static void start(Context c,Plan plan)throws Exception{
  plan.validate(true);if(!PhoneSessions.supported()&&(PhoneRuns.executing(c)||CampLookup.active!=null))throw new IllegalStateException("진행 중인 작업을 먼저 마쳐 주세요.");if(active!=null)throw new IllegalStateException("객실 조회 중입니다.");
  PhoneInspection job=new PhoneInspection(c);active=job;job.store.saveDocument("run",plan.json().put("_lookup",true));job.store.state("STARTING","객실 조회 중",true);job.store.availability(plan,java.util.Set.of(),false,true);
  c.getSystemService(android.app.NotificationManager.class).cancel(200);
  try{job.engine=ReservationTask.factory.create(job.context,plan,true,new PhoneEngine.Events(){
   public void stage(String stage,String message){if(!job.ended)job.store.state(stage,message,true);}
   public void beforeFinal(){throw new IllegalStateException("조회는 예약을 제출할 수 없습니다.");}
   public void finished(String stage,String message){job.finish(stage,message);}
  });job.engine.start();}catch(Exception e){job.finish("FAILED","객실 조회 실패 · 다시 확인하세요.");throw e;}
 }
 void finish(String stage,String message){if(ended)return;ended=true;store.state(stage,message,false);if(active==this)active=null;engine=null;}
 static void cancel(){PhoneInspection job=active;if(job==null)return;PhoneExecution engine=job.engine;job.finish("STOPPED","객실 조회 중지");if(engine!=null)engine.cancel();}
}

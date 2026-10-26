package kr.swim.phone;

import android.content.Context;
import android.os.*;
import org.json.*;
import java.util.*;

/** Separate verified sessions, serialized on Android's process-wide cookie jar. No POST retry. */
final class BatchPhoneEngine {
    final Context context;final Plan parent;final PhoneEngine.Events events;final Handler main=new Handler(Looper.getMainLooper());
    final List<Plan> tasks=new ArrayList<>();final Set<String> claimed=new HashSet<>();final JSONArray results=new JSONArray();
    CampPhoneEngine child;boolean ended=false;int index=0,successes=0;long nextStart=0;
    BatchPhoneEngine(Context c,Plan p,PhoneEngine.Events e)throws Exception{context=c;parent=p;events=e;
        if(p.mode.equals("multiple")){for(String room:p.priorities()){Plan task=Plan.from(p.json());task.mode="reserve";task.people=new JSONArray();task.rooms=room;tasks.add(task);}}
        else for(int i=0;i<p.people.length();i++){JSONObject person=p.people.getJSONObject(i);Plan task=Plan.from(p.json());task.mode="reserve";task.people=new JSONArray();task.name=person.getString("name");task.payer=person.optString("payer");task.phone=person.getString("phone");task.rooms=person.getString("rooms");tasks.add(task);}
    }
    void start(){if(tasks.isEmpty()){finish("FAILED",ResultStatus.batchMessage(0,0));return;}events.stage("PREPARING","다인·다중 예약 시작 · 폰 세션은 순차 격리 실행 · 제출 간격 "+parent.submitInterval+"초 이상");next();}
    void next(){if(ended)return;if(index>=tasks.size()){finish(ResultStatus.batchStage(successes,tasks.size()),ResultStatus.batchMessage(successes,tasks.size()));return;}
        Plan task=tasks.get(index);task.rooms=String.join(", ",task.priorities().stream().filter(room->!claimed.contains(room)).collect(java.util.stream.Collectors.toList()));
        if(task.rooms.isEmpty()){record("NO_ROOM");index++;next();return;}
        long delay=Math.max(0,nextStart-SystemClock.elapsedRealtime());if(delay>0){events.stage("PREPARING","다음 예약 제출 간격 대기");main.postDelayed(this::launch,delay);}else launch();
    }
    void launch(){if(ended)return;Plan task=tasks.get(index);events.stage("PREPARING","예약 "+(index+1)+"/"+tasks.size()+" · 사이트 우선순위 확인");try{child=new CampPhoneEngine(context,task,false,new PhoneEngine.Events(){
        public void stage(String state,String message){events.stage(state,"예약 "+(index+1)+"/"+tasks.size()+" · "+message);}
        public void beforeFinal()throws Exception{events.beforeFinal();nextStart=SystemClock.elapsedRealtime()+parent.submitInterval*1000L;}
        public void finished(String state,String message){CampPhoneEngine completed=child;child=null;if(ended)return;record(state);if(ended)return;
            if(state.equals("SUCCESS")){successes++;String name=RoomCatalog.NAMES.stream().filter(n->RoomCatalog.id(n)==completed.site).findFirst().orElse("");claimed.add(name);new LocalStore(context).completed();index++;next();}
            else if(state.equals("NO_ROOM")){index++;next();}
            else finish(state,"예약 "+(index+1)+"/"+tasks.size()+" 중단 · 완료 "+successes+"건 · "+message+" · 나머지는 자동 제출하지 않습니다.");
        }
    });child.start();}catch(Exception e){finish("FAILED","다인·다중 세션 초기화 실패 · 자동 재제출 없음");}}
    void record(String state){try{results.put(new JSONObject().put("index",index).put("state",state));new LocalStore(context).saveDocument("batch-results",new JSONObject().put("results",results));}catch(Exception e){finish("CHECK_REQUIRED","결과 기록 실패 · 내역을 먼저 확인하세요.");}}
    void cancel(){if(ended)return;ended=true;main.removeCallbacksAndMessages(null);if(child!=null)child.cancel();events.finished(new LocalStore(context).uncertain()?"CHECK_REQUIRED":"STOPPED","다인·다중 작업을 중지했습니다. 완료한 실제 예약은 취소하지 않습니다.");}
    void finish(String state,String message){if(ended)return;ended=true;main.removeCallbacksAndMessages(null);events.finished(state,message);}
}

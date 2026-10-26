package kr.swim.phone;
import android.content.*;
import org.json.*;
import java.util.*;

/** Five independent schedules. Slot zero retains legacy runs and read-only inspection. */
final class PhoneRuns {
    static final int LIMIT=5;
    static boolean anyActive(Context c){for(int n=0;n<=LIMIT;n++)if(new LocalStore(c,n).active())return true;return false;}
    static boolean executing(Context c){for(int n=0;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);if(s.active()&&!s.stage().equals("WAITING")&&!s.stage().equals("WATCHING"))return true;}return false;}
    static boolean activePlan(Context c,String id)throws Exception{if(id.isEmpty())return false;for(int n=0;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);if(s.active()&&id.equals(s.runPlanId()))return true;}return false;}
    static boolean anyUncertain(Context c){for(int n=0;n<=LIMIT;n++)if(new LocalStore(c,n).uncertain())return true;return false;}
    static void acknowledge(Context c){for(int n=0;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);if(!s.active()){s.acknowledgeReceiptCheck();if(s.stage().equals("CHECK_REQUIRED"))s.state("STOPPED","공식 내역 확인 완료 · 필요하면 직접 다시 시작하세요.",false);}}}
    static int count(Context c)throws Exception{int count=0;for(int n=0;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);JSONObject run=s.loadDocument("run");if(s.active()&&(run==null||!run.optBoolean("_lookup")))count++;}return count;}
    static boolean legacyUnbound(Context c)throws Exception{LocalStore s=new LocalStore(c,0);JSONObject run=s.loadDocument("run");return s.active()&&run!=null&&!run.optBoolean("_lookup")&&run.optString("_planId").isEmpty();}
    static int allocate(Context c,boolean lookup,String id)throws Exception{
        if(!lookup&&legacyUnbound(c))throw new IllegalStateException("이전 버전 실행을 연결할 수 없습니다. 전체 중지 후 다시 시작하세요.");
        if(!id.isEmpty()){JSONObject history=new LocalStore(c,0).loadDocument("run-history");if(history!=null&&history.has(id))requireRestartable(history.getJSONObject(id));for(int n=0;n<=LIMIT;n++){JSONObject row=record(c,n);if(id.equals(row.optString("planId")))requireRestartable(row);}}
        if(activePlan(c,id))throw new IllegalStateException("이미 진행 중인 일정입니다.");
        if(lookup){if(new LocalStore(c,0).active()||!PhoneSessions.supported()&&anyActive(c))throw new IllegalStateException("진행 중인 조회가 끝난 뒤 다시 시도하세요.");return 0;}
        if(count(c)>=LIMIT)throw new IllegalStateException("동시 진행 일정은 최대 5개입니다.");
        if(!PhoneSessions.supported()){
            if(anyActive(c))throw new IllegalStateException("현재 Android System WebView는 세션 분리를 지원하지 않습니다. WebView를 업데이트한 뒤 여러 일정을 시작하세요.");
            if(new LocalStore(c,0).uncertain())throw new IllegalStateException("이전 제출 결과를 공식 내역에서 먼저 확인하세요.");return 0;
        }
        for(int n=1;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);if(!s.active()&&!s.uncertain())return n;}
        throw new IllegalStateException("사용 가능한 예약 세션이 없습니다. 미확인 제출 내역을 확인하세요.");
    }
    static void requireRestartable(JSONObject row){if(row.optString("stage").equals("CHECK_REQUIRED")||row.optBoolean("uncertain")||java.util.Set.of("SUCCESS","PARTIAL").contains(row.optString("stage")))throw new IllegalStateException("완료 또는 제출 결과 확인이 필요한 일정입니다. 공식 내역을 확인한 뒤 필요한 항목만 새 일정으로 등록하세요.");}
    static void guardUncertain(Context c,Plan plan)throws Exception{
        for(int n=0;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);if(!s.uncertain())continue;Plan old=s.load("run");
            java.time.LocalDate a=java.time.LocalDate.parse(plan.date),b=java.time.LocalDate.parse(old.date);
            if(!a.isBefore(b.plusDays(old.nights))||!b.isBefore(a.plusDays(plan.nights)))continue;
            Set<String> phones=targets(plan,false),rooms=targets(plan,true);phones.retainAll(targets(old,false));rooms.retainAll(targets(old,true));
            if(!phones.isEmpty()&&!rooms.isEmpty())throw new IllegalStateException("겹치는 예약의 이전 제출 결과가 미확인입니다. 공식 내역을 먼저 확인하세요.");
        }
    }
    private static Set<String> targets(Plan p,boolean rooms)throws Exception{
        Set<String> values=new HashSet<>();if(rooms)values.addAll(p.priorities());else if(!p.phone.isEmpty())values.add(p.phone);
        for(int i=0;i<p.people.length();i++){JSONObject person=p.people.getJSONObject(i);if(rooms)for(String room:person.optString("rooms").split("[,\\n]")){if(!room.trim().isEmpty())values.add(room.trim());}else if(!person.optString("phone").isEmpty())values.add(person.optString("phone"));}return values;
    }
    static JSONObject record(Context c,int slot)throws Exception{
        LocalStore s=new LocalStore(c,slot);JSONObject run=s.loadDocument("run");
        return new JSONObject().put("slot",slot).put("planId",run==null?"":run.optString("_planId")).put("trigger",run==null?0:run.optLong("trigger")).put("lookup",run!=null&&run.optBoolean("_lookup")).put("stage",s.stage()).put("message",s.message()).put("active",s.active()).put("uncertain",s.uncertain()).put("updated",s.heartbeat());
    }
    static synchronized void archive(Context c,int slot)throws Exception{
        JSONObject previous=record(c,slot);String id=previous.optString("planId");if(id.isEmpty())return;
        LocalStore global=new LocalStore(c,0);JSONObject history=global.loadDocument("run-history");if(history==null)history=new JSONObject();history.put(id,previous);
        while(history.length()>20){String oldest=null;long time=Long.MAX_VALUE;for(Iterator<String> keys=history.keys();keys.hasNext();){String key=keys.next();long updated=history.getJSONObject(key).optLong("updated");if(updated<time){time=updated;oldest=key;}}if(oldest==null)break;history.remove(oldest);}
        global.saveDocument("run-history",history);
    }
    static synchronized JSONObject snapshot(Context c)throws Exception{
        JSONObject history=new LocalStore(c,0).loadDocument("run-history");if(history==null)history=new JSONObject();
        JSONObject main=record(c,0);StringBuilder logs=new StringBuilder();
        for(int n=0;n<=LIMIT;n++){
            LocalStore s=new LocalStore(c,n);JSONObject row=record(c,n);String id=row.optString("planId");
            if(!id.isEmpty()&&(!history.has(id)||history.getJSONObject(id).optLong("updated")<=row.optLong("updated")))history.put(id,row);
            if(row.optBoolean("active")&&(!main.optBoolean("active")||priority(row)>priority(main))||!main.optBoolean("active")&&row.optLong("updated")>main.optLong("updated"))main=row;
            if(!s.log().isEmpty())logs.append("[세션 ").append(n).append("]\n").append(s.log());
        }
        JSONArray records=new JSONArray();for(Iterator<String> keys=history.keys();keys.hasNext();)records.put(history.get(keys.next()));
        return new JSONObject(main.toString()).put("runPlanId",main.optString("planId")).put("runTrigger",main.optLong("trigger")).put("runLookup",main.optBoolean("lookup")).put("active",anyActive(c)).put("activeCount",count(c)).put("capacity",PhoneSessions.supported()?LIMIT:1).put("multiProfile",PhoneSessions.supported()).put("executing",executing(c)).put("inspectBusy",new LocalStore(c,0).active()).put("uncertain",anyUncertain(c)).put("runs",records).put("legacyUnbound",legacyUnbound(c)).put("log",logs.toString());
    }
    private static int priority(JSONObject r){if(r.optBoolean("lookup"))return 0;return r.optString("stage").equals("SUBMITTING")?3:r.optString("stage").equals("WAITING")||r.optString("stage").equals("WATCHING")?1:2;}
    static void reschedule(Context c)throws Exception{for(int n=0;n<=LIMIT;n++){LocalStore s=new LocalStore(c,n);if(s.active()&&s.stage().equals("WAITING"))AlarmReceiver.schedule(c,s.load("run").trigger,n);}}
    static void reconcile(Context c){for(int n=0;n<=LIMIT;n++){ResultStatus.repairLegacyResult(c,n);LocalStore s=new LocalStore(c,n);if(s.active()&&!s.stage().equals("WAITING")&&!ReservationService.alive(n)&&System.currentTimeMillis()-s.heartbeat()>10000)s.state(s.uncertain()?"CHECK_REQUIRED":"STOPPED","실행 서비스 종료 확인 · 자동 재제출 없이 중지",false);}}
}

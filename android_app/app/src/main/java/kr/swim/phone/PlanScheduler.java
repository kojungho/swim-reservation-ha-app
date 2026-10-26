package kr.swim.phone;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;

/** Future plans are durable alarms, not continuously running services. */
final class PlanScheduler {
    static synchronized void start(Context c,Plan plan,boolean lookup)throws Exception {
        start(c,plan,lookup,"");
    }
    static synchronized void start(Context c,Plan plan,boolean lookup,String planId)throws Exception {
        new PhoneRepository(c).bindLegacyRun();
        if(!lookup&&!plan.demo())PhoneRuns.guardUncertain(c,plan);
        int slot=PhoneRuns.allocate(c,lookup,planId);LocalStore store=new LocalStore(c,slot);
        if(!PhoneSessions.supported())CampLookup.cancel();

        if(!lookup&&!plan.demo())AppUpdates.requireSupported(c);
        plan.validate(lookup);ReservationService.channel(c);
        requireReady(c,plan,lookup);
        if(lookup)store.availability(plan,java.util.Set.of(),false,true);
        if(!lookup&&!plan.demo()&&store.uncertain())throw new IllegalStateException("이전 최종 제출 결과를 공식 예약 내역에서 먼저 확인해 주세요.");
        if(!planId.isEmpty()&&!new PhoneRepository(c).registeredPlan(planId).json().toString().equals(plan.json().toString()))throw new IllegalStateException("일정이 변경됐습니다. 다시 시작해 주세요.");
        PhoneRuns.archive(c,slot);
        store.saveDocument("run",plan.json().put("_planId",planId).put("_lookup",lookup));store.watchDueElapsed(0);
        c.getSystemService(NotificationManager.class).cancel(20+slot); // Clear the previous result, not an execution notification.
        try {
            if(!lookup&&plan.trigger>SiteClock.now(c)){
                store.state("WAITING","실행 예정 "+RunNotice.time(plan.trigger)+" (한국 시간) · 예약 대기",true);
                AlarmReceiver.schedule(c,plan.trigger,slot);
            }else {
                store.state("STARTING","폰 내부 예약 엔진 시작 준비",true);
                c.startForegroundService(new Intent(c,ReservationService.class).setAction("RUN").putExtra("lookup",lookup).putExtra("slot",slot));
            }
        }catch(Exception e){AlarmReceiver.cancel(c,slot);store.state("FAILED","예약 등록·실행 실패. 권한을 확인해 주세요.",false);throw e;}
    }
    static void requireReady(Context c,Plan plan,boolean lookup){
        NotificationManager n=c.getSystemService(NotificationManager.class);
        if(!n.areNotificationsEnabled()||n.getNotificationChannel(ReservationService.CHANNEL).getImportance()==NotificationManager.IMPORTANCE_NONE
            ||Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            throw new IllegalStateException("실행 알림을 먼저 허용하세요. 시각 대기 중에는 알림을 표시하지 않습니다.");
        if(!lookup&&(plan.watch()||plan.trigger>0)&&!AlarmReceiver.permitted(c))throw new IllegalStateException("예약·10분 이상 감시 알람 권한을 먼저 허용하세요.");
        if(!lookup&&!plan.demo()&&(plan.watch()||plan.trigger>0)&&!c.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(c.getPackageName()))
            throw new IllegalStateException("잠금 중 실행을 위해 배터리 제한 예외를 먼저 허용하세요.");
    }
    static synchronized void stop(Context c){for(int n=0;n<=PhoneRuns.LIMIT;n++)stopSlot(c,n);}
    static synchronized void stopPlan(Context c,String id)throws Exception{
        for(int n=0;n<=PhoneRuns.LIMIT;n++){LocalStore s=new LocalStore(c,n);if(s.active()&&id.equals(s.runPlanId())){stopSlot(c,n);return;}}
        throw new IllegalStateException("이 일정은 진행 중이 아닙니다.");
    }
    static synchronized void stopSlot(Context c,int slot){
        LocalStore s=new LocalStore(c,slot);if(!s.active())return;AlarmReceiver.cancel(c,slot);
        if(ReservationService.alive(slot))c.startService(new Intent(c,ReservationService.class).setAction("STOP").putExtra("slot",slot));
        else {s.watchDueElapsed(0);s.state(s.uncertain()?"CHECK_REQUIRED":"STOPPED","사용자가 대기 일정을 중지했습니다.",false);}
    }
}

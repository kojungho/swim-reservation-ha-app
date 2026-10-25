package kr.swim.phone;
import android.app.*;
import android.content.*;
import android.os.Build;
import android.os.SystemClock;

public final class AlarmReceiver extends BroadcastReceiver {
    static PendingIntent pending(Context c){return PendingIntent.getBroadcast(c,100,new Intent(c,AlarmReceiver.class).setAction("TICK"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);}
    static boolean permitted(Context c){return Build.VERSION.SDK_INT<31||c.getSystemService(AlarmManager.class).canScheduleExactAlarms();}
    static void schedule(Context c,long when){
        if(!permitted(c))throw new IllegalStateException("정확한 알람 권한이 필요합니다.");
        c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,when,pending(c));
    }
    static void cancel(Context c){c.getSystemService(AlarmManager.class).cancel(pending(c));}
    static void scheduleWatch(Context c,long dueElapsed){
        if(!permitted(c))throw new IllegalStateException("정확한 알람 권한이 필요합니다.");
        c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,dueElapsed,pending(c));
    }
    @Override public void onReceive(Context c,Intent intent){
        if(intent==null||!"TICK".equals(intent.getAction()))return;
        LocalStore s=new LocalStore(c);if(!s.active()||!s.stage().equals("WAITING")&&!s.stage().equals("WATCHING"))return;
        try {
            Plan p=s.load("run");
            if(s.stage().equals("WAITING")&&System.currentTimeMillis()<p.trigger){schedule(c,p.trigger);return;}
            if(s.stage().equals("WATCHING")){
                if(!p.watch()||s.watchDueElapsed()<=0)return;
                if(SystemClock.elapsedRealtime()<s.watchDueElapsed()){scheduleWatch(c,s.watchDueElapsed());return;}
            }
            c.startForegroundService(new Intent(c,ReservationService.class).setAction("WAKE"));
        }
        catch(Exception e){s.state("FAILED","알람은 도착했지만 실행 서비스 시작이 제한됐습니다. 앱을 열어 확인하세요.",false);}
    }
}

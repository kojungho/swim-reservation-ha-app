package kr.swim.phone;
import android.content.*;
/** Restore each future alarm independently; never replay interrupted submissions. */
public final class RecoveryReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        if(intent==null||!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())&&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))return;
        try{new PhoneRepository(c).bindLegacyRun();}catch(Exception ignored){/* Keep the run intact; ambiguous legacy runs block new starts. */}
        ReservationService.channel(c);
        for(int slot=0;slot<=PhoneRuns.LIMIT;slot++){
            ResultStatus.repairLegacyResult(c,slot);
            LocalStore s=new LocalStore(c,slot);try{org.json.JSONObject saved=s.loadDocument("run");if(saved!=null&&saved.optBoolean("_lookup")){if(s.active())s.state("STOPPED","객실 조회 중지",false);c.getSystemService(android.app.NotificationManager.class).cancel(10+slot);c.getSystemService(android.app.NotificationManager.class).cancel(20+slot);continue;}}catch(Exception ignored){}if(!s.active())continue;
            try{Plan p=s.load("run");if(s.stage().equals("WAITING")&&p.trigger>SiteClock.now(c)&&AlarmReceiver.permitted(c)){AlarmReceiver.schedule(c,p.trigger,slot);ClockSyncReceiver.arm(c,p.trigger,slot);s.state("WAITING","미래 예약 알람 복원 · "+RunNotice.time(p.trigger)+" (한국 시간)",true);}else s.state(s.uncertain()?"CHECK_REQUIRED":"STOPPED","재부팅·앱 교체 후 안전 중지 · 예약 내역을 먼저 확인하세요.",false);}
            catch(Exception e){s.state("FAILED","저장 일정 복원 실패 · 앱에서 확인하세요.",false);}
            android.app.NotificationManager notifications=c.getSystemService(android.app.NotificationManager.class);
            notifications.cancel(10+slot);
            notifications.notify((s.active()?10:20)+slot,ReservationService.notice(c,s.message(),s.active(),slot));
        }
    }
}

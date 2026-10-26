package kr.swim.phone;
import android.content.*;
/** Restore each future alarm independently; never replay interrupted submissions. */
public final class RecoveryReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        if(intent==null||!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())&&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))return;
        for(int slot=0;slot<=PhoneRuns.LIMIT;slot++){
            LocalStore s=new LocalStore(c,slot);if(!s.active())continue;
            try{Plan p=s.load("run");if(s.stage().equals("WAITING")&&p.trigger>SiteClock.now(c)&&AlarmReceiver.permitted(c)){AlarmReceiver.schedule(c,p.trigger,slot);s.state("WAITING","미래 예약 알람 복원 · "+RunNotice.time(p.trigger)+" (한국 시간)",true);}else s.state(s.uncertain()?"CHECK_REQUIRED":"STOPPED","재부팅·앱 교체 후 안전 중지 · 예약 내역을 먼저 확인하세요.",false);}
            catch(Exception e){s.state("FAILED","저장 일정 복원 실패 · 앱에서 확인하세요.",false);}
        }
    }
}

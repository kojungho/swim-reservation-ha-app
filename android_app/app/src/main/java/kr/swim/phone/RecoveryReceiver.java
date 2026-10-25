package kr.swim.phone;
import android.content.*;

/** Re-register future alarms only. Never silently re-submit a booking across reboot/update. */
public final class RecoveryReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        if(intent==null||!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())&&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))return;
        LocalStore s=new LocalStore(c);if(!s.active())return;
        try {
            Plan p=s.load("run");
            if(s.stage().equals("WAITING")&&p.trigger>System.currentTimeMillis()&&AlarmReceiver.permitted(c)){
                AlarmReceiver.schedule(c,p.trigger);s.state("WAITING","재부팅 후 미래 예약 알람을 복원했습니다. 앱에서 실행 권한을 확인하세요.",true);
            }else s.state(s.uncertain()?"CHECK_REQUIRED":"STOPPED","재부팅·앱 교체 후 안전 중지. 예약 내역을 확인한 뒤 직접 다시 시작하세요.",false);
        }catch(Exception e){s.state("FAILED","저장 일정 복원 실패 · 앱에서 확인하세요.",false);}
    }
}

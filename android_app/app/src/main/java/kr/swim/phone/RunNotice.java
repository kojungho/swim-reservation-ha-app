package kr.swim.phone;

import java.time.Instant;
import java.time.format.DateTimeFormatter;

/** Uses the same trigger and corrected clock as PlanScheduler. */
final class RunNotice {
    static String time(long epoch){return DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(Plan.SEOUL).format(Instant.ofEpochMilli(epoch));}
    static String message(Plan plan,long now){
        String when=plan.trigger>now?"실행 예정: "+time(plan.trigger)+" (한국 시간)":"실행 예정: 시작 확인 후 바로 실행 (한국 시간 "+time(now)+" 기준)";
        String scope=plan.mode.equals("profiles-parallel")?"예약자 "+plan.people.length()+"명 · 사람별 우선순위 중 하나씩":plan.mode.equals("multiple")?"선택 사이트 모두 예약 · "+plan.rooms:plan.rooms;
        String behavior=plan.watch()?"취소 대기 시작 후 "+plan.pollSeconds/60+"분 이상 간격으로 조회하며 빈자리 발견 시 예약합니다. 감시 종료: "+time(plan.deadline())+" (한국 시간).":"위 시각은 객실 조회부터 예약 엔진을 시작하는 시각입니다. 입력·필수 동의 후 제출하므로 최종 제출 시각과 다릅니다.";
        return "입실: "+plan.date+" / "+plan.nights+"박\n"+scope+"\n\n"+when+"\n"+behavior
            +(plan.batch()?"\n사람·사이트별 순차 실행이며 일부 완료 후 오류가 나면 남은 제출을 멈춥니다.":"")
            +"\n\n배터리 안내: 미래 시각 대기는 알람만 등록합니다. 실제 실행 중 네트워크·CPU 사용과 취소 대기의 반복 조회로 배터리 소모가 커질 수 있습니다."
            +"\n\n실행되지 않을 수 있는 경우: 전원 꺼짐·방전·앱 강제 중지, 배터리 절약·제조사 백그라운드 제한, 알림·정확한 알람·배터리 예외 권한 해제, 인터넷 연결 끊김이나 예약 사이트 오류. 시각 예약이 10초 넘게 늦게 시작하면 자동 제출하지 않습니다. 정시 실행과 예약 성공을 보장하지 않습니다."
            +"\n\n무통장입금 예약 신청이며 입금은 직접 해야 합니다. 같은 예약을 HA와 동시에 실행하지 마세요. 폰 실제 예약 성공은 아직 검증하지 않았습니다.";
    }
}

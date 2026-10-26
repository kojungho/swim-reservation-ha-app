package kr.swim.phone;

import org.junit.Test;
import static org.junit.Assert.*;
import java.time.Instant;

public final class RunNoticeTest {
    private static final long NOW=Instant.parse("2026-10-26T01:00:00Z").toEpochMilli();
    private Plan plan(){Plan p=new Plan();p.date="2027-01-22";p.rooms="산_하늘존";return p;}
    @Test public void scheduledTimeUsesExactKoreanDateAndSeconds(){
        Plan p=plan();p.trigger=Instant.parse("2026-10-31T15:00:02Z").toEpochMilli();
        String text=RunNotice.message(p,NOW);
        assertTrue(text.contains("실행 예정: 2026-11-01 00:00:02 (한국 시간)"));
        assertTrue(text.contains("최종 제출 시각과 다릅니다"));assertFalse(text.contains("시작 확인 후 바로 실행"));
    }
    @Test public void immediateAndElapsedTriggerAreDescribedAsImmediate(){
        Plan p=plan();assertTrue(RunNotice.message(p,NOW).contains("시작 확인 후 바로 실행 (한국 시간 2026-10-26 10:00:00 기준)"));
        p.trigger=NOW;assertTrue(RunNotice.message(p,NOW).contains("시작 확인 후 바로 실행"));
    }
    @Test public void watchShowsActualIntervalAndDeadline(){
        Plan p=plan();p.mode="watch";p.pollSeconds=1200;p.watchUntil=Instant.parse("2027-01-21T09:30:00Z").toEpochMilli();
        String text=RunNotice.message(p,NOW);assertTrue(text.contains("20분 이상 간격"));assertTrue(text.contains("감시 종료: 2027-01-21 18:30:00 (한국 시간)"));
        p.watchUntil=0;assertTrue(RunNotice.message(p,NOW).contains("감시 종료: 2027-01-22 00:00:00"));
    }
    @Test public void batteryAndFailureConditionsRemainInEveryMode(){
        for(String mode:new String[]{"reserve","watch","multiple","profiles-parallel"}){
            Plan p=plan();p.mode=mode;String text=RunNotice.message(p,NOW);
            for(String condition:new String[]{"배터리 사용","강제 중지","전원 꺼짐","정확한 알람","인터넷 연결","10초"})assertTrue(mode+": "+condition,text.contains(condition));
            assertFalse(text.contains("무통장입금"));assertFalse(text.contains("HA와 동시에"));
        }
    }
    @Test public void batteryNoticeSeparatesBriefSyncFromActualExecution(){
        Plan p=plan();p.trigger=NOW+2*3600000L;String text=RunNotice.batteryNotice(p,NOW);
        assertTrue(text.contains("2026-10-26 12:00:00 (한국 시간)부터"));assertTrue(text.contains("실행 1시간 전 (2026-10-26 11:00:00, 한국 시간)"));assertTrue(text.contains("브라우저를 계속 실행하지 않고 알람으로 대기"));
        p.trigger=NOW+1800000L;assertTrue(RunNotice.batteryNotice(p,NOW).contains("대기 등록 직후"));
        p.trigger=0;p.mode="watch";text=RunNotice.batteryNotice(p,NOW);assertTrue(text.contains("시작을 누른 직후부터"));assertTrue(text.contains("조회 사이에는 CPU 절전"));assertFalse(text.contains("실행 1시간 전"));
    }
}

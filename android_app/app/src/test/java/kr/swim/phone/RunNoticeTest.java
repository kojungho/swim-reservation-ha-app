package kr.swim.phone;
import org.junit.Test;import static org.junit.Assert.*;import java.util.*;
public final class RunNoticeTest {
 private Plan plan(){Plan p=new Plan();p.date="2026-12-31";p.nights=2;p.rooms="산_하늘존";return p;}
 @Test public void summaryShowsStayAccountAndExactDepositNoticeWithoutExecutionBoilerplate(){
  for(String mode:new String[]{"reserve","watch","multiple"}){Plan p=plan();p.mode=mode;String text=RunNotice.message(p,0,Map.of("산_하늘존",130000L));
   assertTrue(text.contains("입실일 2026-12-31 / 퇴실일 2027-01-02 / 2박"));assertTrue(text.contains("산 / 130,000원"));assertTrue(text.contains("총 숙박비: 130,000원"));
   assertTrue(text.contains("농협 317-0028-3427-31"));assertTrue(text.contains("(주)쉼오지캠프"));assertTrue(text.endsWith("예약 후 24시간 이내 입금하지 않을 시 자동으로 예약이 취소됩니다."));
   assertFalse(text.contains("실행 예정"));assertFalse(text.contains("최종 제출 시각"));assertFalse(text.contains("강제 중지"));}
 }
 @Test public void candidatesAreNotSummedAsMultipleBookingsAndUnknownIsNeverZero(){
  Plan p=plan();p.rooms="산_하늘존, 샘_산맥존";String text=RunNotice.message(p,0,Map.of("산_하늘존",130000L,"샘_산맥존",140000L));assertTrue(text.contains("우선순위 중 실제 예약되는 사이트의 금액"));assertFalse(text.contains("270,000원"));
  p.mode="multiple";assertTrue(RunNotice.message(p,0,Map.of("산_하늘존",130000L,"샘_산맥존",140000L)).contains("총 숙박비: 270,000원"));assertTrue(RunNotice.message(p,0).contains("총 숙박비: 공식 금액 미확인"));
 }
 @Test public void batteryNoticeRemainsAvailableOutsideTheConfirmationSummary(){Plan p=plan();p.trigger=7200000L;assertTrue(RunNotice.batteryNotice(p,0).contains("배터리 사용"));}
 @Test public void dailyBreakdownAndTotalAppearTogether(){Plan p=plan();String text=RunNotice.detailedMessage(p,0,Map.of("산_하늘존",new BookingQuote.Detail(130000L,List.of(new BookingQuote.Night("2026-12-31","평일",60000),new BookingQuote.Night("2027-01-01","성수기",70000)))));assertTrue(text.contains("2026-12-31 · 평일 60,000원"));assertTrue(text.contains("2027-01-01 · 성수기 70,000원"));assertTrue(text.contains("총 숙박비: 130,000원"));}
}

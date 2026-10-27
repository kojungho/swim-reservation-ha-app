package kr.swim.phone;
import org.junit.Test;import static org.junit.Assert.*;
public class BookingQuoteTest {
 private String html="<form class='side-summary js-quote' data-site='9' data-ci='2026-12-22' data-co='2026-12-24'><input name='ad' value='2'><div class='sum-row total'><span>총 금액</span><span>130,000원</span></div></form>";
 @Test public void totalRequiresSameSiteStayAndAdults(){Plan p=new Plan();p.date="2026-12-22";p.nights=2;assertEquals(Long.valueOf(130000),BookingQuote.parse(html,p,9));assertNull(BookingQuote.parse(html,p,8));p.nights=1;assertNull(BookingQuote.parse(html,p,9));p.nights=2;p.adults=1;assertNull(BookingQuote.parse(html,p,9));}
 @Test public void duplicateOrMissingTotalsNeverBecomeAQuote(){Plan p=new Plan();p.date="2026-12-22";p.nights=2;assertNull(BookingQuote.parse(html+html,p,9));assertNull(BookingQuote.parse(html.replace("130,000원","미확인"),p,9));}
 @Test public void nightlyRatesRequireConsecutiveDatesRecognizedTypesAndMatchingTotal(){
  Plan p=new Plan();p.date="2026-12-22";p.nights=2;
  String daily="<table class='night-table'><tr><td>12.22(화) <span class='t-weekday'>평일</span></td><td>60,000원</td></tr><tr><td>12.23(수) <span class='t-peak'>성수기</span></td><td>70,000원</td></tr></table>",source=html.replace("<div class=",daily+"<div class=");
  BookingQuote.Detail detail=BookingQuote.parseDetail(source,p,9);assertEquals(2,detail.nightlyRates.size());assertEquals("평일",detail.nightlyRates.get(0).type);assertEquals("성수기",detail.nightlyRates.get(1).type);assertEquals(70000,detail.nightlyRates.get(1).amount);
  for(String bad:new String[]{html,source.replace("12.23","12.22"),source.replace("70,000원","60,000원"),source.replace("t-peak","t-weekend")})assertTrue(BookingQuote.parseDetail(bad,p,9).nightlyRates.isEmpty());
  String cross=source.replace("2026-12-22","2026-12-31").replace("2026-12-24","2027-01-02").replace("12.22(화)","12.31(목)").replace("12.23(수)","1.1(금)");p.date="2026-12-31";assertEquals("2027-01-01",BookingQuote.parseDetail(cross,p,9).nightlyRates.get(1).date);
 }
}

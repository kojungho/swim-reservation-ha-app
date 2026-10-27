package kr.swim.phone;
import org.junit.Test;import static org.junit.Assert.*;
public class BookingQuoteTest {
 private String html="<form class='side-summary js-quote' data-site='9' data-ci='2026-12-22' data-co='2026-12-24'><input name='ad' value='2'><div class='sum-row total'><span>총 금액</span><span>130,000원</span></div></form>";
 @Test public void totalRequiresSameSiteStayAndAdults(){Plan p=new Plan();p.date="2026-12-22";p.nights=2;assertEquals(Long.valueOf(130000),BookingQuote.parse(html,p,9));assertNull(BookingQuote.parse(html,p,8));p.nights=1;assertNull(BookingQuote.parse(html,p,9));p.nights=2;p.adults=1;assertNull(BookingQuote.parse(html,p,9));}
 @Test public void duplicateOrMissingTotalsNeverBecomeAQuote(){Plan p=new Plan();p.date="2026-12-22";p.nights=2;assertNull(BookingQuote.parse(html+html,p,9));assertNull(BookingQuote.parse(html.replace("130,000원","미확인"),p,9));}
}

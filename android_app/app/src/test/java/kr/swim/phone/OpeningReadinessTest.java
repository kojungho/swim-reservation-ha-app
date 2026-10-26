package kr.swim.phone;
import org.junit.Test;import static org.junit.Assert.*;
public class OpeningReadinessTest {
 @Test public void knownNoticeAllowsFourIncreasingDelaysAndFiveTotalReads(){long now=1000;long[] delays={1000,1000,2000,3000};for(int reads=1;reads<=4;reads++){assertEquals(delays[reads-1],OpeningReadiness.retryDelay(false,"NOT_OPEN",reads,1000,now));now+=delays[reads-1];}assertEquals(8000,now);assertFalse(OpeningReadiness.retryAllowed(false,"NOT_OPEN",5,1000,now));assertEquals(-1,OpeningReadiness.retryDelay(false,"NOT_OPEN",4,1000,9000));}
 @Test public void neverRetryOutsideOpeningWindowOrAfterSubmission(){assertFalse(OpeningReadiness.retryAllowed(false,"NOT_OPEN",1,1000,999));assertFalse(OpeningReadiness.retryAllowed(false,"NOT_OPEN",1,1000,11001));assertFalse(OpeningReadiness.retryAllowed(false,"NOT_OPEN",1,0,1000));assertFalse(OpeningReadiness.retryAllowed(true,"NOT_OPEN",1,1000,1000));}
 @Test public void errorsAndUnknownLayoutsNeverQualify(){for(String code:new String[]{"HTTP_403","HTTP_429","DOM_ERROR","FORM_UNRECOGNIZED","RECEIPT_MISMATCH","NO_ROOM"})assertFalse(code,OpeningReadiness.retryAllowed(false,code,1,1000,1000));}
}

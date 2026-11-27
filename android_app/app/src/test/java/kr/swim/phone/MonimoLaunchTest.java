package kr.swim.phone;

import android.content.Intent;
import android.net.Uri;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28)
public class MonimoLaunchTest {
    @Test public void routesBothLinkFormsToMonimo() throws Exception {
        for(String scheme:new String[]{"monimopay","monimopayauth"}){
            Uri data=Uri.parse(scheme+"://pay?ref=example");
            for(Uri link:new Uri[]{data,Uri.parse("intent://pay?ref=example#Intent;scheme="+scheme+";package=net.ib.android.smcard;end")}){
                Intent launch=CardAppLaunch.resolve(link);
                assertEquals("net.ib.android.smcard",launch.getPackage());
                assertEquals(data,launch.getData());
            }
        }
    }
    @Test public void rejectsDifferentPackage() throws Exception {
        assertNull(CardAppLaunch.resolve(Uri.parse("intent://pay#Intent;scheme=monimopay;package=example.other;end")));
    }
}

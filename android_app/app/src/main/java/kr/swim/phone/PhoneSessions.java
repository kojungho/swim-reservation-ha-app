package kr.swim.phone;
import android.annotation.SuppressLint;
import android.content.Context;
import android.webkit.*;
import androidx.webkit.*;
/** Each concurrently running schedule owns a WebView profile and cookie jar. */
final class PhoneSessions {
    static Boolean testSupported=null; // Tests only; never read from persisted or UI configuration.
    static boolean supported(){if(testSupported!=null)return testSupported;return WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);}
    @SuppressLint("RequiresFeature")
    static CookieManager attach(WebView web,Context c){
        if(supported()){
            String name="swim-run-"+RunContext.slot(c);
            WebViewCompat.setProfile(web,name);
            return WebViewCompat.getProfile(web).getCookieManager();
        }
        return CookieManager.getInstance();
    }
}

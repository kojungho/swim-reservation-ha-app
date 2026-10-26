package kr.swim.phone;
import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.*;import android.content.Context;import android.net.NetworkCapabilities;import java.util.concurrent.atomic.AtomicInteger;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class DisplayConnectionTest {
 @Test public void listensOnlyWhileScreenActiveAndValidatedNetworkReturns()throws Exception{
  Context c=RuntimeEnvironment.getApplication();AtomicInteger count=new AtomicInteger();DisplayConnection connection=new DisplayConnection(c,count::incrementAndGet);
  connection.start();connection.start();assertTrue(connection.registered);connection.callback.onAvailable(null);assertEquals(1,count.get());
  connection.callback.onCapabilitiesChanged(null,new NetworkCapabilities());assertEquals(1,count.get());
  NetworkCapabilities validated=new NetworkCapabilities();NetworkCapabilities.class.getDeclaredMethod("addCapability",int.class).invoke(validated,NetworkCapabilities.NET_CAPABILITY_VALIDATED);connection.callback.onCapabilitiesChanged(null,validated);assertEquals(2,count.get());
  connection.stop();connection.stop();connection.callback.onAvailable(null);assertEquals(2,count.get());assertFalse(connection.registered);
 }
 @Test public void reconnectDuringReadRetainsSinglePendingWakeupWithoutStartingAnotherRequest(){
  HaDisplay.busy.set(true);HaDisplay.reconnectPending.set(false);
  try{HaDisplay.reconnect(RuntimeEnvironment.getApplication());HaDisplay.reconnect(RuntimeEnvironment.getApplication());assertTrue(HaDisplay.reconnectPending.get());}
  finally{HaDisplay.busy.set(false);HaDisplay.reconnectPending.set(false);}
 }
}

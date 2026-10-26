package kr.swim.phone;
import android.content.Context;
import android.net.*;
/** Activity-only network observer. Reads display configuration; never resumes/submits a booking. */
final class DisplayConnection {
 final ConnectivityManager manager;final Runnable restored;boolean registered;
 final ConnectivityManager.NetworkCallback callback=new ConnectivityManager.NetworkCallback(){
  @Override public void onAvailable(Network network){if(registered)restored.run();}
  @Override public void onCapabilitiesChanged(Network network,NetworkCapabilities capabilities){if(registered&&capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))restored.run();}
 };
 DisplayConnection(Context c,Runnable restored){manager=c.getSystemService(ConnectivityManager.class);this.restored=restored;}
 void start(){if(registered)return;registered=true;try{manager.registerDefaultNetworkCallback(callback);}catch(RuntimeException error){registered=false;}}
 void stop(){if(!registered)return;registered=false;try{manager.unregisterNetworkCallback(callback);}catch(RuntimeException ignored){}}
}

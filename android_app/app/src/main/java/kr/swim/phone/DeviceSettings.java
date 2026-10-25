package kr.swim.phone;

import android.content.*;
import android.net.Uri;
import android.provider.Settings;

final class DeviceSettings {
    // The settings list is different from the one-time allowlist request dialog.
    static Intent batterySettings(){return new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);}
    static Intent batteryRequest(Context c){return new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+c.getPackageName()));}
    static void openBatterySettings(Context c){try{c.startActivity(batterySettings());}catch(ActivityNotFoundException|SecurityException e){c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+c.getPackageName())));}}
}

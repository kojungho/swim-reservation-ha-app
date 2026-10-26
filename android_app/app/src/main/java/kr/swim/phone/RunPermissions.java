package kr.swim.phone;

/** Check each use; no permission decision schedules or starts a reservation. */
final class RunPermissions {
 enum Missing { NOTIFICATIONS, ALARM, BATTERY }
 static Missing missing(boolean notifications,boolean alarm,boolean battery,boolean scheduled){
  if(!notifications)return Missing.NOTIFICATIONS;
  if(scheduled&&!alarm)return Missing.ALARM;
  if(scheduled&&!battery)return Missing.BATTERY;
  return null;
 }
}

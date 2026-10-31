package kr.swim.phone;
import java.time.*;import java.util.*;
/** Matches HA's KST day-before-10am policy. No booking or identity access. */
final class PreflightPolicy {
 static long at(LocalDate day,int hour){return day.atTime(hour,0).atZone(Plan.SEOUL).toInstant().toEpochMilli();}
 static LocalDate day(long now){return Instant.ofEpochMilli(now).atZone(Plan.SEOUL).toLocalDate();}
 static long due(long trigger){return at(day(trigger).minusDays(1),10);}
 static boolean daytime(long now){return now>=at(day(now),8)&&now<at(day(now),19);}
 static long next(long trigger,long now){
  if(trigger-now<=300000)return 0;
  long time=Math.max(due(trigger),now+1000);LocalDate d=day(time);
  if(time<at(d,8))time=at(d,8);else if(time>=at(d,19))time=at(d.plusDays(1),8);
  return time<trigger-300000?time:0;
 }
 static List<String> dates(long now,String excluded){List<String> result=new ArrayList<>();for(int offset:new int[]{1,2,7,14,21,28,35}){LocalDate d=day(now).plusDays(offset);long opens=at(d.withDayOfMonth(1).minusMonths(2),0);if(opens<=now&&!d.toString().substring(0,7).equals(excluded.substring(0,7)))result.add(d.toString());}return result;}
}

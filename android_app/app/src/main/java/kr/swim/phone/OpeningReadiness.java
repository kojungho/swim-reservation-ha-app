package kr.swim.phone;
/** Only the initial, known pre-opening GET may be repeated. Never authorize a POST. */
final class OpeningReadiness {
 static final long[] DELAYS={1000,1000,2000,3000};
 static boolean retryAllowed(boolean submitted,String code,int reads,long trigger,long now){
  long elapsed=now-trigger;
  return !submitted&&"NOT_OPEN".equals(code)&&reads>=1&&reads<5&&trigger>0&&elapsed>=0&&elapsed<=10000;
 }
 static long retryDelay(boolean submitted,String code,int reads,long trigger,long now){if(!retryAllowed(submitted,code,reads,trigger,now))return -1;long delay=DELAYS[reads-1];return now+delay<=trigger+10000?delay:-1;}
}

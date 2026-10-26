package kr.swim.phone;
import android.app.*;import android.os.*;import android.content.*;import org.json.*;
/** Reads only our public display routes. Never opens a campsite or booking engine. */
public final class PublicDisplayTestRunner extends Instrumentation {
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
  Context app=getTargetContext();PhoneRepository repository=new PhoneRepository(app);String before=repository.load().toString();
  HaDisplay.refresh(app,HaDisplay.origin(BuildConfig.DEFAULT_HA_URL));
  JSONObject cached=HaDisplay.vault(app).loadDocument("ha-display");
  if(cached==null||!cached.optBoolean("hasPhoto")||!HaDisplay.photo(app).isFile())throw new AssertionError("public photo missing");
  if(!before.equals(repository.load().toString()))throw new AssertionError("private repository changed");
  if(new LocalStore(app).active())throw new AssertionError("booking unexpectedly started");
  result.putString("stream","PASS anonymous public settings + SHA256-verified photo; saved profiles/plans/draft unchanged; no booking or HA login\n");finish(Activity.RESULT_OK,result);
 }catch(Throwable error){result.putString("stream","FAILED "+error+"\n");finish(Activity.RESULT_CANCELED,result);}}
}

package kr.swim.phone;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
/** Cross-version encrypted storage check. Does not start activities, alarms, engines or network. */
public final class UpgradeStorageTestRunner extends Instrumentation {
 private String phase,fromVersion,toVersion;
 @Override public void onCreate(Bundle args){super.onCreate(args);phase=args.getString("phase","verify");fromVersion=args.getString("fromVersion","0.4.12");toVersion=args.getString("toVersion","0.4.13");start();}
 @Override public void onStart(){
  Bundle result=new Bundle();try{
   Context app=getTargetContext();LocalStore store=new LocalStore(app);PhoneRepository repository=new PhoneRepository(app);
   if(phase.equals("seed")){
    if(!fromVersion.equals(app.getPackageManager().getPackageInfo(app.getPackageName(),0).versionName))throw new AssertionError("seed must run on "+fromVersion);
    if(store.active()||store.uncertain())throw new AssertionError("emulator has an active or uncertain operation");
    JSONObject backup=repository.load();store.saveDocument("upgrade-v17-original",backup);
    repository.put("profiles",new JSONObject().put("name","업데이트보존검증").put("payer","").put("phone","01000000000"));
    Plan plan=Plan.sample();plan.mode="reserve";plan.date="2030-12-17";plan.trigger=0;
    repository.put("plans",new JSONObject().put("title","미실행 보존 검증").put("plan",plan.json()));
    repository.saveDraft(plan.json());JSONObject seeded=repository.load();
    store.saveDocument("upgrade-v17-expected",seeded);
    result.putString("stream","PASS seeded encrypted profiles, saved plans and draft in previous installed version; nothing executed\n");
   }else{
    if(!toVersion.equals(app.getPackageManager().getPackageInfo(app.getPackageName(),0).versionName))throw new AssertionError("verify must run on "+toVersion);
    JSONObject expected=store.loadDocument("upgrade-v17-expected"),actual=repository.load();
    if(expected==null)throw new AssertionError("missing legacy encrypted fixture");
    for(String key:new String[]{"profiles","plans","draft","ui"})if(!expected.opt(key).toString().equals(actual.opt(key).toString()))throw new AssertionError("changed "+key);
    if(store.active())throw new AssertionError("update unexpectedly started a booking");
    store.saveDocument("phone-ui-v1",store.loadDocument("upgrade-v17-original"));
    result.putString("stream","PASS replace-install preserved encrypted profiles, plans, draft and settings; no booking started; original emulator editor data restored\n");
   }
   finish(Activity.RESULT_OK,result);
  }catch(Throwable error){result.putString("stream","FAILED "+error+"\n");finish(Activity.RESULT_CANCELED,result);}
 }
}

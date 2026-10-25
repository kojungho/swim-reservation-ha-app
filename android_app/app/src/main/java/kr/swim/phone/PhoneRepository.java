package kr.swim.phone;

import android.content.Context;
import org.json.*;
import java.util.UUID;

/** Separate encrypted UI vault. Registered plans are snapshots, never live references to profiles. */
final class PhoneRepository {
    private final LocalStore store;
    private final Context storeContext;
    PhoneRepository(Context c){store=new LocalStore(c);storeContext=c;}
    synchronized JSONObject load()throws Exception{
        RoomCatalog.restore(storeContext);
        JSONObject state=store.loadDocument("phone-ui-v1");
        if(state==null)state=new JSONObject().put("draft",store.load("draft").json()).put("profiles",new JSONArray()).put("plans",new JSONArray()).put("ui",new JSONObject());
        return state.put("rooms",new JSONArray(RoomCatalog.NAMES));
    }
    synchronized JSONObject saveDraft(JSONObject draft)throws Exception{Plan p=plan(draft,false);JSONObject state=load(),drafts=state.optJSONObject("drafts");if(drafts==null)drafts=new JSONObject();drafts.put(p.mode,p.json());state.put("draft",p.json()).put("drafts",drafts);store.saveDocument("phone-ui-v1",state);return state;}
    synchronized void completeDraft(Plan run)throws Exception{JSONObject state=load(),drafts=state.optJSONObject("drafts");if(drafts==null)drafts=new JSONObject();JSONObject saved=drafts.optJSONObject(run.mode);if(saved==null)saved=state.optJSONObject("draft");if(saved==null)return;Plan draft=Plan.from(saved);if(!draft.json().toString().equals(run.json().toString()))return;
        Plan blank=new Plan();blank.mode=run.mode;drafts.put(run.mode,blank.json());state.put("drafts",drafts);JSONObject current=state.optJSONObject("draft");if(current!=null&&Plan.from(current).json().toString().equals(run.json().toString()))state.put("draft",blank.json());state.put("draftClearedAt",System.currentTimeMillis()).put("clearedDraft",run.json());store.saveDocument("phone-ui-v1",state);}
    static Plan plan(JSONObject value,boolean validate)throws Exception{
        Plan p=Plan.from(value);p.simulation=false;
        if(!java.util.List.of("reserve","watch","multiple","profiles-parallel").contains(p.mode))throw new IllegalArgumentException("지원하지 않는 예약 방식입니다.");
        if(validate)p.validate(false);return p;
    }
    synchronized JSONObject saveUi(JSONObject ui)throws Exception{if(ui.toString().length()>8000)throw new IllegalArgumentException("설정 크기 초과");JSONObject state=load();state.put("ui",ui);store.saveDocument("phone-ui-v1",state);return state;}
    synchronized JSONObject put(String kind,JSONObject value)throws Exception{
        if(!kind.equals("plans")&&!kind.equals("profiles"))throw new IllegalArgumentException("지원하지 않는 저장 항목");
        JSONObject state=load();JSONArray entries=state.getJSONArray(kind);String id=value.optString("id");JSONObject saved;
        if(kind.equals("plans")){
            Plan p=plan(value.getJSONObject("plan"),true);String title=value.optString("title").trim();
            if(title.length()>80)throw new IllegalArgumentException("일정 이름은 80자 이내입니다.");
            saved=new JSONObject().put("title",title.isEmpty()?p.date+" "+p.nights+"박":title).put("plan",p.json());
        }else {
            String name=value.optString("name").trim(),payer=value.optString("payer").trim(),phone=value.optString("phone").replaceAll("[^0-9]",""),birth=value.optString("birth");
            if(name.isEmpty()||name.length()>50||payer.length()>50||!phone.matches("01[0-9]{8,9}"))throw new IllegalArgumentException("예약자명·휴대폰 번호를 확인해 주세요. 입금자명은 선택입니다.");
            saved=new JSONObject().put("name",name).put("payer",payer).put("phone",phone).put("birth",birth);
        }
        int found=-1;for(int i=0;i<entries.length();i++)if(entries.getJSONObject(i).getString("id").equals(id))found=i;
        if(found<0&&entries.length()>=20)throw new IllegalArgumentException("최대 20개까지 저장합니다.");
        if(found<0)id=UUID.randomUUID().toString();saved.put("id",id);entries.put(found<0?entries.length():found,saved);
        store.saveDocument("phone-ui-v1",state);return state;
    }
    synchronized JSONObject delete(String kind,String id)throws Exception{
        if(!kind.equals("plans")&&!kind.equals("profiles"))throw new IllegalArgumentException("지원하지 않는 삭제 항목");
        JSONObject state=load();JSONArray entries=state.getJSONArray(kind);for(int i=entries.length()-1;i>=0;i--)if(entries.getJSONObject(i).getString("id").equals(id))entries.remove(i);
        store.saveDocument("phone-ui-v1",state);return state;
    }
}

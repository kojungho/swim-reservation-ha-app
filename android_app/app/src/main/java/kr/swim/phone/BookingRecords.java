package kr.swim.phone;
import android.content.Context;import org.json.*;import java.util.UUID;import java.time.LocalDate;
/** Private encrypted submission snapshots; deletion never cancels a reservation. */
final class BookingRecords {
 final LocalStore store;
 BookingRecords(Context context){store=new LocalStore(context,0);}
 JSONArray list()throws Exception{synchronized(BookingRecords.class){JSONObject doc=store.loadDocument("booking-records");return doc==null?new JSONArray():doc.getJSONArray("entries");}}
 void save(JSONArray entries)throws Exception{store.saveDocument("booking-records",new JSONObject().put("entries",entries));}
 String begin(Plan plan,String room,JSONObject entered)throws Exception{synchronized(BookingRecords.class){
  if(!PersonName.valid(entered.optString("name"))||!entered.optString("phone").matches("01[0-9]{8,9}"))throw new IllegalArgumentException("제출 기록의 입력 정보 확인 실패");
  JSONArray fields=entered.getJSONArray("fields");if(fields.length()>16)throw new IllegalArgumentException("제출 필드 크기 초과");
  JSONObject clean=new JSONObject();for(String key:new String[]{"name","phone","depositor","request","arrival"}){String value=entered.optString(key);if(value.length()>4096)throw new IllegalArgumentException("제출 정보 크기 초과");clean.put(key,value);}
  JSONArray safeFields=new JSONArray();for(int i=0;i<fields.length();i++){JSONObject field=fields.getJSONObject(i);if(!java.util.List.of("name","phone","depositor","request","arrive_time").contains(field.getString("role"))||field.getString("name").length()>100||field.getString("value").length()>4096)throw new IllegalArgumentException("제출 필드 확인 실패");safeFields.put(new JSONObject().put("role",field.getString("role")).put("name",field.getString("name")).put("value",field.getString("value")));}clean.put("fields",safeFields);
  JSONArray entries=list();if(entries.length()>=200)throw new IllegalStateException("예약 제출 기록이 200개입니다. 불필요한 기록을 삭제하세요.");String id=UUID.randomUUID().toString();JSONObject stay=new JSONObject().put("checkin",plan.date).put("checkout",LocalDate.parse(plan.date).plusDays(plan.nights).toString()).put("nights",plan.nights).put("site",room).put("adults",plan.adults);
  JSONArray next=new JSONArray().put(new JSONObject().put("id",id).put("state","check_required").put("createdAt",System.currentTimeMillis()).put("entered",clean).put("stay",stay));for(int i=0;i<entries.length();i++)next.put(entries.get(i));save(next);return id;
 }}
 void complete(String id,JSONObject receipt)throws Exception{synchronized(BookingRecords.class){JSONArray entries=list();for(int i=0;i<entries.length();i++){JSONObject entry=entries.getJSONObject(i);if(entry.getString("id").equals(id))entry.put("state","complete").put("completedAt",System.currentTimeMillis()).put("receipt",new JSONObject().put("id",receipt.optString("id")).put("total",receipt.optString("total")).put("status",receipt.optString("status")));}save(entries);}}
 void delete(String id)throws Exception{synchronized(BookingRecords.class){JSONArray entries=list();for(int i=entries.length()-1;i>=0;i--)if(entries.getJSONObject(i).getString("id").equals(id))entries.remove(i);save(entries);}}
}

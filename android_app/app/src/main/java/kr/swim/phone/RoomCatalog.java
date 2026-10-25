package kr.swim.phone;

import java.util.*;
import org.json.*;
import android.content.Context;

/** The add-on's configured campground inventory, not a live availability claim. */
final class RoomCatalog {
    static final List<String> NAMES=new java.util.concurrent.CopyOnWriteArrayList<>(List.of("해_하늘존","달_하늘존","별_하늘존","빛_하늘존","강_하늘존","산_하늘존","들_하늘존","숲_하늘존",
        "샘_산맥존","온_산맥존","숨_산맥존","꿈_산맥존","솔_산맥존","결_산맥존"));
    private static final Map<String,Integer> ids=new LinkedHashMap<>();
    static{for(int i=0;i<NAMES.size();i++)ids.put(NAMES.get(i),i+1);}
    static synchronized int id(String name){return ids.getOrDefault(name,0);}
    static synchronized JSONArray entries(){JSONArray result=new JSONArray();try{for(String name:NAMES)result.put(new JSONObject().put("name",name).put("siteId",id(name)).put("displayName",display(name)));}catch(JSONException e){throw new IllegalStateException(e);}return result;}
    static String display(String name){int i=name.lastIndexOf('_');return i<0?name:name.substring(i+1)+name.substring(0,i);}
    static synchronized void restore(Context context)throws Exception{JSONObject saved=new LocalStore(context).loadDocument("catalog-v1");if(saved!=null)merge(context,saved.getJSONArray("entries"),false);}
    static synchronized void merge(Context context,JSONArray found,boolean persist)throws Exception{
        Map<String,Integer> next=new LinkedHashMap<>(ids);for(int i=0;i<found.length();i++){JSONObject room=found.getJSONObject(i);String name=room.getString("name");int id=room.getInt("siteId");if(name.isBlank()||name.length()>80||id<1||id>10000||!display(name).equals(room.getString("displayName")))throw new IllegalArgumentException("사이트 목록 형식 불일치");if(next.containsKey(name)&&next.get(name)!=id||next.entrySet().stream().anyMatch(e->e.getValue()==id&&!e.getKey().equals(name)))throw new IllegalArgumentException("사이트 번호·이름 충돌 · 자동 추정 중지");next.put(name,id);}
        ids.clear();ids.putAll(next);for(String name:next.keySet())if(!NAMES.contains(name))NAMES.add(name);
        if(persist)new LocalStore(context).saveDocument("catalog-v1",new JSONObject().put("entries",entries()));
    }
    static String label(String name){int split=name.lastIndexOf('_');return split<0?name:name.substring(split+1)+" · "+name.substring(0,split);}
    static List<String> parse(String value){return new ArrayList<>(new LinkedHashSet<>(Arrays.stream(value.split("[,\\n]")).map(String::trim).filter(s->!s.isEmpty()).collect(java.util.stream.Collectors.toList())));}
    static void move(List<String> selected,int index,int offset){int target=index+offset;if(index>=0&&index<selected.size()&&target>=0&&target<selected.size())Collections.swap(selected,index,target);}
}

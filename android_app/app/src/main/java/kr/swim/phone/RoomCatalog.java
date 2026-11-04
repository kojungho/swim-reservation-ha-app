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
    static synchronized void restore(Context context)throws Exception{JSONObject saved=new LocalStore(context,0).loadDocument("catalog-v1");if(saved!=null)merge(context,saved.getJSONArray("entries"),false,true);}
    static synchronized void merge(Context context,JSONArray found,boolean persist)throws Exception{
        merge(context,found,persist,false);
    }
    static synchronized void merge(Context context,JSONArray found,boolean persist,boolean snapshot)throws Exception{
        Map<String,Integer> fresh=new LinkedHashMap<>();Set<Integer> seen=new HashSet<>();for(int i=0;i<found.length();i++){JSONObject room=found.getJSONObject(i);String name=room.getString("name");int id=room.getInt("siteId");if(name.isBlank()||name.length()>80||id<1||id>10000||!display(name).equals(room.getString("displayName"))||fresh.containsKey(name)||!seen.add(id))throw new IllegalArgumentException("사이트 목록 형식·중복 불일치");fresh.put(name,id);}
        Map<String,Integer> next=snapshot?new LinkedHashMap<>():new LinkedHashMap<>(ids);next.entrySet().removeIf(e->seen.contains(e.getValue())&&!fresh.containsKey(e.getKey()));next.putAll(fresh);
        ids.clear();ids.putAll(next);NAMES.clear();NAMES.addAll(next.keySet());
        if(persist)new LocalStore(context,0).saveDocument("catalog-v1",new JSONObject().put("entries",entries()));
    }
    static String label(String name){int split=name.lastIndexOf('_');return split<0?name:name.substring(split+1)+" · "+name.substring(0,split);}
    static List<String> parse(String value){return new ArrayList<>(new LinkedHashSet<>(Arrays.stream(value.split("[,\\n]")).map(String::trim).filter(s->!s.isEmpty()).collect(java.util.stream.Collectors.toList())));}
    static void move(List<String> selected,int index,int offset){int target=index+offset;if(index>=0&&index<selected.size()&&target>=0&&target<selected.size())Collections.swap(selected,index,target);}
}

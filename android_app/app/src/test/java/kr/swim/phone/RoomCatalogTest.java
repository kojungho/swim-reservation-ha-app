package kr.swim.phone;
import android.content.Context;import javax.crypto.spec.SecretKeySpec;import org.json.*;import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.Config;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class RoomCatalogTest {
 @Test public void freshNamesResolveReusedNumbersAndPersistWithoutChangingPreference()throws Exception{
  Context context=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");
  JSONArray original=RoomCatalog.entries();
  try{
   String selected="해_하늘존";
   JSONArray found=new JSONArray().put(room(selected,11)).put(room("숨_산맥존",1)).put(room("새사이트_산맥존",15));
   RoomCatalog.merge(context,found,true);
   assertEquals(11,RoomCatalog.id(selected));assertEquals(1,RoomCatalog.id("숨_산맥존"));assertEquals(15,RoomCatalog.id("새사이트_산맥존"));
   RoomCatalog.merge(context,original,false);assertEquals(1,RoomCatalog.id(selected));RoomCatalog.restore(context);assertEquals(11,RoomCatalog.id(selected));
   String before=RoomCatalog.entries().toString();
   try{RoomCatalog.merge(context,new JSONArray().put(room("다른곳_산맥존",16)).put(room("중복_산맥존",16)),true);fail("duplicate accepted");}catch(IllegalArgumentException expected){}
   assertEquals(before,RoomCatalog.entries().toString());
  }finally{RoomCatalog.merge(context,original,false,true);LocalStore.testKey=null;}
 }
 static JSONObject room(String name,int id)throws Exception{return new JSONObject().put("name",name).put("siteId",id).put("displayName",RoomCatalog.display(name));}
}

package kr.swim.phone;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.*;
import okhttp3.*;

/** Read-only public detail GET. No guest data, cookies, redirects, retries or booking form submission. */
final class BookingQuote {
 static final class Night {final String date,type;final long amount;Night(String date,String type,long amount){this.date=date;this.type=type;this.amount=amount;}}
 static final class Detail {final Long total;final List<Night> nightlyRates;Detail(Long total,List<Night> nightlyRates){this.total=total;this.nightlyRates=List.copyOf(nightlyRates);}}
 static final OkHttpClient client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).connectTimeout(3,TimeUnit.SECONDS).readTimeout(4,TimeUnit.SECONDS).callTimeout(4,TimeUnit.SECONDS).build();
 static String attr(String tag,String name){Matcher m=Pattern.compile("\\b"+name+"=[\"']([^\"']*)[\"']",Pattern.CASE_INSENSITIVE).matcher(tag);return m.find()?m.group(1):"";}
 static Long parse(String html,Plan plan,int id){
  Matcher form=Pattern.compile("<form\\b([^>]*)>([\\s\\S]*?)</form>",Pattern.CASE_INSENSITIVE).matcher(html);String body=null;
  while(form.find())if(Pattern.compile("\\bjs-quote\\b").matcher(form.group(1)).find()){
   if(body!=null||!attr(form.group(1),"data-ci").equals(plan.date)||!attr(form.group(1),"data-co").equals(LocalDate.parse(plan.date).plusDays(plan.nights).toString())||!attr(form.group(1),"data-site").equals(String.valueOf(id)))return null;
   body=form.group(2);
  }
  if(body==null)return null;
  Matcher input=Pattern.compile("<input\\b[^>]*>",Pattern.CASE_INSENSITIVE).matcher(body);boolean adult=false;
  while(input.find())if(attr(input.group(),"name").equals("ad")&&attr(input.group(),"value").equals(String.valueOf(plan.adults)))adult=true;
  if(!adult)return null;
  Matcher total=Pattern.compile("<div\\b[^>]*class=[\"']sum-row total[\"'][^>]*>\\s*<span>\\s*총 금액\\s*</span>\\s*<span>\\s*([\\d,]+)원\\s*</span>\\s*</div>",Pattern.CASE_INSENSITIVE).matcher(body);
  if(!total.find())return null;long amount;try{amount=Long.parseLong(total.group(1).replace(",",""));}catch(Exception e){return null;}
  return total.find()||amount<=0||amount>=100000000?null:amount;
 }
 static Detail parseDetail(String html,Plan plan,int id){
  Long total=parse(html,plan,id);Detail unknown=new Detail(total,List.of());if(total==null)return unknown;
  Matcher forms=Pattern.compile("<form\\b([^>]*)>([\\s\\S]*?)</form>",Pattern.CASE_INSENSITIVE).matcher(html);String body="";
  while(forms.find())if(Pattern.compile("\\bjs-quote\\b").matcher(forms.group(1)).find())body=forms.group(2);
  Matcher table=Pattern.compile("<table\\b[^>]*class=[\"']night-table[\"'][^>]*>([\\s\\S]*?)</table>",Pattern.CASE_INSENSITIVE).matcher(body);
  if(!table.find())return unknown;String content=table.group(1);if(table.find())return unknown;
  Matcher rows=Pattern.compile("<tr\\b[^>]*>\\s*<td\\b[^>]*>([\\s\\S]*?)</td>\\s*<td\\b[^>]*>\\s*([\\d,]+)원\\s*</td>\\s*</tr>",Pattern.CASE_INSENSITIVE).matcher(content);
  Map<String,String> types=Map.of("weekday","평일","weekend","주말","peak","성수기");List<Night> nights=new ArrayList<>();long sum=0;
  while(rows.find()){
   Matcher day=Pattern.compile("^(\\d{1,2})\\.(\\d{1,2})\\([일월화수목금토]\\)\\s*<span\\s+class=[\"']t-(weekday|weekend|peak)[\"']>\\s*(평일|주말|성수기)\\s*</span>$").matcher(rows.group(1).trim());
   LocalDate expected=LocalDate.parse(plan.date).plusDays(nights.size());long amount;try{amount=Long.parseLong(rows.group(2).replace(",",""));}catch(Exception e){return unknown;}
   if(!day.matches()||Integer.parseInt(day.group(1))!=expected.getMonthValue()||Integer.parseInt(day.group(2))!=expected.getDayOfMonth()||!types.get(day.group(3)).equals(day.group(4))||amount<=0||amount>=100000000||nights.size()>=plan.nights)return unknown;
   nights.add(new Night(expected.toString(),day.group(4),amount));sum+=amount;
  }
  return nights.size()==plan.nights&&sum==total?new Detail(total,nights):unknown;
 }
 static List<List<String>> groups(Plan plan){
  List<List<String>> groups=new ArrayList<>();
  if(plan.mode.equals("profiles-parallel")){for(int i=0;i<plan.people.length();i++){Plan child=Plan.from(plan.people.optJSONObject(i));groups.add(child.priorities());}}
  else groups.add(plan.priorities());return groups;
 }
 static Map<String,Detail> load(Plan plan,long now){
  Map<String,Detail> quotes=new LinkedHashMap<>();if(plan.demo())return quotes;
  try{
   LocalDate date=LocalDate.parse(plan.date);if(now<date.withDayOfMonth(1).minusMonths(2).atStartOfDay(Plan.SEOUL).toInstant().toEpochMilli())return quotes;
   Set<String> names=new LinkedHashSet<>();for(List<String> group:groups(plan))names.addAll(group);if(names.size()>14)return quotes;
   long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(12);
   for(String name:names){int id=RoomCatalog.id(name);if(id<1||System.nanoTime()>=end)break;
    try(Response response=client.newCall(new Request.Builder().url(SiteLinks.camp(plan,"site.php",id)).get().build()).execute()){
     if(response.code()==403||response.code()==429)break;if(!response.isSuccessful()||response.body()==null)continue;
     if(response.body().contentLength()>1000000)continue;String html=response.body().string();if(html.length()>1000000)continue;
     Detail detail=parseDetail(html,plan,id);if(detail.total!=null)quotes.put(name,detail);
    }catch(Exception e){break;}
   }
  }catch(Exception ignored){}return quotes;
 }
}

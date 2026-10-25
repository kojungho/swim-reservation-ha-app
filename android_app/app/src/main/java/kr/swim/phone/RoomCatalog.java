package kr.swim.phone;

import java.util.*;

/** The add-on's configured campground inventory, not a live availability claim. */
final class RoomCatalog {
    static final List<String> NAMES=List.of("해_하늘존","달_하늘존","별_하늘존","빛_하늘존","강_하늘존","산_하늘존","들_하늘존","숲_하늘존",
        "샘_산맥존","온_산맥존","숨_산맥존","꿈_산맥존","솔_산맥존","결_산맥존");
    static String label(String name){int split=name.lastIndexOf('_');return split<0?name:name.substring(split+1)+" · "+name.substring(0,split);}
    static List<String> parse(String value){return new ArrayList<>(new LinkedHashSet<>(Arrays.stream(value.split("[,\\n]")).map(String::trim).filter(s->!s.isEmpty()).collect(java.util.stream.Collectors.toList())));}
    static void move(List<String> selected,int index,int offset){int target=index+offset;if(index>=0&&index<selected.size()&&target>=0&&target<selected.size())Collections.swap(selected,index,target);}
}

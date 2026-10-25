/* Shared app/add-on site picker. Counts never establish a same-site stay. */
window.createSiteChoiceEditor = function createSiteChoiceEditor({items,canSelect,status,label=name=>String(name).replace('_',' · '),prefix='',onChange,ranked=true,message=''}) {
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const wrap=node('div',undefined,'site-choice-editor'),tools=node('div',undefined,'site-choice-tools');
  const select=node('select');select.setAttribute('aria-label',(prefix?prefix+' ':'')+'추가할 사이트');
  const choices=items.filter(item=>!item.enabled&&canSelect(item.name));
  select.add(new Option(choices.length?'사이트 선택':message||'선택 기간에 추가 가능한 사이트 없음',''));
  for(const item of choices)select.add(new Option(label(item.name)+' · '+status(item.name).label,item.name));
  select.disabled=!choices.length;
  const add=node('button','사이트 추가','secondary');add.type='button';add.disabled=true;
  select.addEventListener('change',()=>add.disabled=!select.value||!canSelect(select.value));
  add.addEventListener('click',()=>{
    const item=items.find(item=>item.name===select.value);
    if(!item||item.enabled||!canSelect(item.name))return;
    item.enabled=true;onChange();
  });
  tools.append(select,add);wrap.append(tools);
  const list=node('div',undefined,'site-choice-list room-list');list.setAttribute('aria-label',(prefix?prefix+' ':'')+'선택한 사이트 순위');
  const selected=items.filter(item=>item.enabled);
  if(!selected.length)list.append(node('p','사이트를 추가해 '+(ranked?'우선순위를 정하세요.':'예약할 곳을 선택하세요.'),'site-choice-empty'));
  selected.forEach((item,index)=>{
    const row=node('div',undefined,'room-row site-choice-row enabled');row.dataset.choiceName=item.name;
    const text=node('div',undefined,'room-name'),rank=node('span',ranked?String.fromCodePoint(0x2460+index):'','room-rank');
    const state=status(item.name),badge=node('span',state.label,'availability '+state.kind);
    if(ranked)text.append(rank);text.append(document.createTextNode(label(item.name)),badge);
    const remove=node('button','×','secondary site-choice-remove');remove.type='button';remove.setAttribute('aria-label',(prefix?prefix+' ':'')+label(item.name)+' 제외');
    remove.addEventListener('click',()=>{item.enabled=false;onChange();});
    const drag=node('button','☰','secondary room-drag-handle');drag.type='button';drag.setAttribute('aria-label',(prefix?prefix+' ':'')+label(item.name)+' 순서 이동');
    let saved=null,frame=0,lastY=0;
    const stopFrame=()=>{cancelAnimationFrame(frame);frame=0;row.classList.remove('dragging');};
    const rollback=()=>{if(!saved)return;items.splice(0,items.length,...saved);saved=null;stopFrame();onChange();};
    const move=(target)=>{const from=items.indexOf(item),to=items.indexOf(target);if(from===to)return;items.splice(from,1);items.splice(to,0,item);const targetRow=[...list.children].find(r=>r.dataset.choiceName===target.name);list.insertBefore(row,from<to?targetRow.nextSibling:targetRow);};
    drag.addEventListener('pointerdown',e=>{
      if(e.button!==0||!e.isPrimary)return;e.preventDefault();saved=items.slice();row.classList.add('dragging');lastY=e.clientY;drag.setPointerCapture(e.pointerId);drag.focus({preventScroll:true});
      const tick=()=>{if(!saved)return;if(!wrap.isConnected){rollback();return;}const delta=lastY<80?-8:lastY>innerHeight-80?8:0;if(delta)window.scrollBy(0,delta);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
    });
    drag.addEventListener('pointermove',e=>{
      if(!saved)return;lastY=e.clientY;const targetRow=document.elementFromPoint(e.clientX,e.clientY)?.closest('.site-choice-row');
      if(!targetRow||targetRow.parentElement!==list||targetRow===row)return;
      const target=items.find(r=>r.name===targetRow.dataset.choiceName);if(target){move(target);if(saved){drag.setPointerCapture(e.pointerId);drag.focus({preventScroll:true});}}
    });
    drag.addEventListener('pointerup',()=>{if(!saved)return;saved=null;stopFrame();onChange();});
    drag.addEventListener('pointercancel',rollback);
    drag.addEventListener('lostpointercapture',e=>{if(saved&&!drag.hasPointerCapture(e.pointerId))rollback();});
    drag.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();rollback();return;}
      if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
      const current=items.filter(i=>i.enabled),to=current.indexOf(item)+(e.key==='ArrowUp'?-1:1);if(!current[to])return;
      move(current[to]);const focusLabel=drag.getAttribute('aria-label');onChange();
      [...document.querySelectorAll('.site-choice-row .room-drag-handle')].find(b=>b.getAttribute('aria-label')===focusLabel)?.focus({preventScroll:true});
    });
    row.append(text,remove,drag);list.append(row);
  });
  wrap.append(list);
  const note=node('p',message,'site-choice-message');note.hidden=!message;note.setAttribute('role','status');wrap.append(note);
  return wrap;
};

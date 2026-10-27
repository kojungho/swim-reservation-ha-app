/* Shared app/add-on site picker. Counts never establish a same-site stay. */
window.createSiteChoiceEditor = function createSiteChoiceEditor({items,canSelect,status,label=name=>String(name).split('_')[0],prefix='',onChange,ranked=true,message=''}) {
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const wrap=node('div',undefined,'site-choice-editor'),tools=node('div',undefined,'site-choice-tools');
  const add=node('button','사이트 선택','secondary');add.disabled=items.length>0&&items.every(i=>['unavailable','booked'].includes(status(i.name).kind));add.type='button';add.setAttribute('aria-haspopup','dialog');
  const pickerSource={wrap,items,canSelect,status,label,onChange,add};
  if(window.activeSiteChoicePopup?.prefix===prefix){window.activeSiteChoicePopup.source=pickerSource;window.activeSiteChoicePopup.render();}
  add.addEventListener('click',async()=>{
    if(window.siteChoicePreparing||window.activeSiteChoicePopup)return;window.siteChoicePreparing=true;
    try{
    if(window.prepareSiteChoice&&!await window.prepareSiteChoice())return;
    if(window.activeSiteChoicePopup)return;
    const dialog=node('dialog',undefined,'site-choice-dialog'),heading=node('h2','캠핑사이트 선택'),count=node('p'),grid=node('div',undefined,'site-choice-options'),actions=node('div',undefined,'site-choice-dialog-actions');
    const sourceNow=wrap.isConnected?pickerSource:(window.latestSiteChoices?.get(prefix)||pickerSource);const chosen=new Set(sourceNow.items.filter(i=>i.enabled).map(i=>i.name));count.setAttribute('aria-live','polite');
    const popup={prefix,source:sourceNow,dialog,render:null};window.activeSiteChoicePopup=popup;
    const update=()=>count.textContent=popup.source.items.filter(i=>popup.source.canSelect(i.name)).length===1?'선택 가능한 사이트가 1개입니다. 선택하면 바로 적용됩니다.':chosen.size+'개 선택 · 완료를 누르면 한 번에 적용됩니다.';
    popup.render=()=>{const source=popup.source;grid.replaceChildren();
      for(const item of source.items){if(!source.canSelect(item.name)){chosen.delete(item.name);continue;}const row=node('label',undefined,'site-choice-option'),check=node('input'),body=node('span'),state=source.status(item.name);check.type='checkbox';check.value=item.name;check.checked=chosen.has(item.name);check.disabled=!chosen.has(item.name)&&!item.enabled&&!source.canSelect(item.name);row.dataset.available=String(!check.disabled);check.setAttribute('aria-label',source.label(item.name));body.append(node('strong',source.label(item.name)),node('small',state.label,'availability '+state.kind));check.addEventListener('change',()=>{check.checked?chosen.add(item.name):chosen.delete(item.name);update();const available=popup.source.items.filter(i=>popup.source.canSelect(i.name));if(check.checked&&available.length===1&&available[0].name===item.name)done.click();});row.append(check,body);grid.append(row);}
      update();
    };popup.render();
    const cancel=node('button','취소','secondary'),done=node('button','완료','primary');cancel.type=done.type='button';cancel.onclick=()=>dialog.close();
    done.onclick=()=>{
      const source=popup.source;if(!source.wrap.isConnected){dialog.close();return;}
      if(source.items.some(i=>chosen.has(i.name)&&!i.enabled&&!source.canSelect(i.name))){window.showFloatingMessage?.('사이트 현황이 바뀌었습니다. 선택을 확인해 주세요.',{error:true});return;}
      const old=source.items.filter(i=>i.enabled&&chosen.has(i.name)),added=[...chosen].filter(name=>!old.some(i=>i.name===name)).map(name=>source.items.find(i=>i.name===name)).filter(Boolean);
      for(const item of source.items)item.enabled=chosen.has(item.name);
      const selected=[...old,...added];source.items.splice(0,source.items.length,...selected,...source.items.filter(i=>!i.enabled));window.activeSiteChoicePopup=null;dialog.close();source.onChange();
    };
    const all=node('button','전체 선택','secondary'),clear=node('button','전체 삭제','danger');all.type=clear.type='button';all.onclick=()=>{for(const i of popup.source.items)if(popup.source.canSelect(i.name))chosen.add(i.name);popup.render();};clear.onclick=()=>{chosen.clear();popup.render();};
    const map=node('button','배치도','site-choice-map');map.type='button';map.style.marginLeft='auto';map.style.backgroundColor='#facc15';map.style.color='#3d3100';map.style.borderColor='#eab308';map.onclick=()=>document.getElementById('siteMapButton')?.click();
    actions.append(cancel,done);const bulk=node('div',undefined,'site-choice-bulk');bulk.append(all,clear,map);dialog.append(heading,bulk,count,grid,actions);document.body.append(dialog);
    const observer=new MutationObserver(()=>{if(!popup.source.wrap.isConnected)dialog.close();});observer.observe(document.body,{childList:true,subtree:true});
    dialog.addEventListener('close',()=>{observer.disconnect();if(window.activeSiteChoicePopup===popup)window.activeSiteChoicePopup=null;dialog.remove();if(popup.source.add.isConnected)popup.source.add.focus({preventScroll:true});},{once:true});dialog.showModal();
    }catch(error){window.showFloatingMessage?.(error.message||'사이트 조회 실패',{error:true});}finally{window.siteChoicePreparing=false;}
  });
  tools.append(add);wrap.append(tools);
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
    row.append(drag,text,remove);list.append(row);
  });
  wrap.append(list);
  const note=node('p',message,'site-choice-message');note.hidden=!message;note.setAttribute('role','status');wrap.append(note);
  window.latestSiteChoices??=new Map();window.latestSiteChoices.set(prefix,pickerSource);
  return wrap;
};

if(!document.getElementById('site-choice-dialog-style')){const style=document.createElement('style');style.id='site-choice-dialog-style';style.textContent=`.site-choice-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 24px));max-height:80dvh;padding:14px;border:1px solid var(--line,#dae4df);border-radius:22px;background:var(--card,#fff);color:var(--ink,#18392a)}.site-choice-dialog::backdrop{background:#10231b80}.site-choice-dialog h2{margin:0 0 8px;font-size:20px}.site-choice-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin:6px 0}.site-choice-option{display:flex;align-items:center;gap:5px;padding:6px;border:1px solid var(--line,#d8e3dc);border-radius:12px;min-width:0;cursor:pointer}.site-choice-option:has(input:checked){border-color:var(--green,#28734d);background:#e7f5ec}.site-choice-option[data-available=false]{opacity:.5;cursor:default}.site-choice-option input{width:20px;height:20px;flex:none;accent-color:var(--green,#28734d)}.site-choice-option span{display:flex;align-items:center;justify-content:space-between;gap:3px;min-width:0;flex:1}.site-choice-option strong{white-space:nowrap}.site-choice-bulk{display:flex;gap:6px}.site-choice-dialog>p{font-size:12px;margin:6px 0}.site-choice-bulk button{padding:6px 10px;min-height:34px}.site-choice-option strong{font-size:13px;overflow-wrap:anywhere}.site-choice-option small{font-size:11px;white-space:normal}.site-choice-dialog-actions{display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:-20px;background:var(--card,#fff);padding:12px 0}.site-choice-dialog-actions button{min-width:76px;min-height:44px}.site-choice-tools{justify-content:flex-start}`;document.head.append(style);}

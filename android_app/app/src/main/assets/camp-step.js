function campStep(op,p){
  const rooms=p.catalog.map((room,i)=>typeof room==='string'?{name:room,siteId:i+1,displayName:room.split('_').reverse().join('')}:room);
  const date=p.date,checkout=p.checkout,site=String(p.site);
  const fail=code=>({ok:false,code});
  const verify=filled=>{
    const forms=document.querySelectorAll('form.js-book');if(forms.length!==1)return null;
    const form=forms[0],u=new URL(form.action);
    const expected={site,checkin:date,checkout,adults:String(p.adults),children:'0',infants:'0'};
    const checks={action:u.origin===location.origin&&u.pathname==='/camp/book.php'&&!u.search,method:form.method.toLowerCase()==='post',csrf:Boolean(form.querySelector('[name="_csrf"]')?.value),siteName:document.querySelector('.summary-card .sum-title')?.textContent.replace(/\s/g,'')===rooms.find(room=>room.siteId===p.site)?.displayName};
    for(const [key,value]of Object.entries(expected))checks[key]=form.querySelector(`[name="${key}"]`)?.value===value;
    if(filled){const terms=[...form.querySelectorAll('input.js-agree[data-required="1"]')];checks.terms=terms.length>0&&terms.every(e=>e.type==='checkbox'&&e.checked&&!e.disabled);checks.bank=form.querySelector('[name="pay_method"][value="bank"]')?.checked===true;checks.valid=form.checkValidity();checks.name=form.querySelector('[name="name"]')?.value===p.name;checks.phone=form.querySelector('[name="phone"]')?.value===p.phone;}
    return {form,checks,ok:Object.values(checks).every(Boolean)};
  };
  if(op==='listing'){
    const u=new URL(location.href);if(u.searchParams.get('ci')!==date||u.searchParams.get('co')!==checkout||!document.querySelector('.room-list'))return fail('LIST_UNRECOGNIZED');
    const available=[],catalog=[];
    for(const a of document.querySelectorAll('a.room-card[href]')){const url=new URL(a.href),id=Number(url.searchParams.get('site')),displayName=a.querySelector('.room-name')?.textContent.replace(/\s/g,'');if(url.origin!==location.origin||url.pathname!=='/camp/site.php'||url.searchParams.get('ci')!==date||url.searchParams.get('co')!==checkout||!Number.isSafeInteger(id)||id<1||id>10000||!displayName)return fail('CATALOG_MISMATCH');const old=rooms.find(room=>room.siteId===id);if(old&&old.displayName!==displayName)return fail('CATALOG_MISMATCH');const match=/^(하늘존|산맥존)(.+)$/.exec(displayName),name=match?match[2]+'_'+match[1]:displayName;if(rooms.some(room=>room.name===name&&room.siteId!==id)||available.includes(id))return fail('CATALOG_MISMATCH');available.push(id);catalog.push({name,displayName,siteId:id});}
    return {ok:true,available,catalog};
  }
  if(op==='prepare'){
    if(!document.querySelector('form.js-book')){const text=document.querySelector('.msg-box')?.textContent||'';return fail(/체크인까지|오픈|예약.*시작|아직/.test(text)?'NOT_OPEN':/예약.*(불가|마감)|예약할 수 없|선택.*(없|불가)/.test(text)?'NO_ROOM':'FORM_UNRECOGNIZED');}
    const v=verify(false);if(!v?.ok)return {ok:false,code:'FORM_MISMATCH',checks:v?.checks||{}};
    const result=fillCampForm(v.form,{fields:{name:p.name,phone:p.phone,depositor:p.payer||p.name,request:p.request||'',arrive_time:p.arrival||''}});
    return {ok:result.ok,code:result.code,checks:v.checks,steps:result.steps};
  }
  if(op==='submit'){
    const v=verify(true);if(!v?.ok||!p.consent)return fail('PRE_SUBMIT_MISMATCH');
    const buttons=v.form.querySelectorAll('button.js-pay');if(buttons.length!==1||buttons[0].disabled||buttons[0].hasAttribute('formaction'))return fail('SUBMIT_BUTTON');
    buttons[0].click();return {ok:true};
  }
  if(op==='receipt'){
    const r=readCampReservations({expectedName:p.name,rooms}),row=r.rows[0];
    const checks={recognized:r.kind==='detail',complete:Boolean(r.submissionComplete),pending:row?.paymentStatus==='pending',one:r.rows.length===1,room:row?.siteId===p.site,checkin:row?.stayDate===date,checkout:row?.checkout===checkout,nights:row?.nights===p.nights+'박',adults:row?.adults===p.adults};
    return {ok:Object.values(checks).every(Boolean),checks};
  }
  return fail('UNKNOWN_STEP');
}

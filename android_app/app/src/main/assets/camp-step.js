function campStep(op,p,offlineUrl){
  const offline=typeof offlineUrl==='string'&&['preflight-listing','preflight-prepare','preflight'].includes(op);
  const current=offline?new URL(offlineUrl):new URL(location.href);
  if(offline&&(current.protocol!=='https:'||current.hostname!=='www.swimozicamp.com'||!['/camp/','/camp/book.php'].includes(current.pathname)))return {ok:false,code:'PREFLIGHT_SOURCE'};
  if(offline)op=op.replace(/^preflight-(listing|prepare)$/,'$1');
  const rooms=p.catalog.map((room,i)=>typeof room==='string'?{name:room,siteId:i+1,displayName:room.split('_').reverse().join('')}:room);
  const date=p.date,checkout=p.checkout,site=String(p.site);
  const fail=code=>({ok:false,code});
  const personalValues=()=>({name:p.name,phone:p.phone,depositor:p.payer||p.name,request:p.request||'',arrive_time:p.arrival||''});
  const verify=filled=>{
    const forms=document.querySelectorAll('form.js-book');if(forms.length!==1)return null;
    const form=forms[0],u=offline?new URL(form.getAttribute('action')||'',current):new URL(form.action);
    const expected={site,checkin:date,checkout,adults:String(p.adults),children:'0',infants:'0'};
    const single=(key,value)=>current.searchParams.getAll(key).length===1&&current.searchParams.get(key)===value;
    const checks={page:current.pathname==='/camp/book.php'&&!current.username&&!current.password&&!current.hash&&single('site',site)&&single('ci',date)&&single('co',checkout),action:u.origin===current.origin&&u.pathname==='/camp/book.php'&&!u.search,method:form.method.toLowerCase()==='post',csrf:Boolean(form.querySelector('[name="_csrf"]')?.value),siteName:document.querySelector('.summary-card .sum-title')?.textContent.replace(/\s/g,'')===rooms.find(room=>room.siteId===p.site)?.displayName};
    for(const [key,value]of Object.entries(expected))checks[key]=form.querySelector(`[name="${key}"]`)?.value===value;
    if(filled){const validation=fillCampForm(form,{verifyOnly:true,fields:personalValues()});checks.terms=validation.checks?.requiredTermsChecked===true;checks.bank=validation.checks?.bankSelected===true;checks.valid=form.checkValidity();checks.personalFields=validation.ok===true;}
    return {form,checks,ok:Object.values(checks).every(Boolean)};
  };
  if(op==='listing'){
    const u=current;if(u.searchParams.get('ci')!==date||u.searchParams.get('co')!==checkout)return fail('LIST_UNRECOGNIZED');
    if(!document.querySelector('.room-list')){const notice=document.querySelector('.msg-box')?.textContent||'';return fail(/체크인까지|오픈|예약.*시작|아직/.test(notice)?'NOT_OPEN':'LIST_UNRECOGNIZED');}
    const parsed={recognized:true,cards:[...document.querySelectorAll('a.room-card[href]')].map(a=>({href:a.getAttribute('href'),displayName:a.querySelector('.room-name')?.textContent||''}))};
    const checked=validateCampSites(parsed,{root:current.href,checkin:date,checkout},rooms);
    if(!checked.ok)return fail(checked.code);
    return {ok:true,available:checked.cards.map(room=>room.siteId),catalog:checked.cards,addedSites:checked.added,changedSites:checked.changed};
  }
  if(op==='prepare'){
    if(!document.querySelector('form.js-book')){const text=document.querySelector('.msg-box')?.textContent||'';return fail(/체크인까지|오픈|예약.*시작|아직/.test(text)?'NOT_OPEN':/예약.*(불가|마감)|예약할 수 없|선택.*(없|불가)/.test(text)?'NO_ROOM':'FORM_UNRECOGNIZED');}
    const v=verify(false);if(!v?.ok)return {ok:false,code:'FORM_MISMATCH',checks:v?.checks||{}};
    const result=fillCampForm(v.form,{fields:personalValues()});
    return {ok:result.ok,code:result.code,checks:v.checks,steps:result.steps};
  }
  if(op==='capture'){
    const v=verify(true);if(!v?.ok||!p.consent)return fail('PRE_SUBMIT_MISMATCH');return fillCampForm(v.form,{verifyOnly:true,captureOnly:true,fields:personalValues()});
  }
  if(op==='preflight'){
    const v=verify(true);return {ok:Boolean(v?.ok&&p.consent),code:v?.ok&&p.consent?'':'PRE_SUBMIT_MISMATCH',checks:v?.checks||{}};
  }
  if(op==='submit'){
    const v=verify(true);if(!v?.ok||!p.consent)return fail('PRE_SUBMIT_MISMATCH');
    const buttons=v.form.querySelectorAll('button.js-pay');if(buttons.length!==1||buttons[0].disabled||buttons[0].hasAttribute('formaction'))return fail('SUBMIT_BUTTON');
    buttons[0].click();return {ok:true};
  }
  if(op==='receipt'){
    const r=readCampReservations({expectedName:p.name,rooms}),row=r.rows[0];
    const checks={recognized:r.kind==='detail',complete:Boolean(r.submissionComplete),pending:row?.paymentStatus==='pending',one:r.rows.length===1,room:row?.siteId===p.site,checkin:row?.stayDate===date,checkout:row?.checkout===checkout,nights:row?.nights===p.nights+'박',adults:row?.adults===p.adults};
    return {ok:Object.values(checks).every(Boolean),checks,receipt:{id:row?.id||'',total:row?.total||'',status:row?.status||''}};
  }
  return fail('UNKNOWN_STEP');
}

// Keep identical to swim_reservation/src/camp-site-identity.js (covered by tests).
function validateCampSites(parsed, expected, known = []) {
  const fail = () => ({ ok: false, code: 'CATALOG_MISMATCH' });
  try {
    if (!parsed.recognized || !Array.isArray(parsed.cards)) return fail();
    const root = new URL(expected.root), cards = [], ids = new Set(), names = new Set();
    for (const raw of parsed.cards) {
      const url = new URL(raw.href, root);
      const single = (key, value) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value;
      const value = url.searchParams.get('site'), siteId = Number(value);
      const displayName = String(raw.displayName || '').replace(/\s+/g, '');
      if (url.origin !== root.origin || url.username || url.password || url.hash || url.pathname !== '/camp/site.php'
        || !single('ci', expected.checkin) || !single('co', expected.checkout)
        || !single('site', value) || !/^[1-9]\d{0,4}$/.test(value || '') || siteId > 10000
        || !displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) return fail();
      const match = /^(하늘존|산맥존)(.+)$/.exec(displayName);
      const name = match ? `${match[2]}_${match[1]}` : displayName;
      // Fresh official links override cached numbers. Preferences remain keyed by
      // name; only ambiguity within this fresh response prevents resolution.
      if (name.length > 80 || ids.has(siteId) || names.has(name)) return fail();
      ids.add(siteId); names.add(name); cards.push({ name, displayName, siteId });
    }
    return { ok: true, cards, added: cards.filter(card => !known.some(room => room.name === card.name)).map(card => card.name), changed: cards.filter(card => known.some(room => room.name === card.name && room.siteId !== card.siteId)).map(card => card.name) };
  } catch { return fail(); }
}

// One browser call for all personal fields and required agreements. This never
// submits a form, changes its hidden fields, or accepts optional agreements.
export function fillCampForm(form, values) {
  const steps = [];
  let current;
  const begin = step => { current = { step, startedAt: performance.now() }; };
  const finish = (ok = true, checks = {}) => steps.push({ step: current.step, outcome: ok ? 'complete' : 'error', elapsedMs: Math.round((performance.now() - current.startedAt) * 1000) / 1000, checks });
  const fieldLabel = name => ['name', 'phone', 'depositor', 'request', 'arrive_time'].includes(name) ? name : 'other';
  const fail = (code, checks, invalidFields = []) => { finish(false, checks); return { ok: false, code, failedStep: current.step, invalidFields, steps }; };
  try {
  const paymentState = () => {
    const controls = [...form.querySelectorAll('[name="pay_method"]')];
    const bank = controls.find(element => element.tagName === 'INPUT' && element.value === 'bank') || (controls.length === 1 && controls[0].tagName === 'SELECT' ? controls[0] : null);
    const fixed = controls.length === 1 && bank?.type === 'hidden' && !bank.matches(':disabled');
    const radio = controls.length > 0 && controls.every(element => element.tagName === 'INPUT' && element.type === 'radio')
      && controls.filter(element => element.value === 'bank').length === 1 && !bank.matches(':disabled');
    const select = controls.length === 1 && bank?.tagName === 'SELECT' && !bank.multiple && !bank.matches(':disabled')
      && [...bank.options].filter(option => option.value === 'bank').length === 1
      && [...bank.options].some(option => option.value === 'bank' && !option.matches(':disabled'));
    const recognized = Boolean(fixed || radio || select);
    const submittedValues = new FormData(form).getAll('pay_method');
    return { bank, fixed, select, recognized, selected: recognized && (fixed || select ? bank.value === 'bank' : bank.checked) && submittedValues.length === 1 && submittedValues[0] === 'bank' };
  };
  // Read-only reuse for final validation; do not repair or alter payment fields.
  if (values.paymentOnly) {
    const payment = paymentState();
    return { ok: payment.selected, checks: { bankRecognized: payment.recognized, bankSelected: payment.selected } };
  }
  begin('form-controls-check');
  const controls = [...form.elements].filter(element => ['INPUT','TEXTAREA','SELECT'].includes(element.tagName));
  const text = element => [...(element.labels || [])].map(label => label.textContent).join(' ')+' '+(element.getAttribute('aria-label') || '')+' '+(element.placeholder || '');
  const aliases = { name:['reserver_name','reserverName','booker_name','customer_name'],phone:['tel','mobile','phone_number','mobile_phone'],depositor:['depositor_name','payer','payer_name'],request:['requests','memo'],arrive_time:['arrival_time','arrival'] };
  const semantics = { name:/예약자\s*(?:명|이름|성명)|성함|^\s*(?:이름|성명)\s*$/,phone:/휴대\s*(?:폰|전화)|전화\s*번호|연락처/,depositor:/입금자\s*(?:명|이름|성명)|예금주/,request:/요청\s*사항|남기실\s*말씀/,arrive_time:/도착\s*(?:예정\s*)?시간|입실\s*예정\s*시간/ };
  const editable = element => !element.matches(':disabled') && !element.readOnly && (element.tagName !== 'INPUT' || ['text','tel','number','search'].includes(element.type));
  const digits = value => String(value).replace(/\D/g,'');
  const fits = (element,value) => {
    if(!editable(element) || element.maxLength>=0 && value.length>element.maxLength)return false;
    if(element.tagName==='SELECT' && (element.multiple || ![...element.options].some(option=>option.value===value&&!option.matches(':disabled'))))return false;
    const probe=element.cloneNode(true);probe.value=value;return probe.value===value&&probe.checkValidity();
  };
  const resolve = (name,value) => {
    const direct=controls.filter(element=>element.name===name || element.id===name);
    const named=direct.length?direct:controls.filter(element=>(aliases[name]||[]).some(alias=>element.name===alias||element.id===alias));
    let matches=named.length?named:controls.filter(element=>editable(element)&&semantics[name]?.test(text(element))&&!(name==='name'&&/입금|예금주|비상|보호자/.test(text(element)))&&!(name==='phone'&&/비상|보호자|추가/.test(text(element))));
    if(name==='phone' && !named.length){
      const groups=[];
      for(const base of ['phone','tel','mobile','hp'])for(const separator of ['','_']){
        const parts=[1,2,3].map(index=>controls.filter(element=>[element.name,element.id].includes(base+separator+index)));
        if(parts.every(part=>part.length===1))groups.push(parts.map(part=>part[0]));
      }
      if(groups.length===1)matches=groups[0];else if(groups.length>1)matches=[];
    }
    if(!matches.length && !value && ['depositor','request','arrive_time'].includes(name))return [];
    if(name==='phone'){
      const number=digits(value);
      if(!/^01\d{8,9}$/.test(number))return [{name,element:null,value,unsupported:true}];
      if(matches.length===3){
        const sizes=[3,number.length-7,4],parts=[number.slice(0,3),number.slice(3,-4),number.slice(-4)];
        return matches.map((element,index)=>({name,element,value:parts[index],unsupported:!fits(element,parts[index]) || (element.maxLength>=0&&element.maxLength<sizes[index])}));
      }
      if(matches.length===1){
        const element=matches[0],hyphen=number.slice(0,3)+'-'+number.slice(3,-4)+'-'+number.slice(-4),space=hyphen.replace(/-/g,' ');
        const formats=/-/.test(element.placeholder||'')?[hyphen,number,space]:[number,hyphen,space];
        const formatted=formats.find(candidate=>fits(element,candidate));
        return [{name,element,value:formatted??number,unsupported:formatted===undefined}];
      }
    }
    return [{name,element:matches.length===1?matches[0]:null,value}];
  };
  const fields=Object.entries(values.fields||{}).flatMap(([name,value])=>resolve(name,String(value)));
  const payment = paymentState(), bank = payment.bank;
  const requiredTerms=()=>[...form.querySelectorAll('input[type="checkbox"]')].filter(element=>element.dataset.required==='1'||element.required||element.getAttribute('aria-required')==='true'||/필수/.test(text(element)));
  const allowedTerm=element=>!element.matches(':disabled')&&element.dataset.required!=='0'&&!/선택|마케팅|광고|홍보|이벤트|뉴스레터|전체\s*동의|모두\s*동의|제\s*3\s*자|제삼자|국외|자동\s*결제|정기\s*결제|marketing|promo/i.test(text(element)+' '+element.name)
    &&(/취소|환불|이용\s*약관|예약\s*(?:약관|규정|안내)|개인정보.*(?:수집|이용|처리|동의)/.test(text(element))||/^(agree_refund|agree_privacy|privacy_consent)$/.test(element.name));
  const terms=requiredTerms();
  const optionalChecked=()=>[...form.querySelectorAll('input[type="checkbox"]')].some(element=>element.checked&&!terms.includes(element)&&(element.dataset.required==='0'||/선택|마케팅|광고|홍보|marketing|promo/i.test(text(element)+' '+element.name)));
  if(!terms.length||terms.some(element=>!allowedTerm(element))||optionalChecked())return fail('TERMS_UNRECOGNIZED',{requiredTermsRecognized:false});
  const invalidControls = fields.filter(({ element, value }) => !element || !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || !element.name || element.matches(':disabled') || element.readOnly || element.type === 'hidden'
    || (element.maxLength >= 0 && value.length > element.maxLength)
    || (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === value && !option.disabled)));
  for(const field of fields)if(field.unsupported&&!invalidControls.includes(field))invalidControls.push(field);
  if(new Set(fields.map(field=>field.element)).size!==fields.length) return fail('FORM_FIELDS_AMBIGUOUS',{fieldsRecognized:false});
  if (!payment.recognized || invalidControls.length) return fail(invalidControls.length ? 'FORM_FIELDS_UNRECOGNIZED' : 'PAYMENT_METHOD_UNRECOGNIZED', { fieldsRecognized: !invalidControls.length, bankRecognized: payment.recognized }, invalidControls.map(({ name }) => fieldLabel(name)));
  finish(true, { fieldsRecognized: true, requiredTermsRecognized: true });
  const fieldMatches=field=>field.element.isConnected&&(field.name==='phone'?digits(field.element.value)===digits(field.value):field.element.value===field.value)&&field.element.checkValidity();
  const finalChecks=()=>({fieldsMatched:fields.every(fieldMatches),bankSelected:paymentState().selected,requiredTermsChecked:requiredTerms().length===terms.length&&requiredTerms().every(element=>terms.includes(element)&&allowedTerm(element)&&element.checked),optionalTermsUnselected:!optionalChecked(),nativeValid:form.checkValidity()});
  if(values.verifyOnly){
    const checks=finalChecks(),ok=Object.values(checks).every(Boolean);
    if(!values.captureOnly||!ok)return {ok,checks};
    const data=new FormData(form),captured=[];
    for(const field of fields){const sent=data.getAll(field.element.name);if(sent.length!==1||typeof sent[0]!=='string'||sent[0]!==field.element.value)return {ok:false,checks:{submittedFieldsMatched:false}};captured.push({role:field.name,name:field.element.name,value:sent[0]});}
    const value=role=>captured.filter(field=>field.role===role).map(field=>field.value).join(role==='phone'?'':'');
    return {ok:true,checks,entered:{name:value('name'),phone:digits(value('phone')),depositor:value('depositor'),request:value('request'),arrival:value('arrive_time'),fields:captured}};
  }
  const changed = element => { element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
  begin('personal-fields-fill');
  for (const { element, value } of fields) {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    changed(element);
  }
  finish();
  begin('payment-select');
  if (!payment.fixed) {
    if (payment.select) Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(bank, 'bank');
    else Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(bank, true);
    changed(bank);
  }
  finish(paymentState().selected, { bankSelected: paymentState().selected, fixedBank: payment.fixed });
  begin('terms-accept');
  for (const element of terms) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(element, true);
    changed(element);
  }
  finish(terms.every(element => element.checked), { requiredTermsChecked: terms.every(element => element.checked) });
  begin('input-verify');
  const checks = finalChecks();
  const invalidFields = fields.filter(field=>!fieldMatches(field)).map(({ name }) => fieldLabel(name));
  const ok = Object.values(checks).every(Boolean);
  finish(ok, checks);
  return { ok, code: ok ? null : 'FORM_VALIDATION_FAILED', failedStep: ok ? null : current.step, invalidFields, steps };
  } catch { return values.paymentOnly ? { ok: false, checks: { bankRecognized: false, bankSelected: false } } : fail('FORM_DOM_ERROR', { domOperationFailed: true }); }
}

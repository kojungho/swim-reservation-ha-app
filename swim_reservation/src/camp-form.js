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
  const fields = Object.entries(values.fields).map(([name, value]) => ({ name, element: form.querySelector(`[name="${name}"]`), value: String(value) }));
  const payment = paymentState(), bank = payment.bank;
  const terms = [...form.querySelectorAll('input.js-agree[data-required="1"]')];
  if (!terms.length || terms.some(element => element.type !== 'checkbox' || element.matches(':disabled'))) return fail('TERMS_UNRECOGNIZED', { requiredTermsRecognized: false });
  const invalidControls = fields.filter(({ element, value }) => !element || !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.matches(':disabled') || element.readOnly || element.type === 'hidden'
    || (element.maxLength >= 0 && value.length > element.maxLength)
    || (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === value && !option.disabled)));
  if (!payment.recognized || invalidControls.length) return fail(invalidControls.length ? 'FORM_FIELDS_UNRECOGNIZED' : 'PAYMENT_METHOD_UNRECOGNIZED', { fieldsRecognized: !invalidControls.length, bankRecognized: payment.recognized }, invalidControls.map(({ name }) => fieldLabel(name)));
  finish(true, { fieldsRecognized: true, requiredTermsRecognized: true });
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
  const checks = { fieldsMatched: fields.every(({ element, value }) => element.value === value), bankSelected: paymentState().selected,
    requiredTermsChecked: terms.every(element => element.checked), nativeValid: form.checkValidity() };
  const invalidFields = fields.filter(({ element, value }) => element.value !== value || !element.checkValidity()).map(({ name }) => fieldLabel(name));
  const ok = Object.values(checks).every(Boolean);
  finish(ok, checks);
  return { ok, code: ok ? null : 'FORM_VALIDATION_FAILED', failedStep: ok ? null : current.step, invalidFields, steps };
  } catch { return values.paymentOnly ? { ok: false, checks: { bankRecognized: false, bankSelected: false } } : fail('FORM_DOM_ERROR', { domOperationFailed: true }); }
}

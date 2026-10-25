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
  begin('form-controls-check');
  const fields = Object.entries(values.fields).map(([name, value]) => ({ name, element: form.querySelector(`[name="${name}"]`), value: String(value) }));
  const bank = form.querySelector('input[type="radio"][name="pay_method"][value="bank"]');
  const terms = [...form.querySelectorAll('input.js-agree[data-required="1"]')];
  if (!terms.length || terms.some(element => element.type !== 'checkbox' || element.matches(':disabled'))) return fail('TERMS_UNRECOGNIZED', { requiredTermsRecognized: false });
  const invalidControls = fields.filter(({ element, value }) => !element || !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.matches(':disabled') || element.readOnly || element.type === 'hidden'
    || (element.maxLength >= 0 && value.length > element.maxLength)
    || (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === value && !option.disabled)));
  if (!bank || bank.matches(':disabled') || invalidControls.length) return fail('FORM_FIELDS_UNRECOGNIZED', { fieldsRecognized: !invalidControls.length, bankRecognized: Boolean(bank && !bank.matches(':disabled')) }, invalidControls.map(({ name }) => fieldLabel(name)));
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
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(bank, true);
  changed(bank);
  finish(bank.checked, { bankSelected: bank.checked });
  begin('terms-accept');
  for (const element of terms) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(element, true);
    changed(element);
  }
  finish(terms.every(element => element.checked), { requiredTermsChecked: terms.every(element => element.checked) });
  begin('input-verify');
  const checks = { fieldsMatched: fields.every(({ element, value }) => element.value === value), bankSelected: bank.checked,
    requiredTermsChecked: terms.every(element => element.checked), nativeValid: form.checkValidity() };
  const invalidFields = fields.filter(({ element, value }) => element.value !== value || !element.checkValidity()).map(({ name }) => fieldLabel(name));
  const ok = Object.values(checks).every(Boolean);
  finish(ok, checks);
  return { ok, code: ok ? null : 'FORM_VALIDATION_FAILED', failedStep: ok ? null : current.step, invalidFields, steps };
  } catch { return fail('FORM_DOM_ERROR', { domOperationFailed: true }); }
}

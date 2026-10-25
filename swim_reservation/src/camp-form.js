// One browser call for all personal fields and required agreements. This never
// submits a form, changes its hidden fields, or accepts optional agreements.
export function fillCampForm(form, values) {
  const fields = Object.entries(values.fields).map(([name, value]) => ({ element: form.querySelector(`[name="${name}"]`), value: String(value) }));
  const bank = form.querySelector('input[type="radio"][name="pay_method"][value="bank"]');
  const terms = [...form.querySelectorAll('input.js-agree[data-required="1"]')];
  if (!terms.length || terms.some(element => element.type !== 'checkbox' || element.matches(':disabled'))) return { ok: false, code: 'TERMS_UNRECOGNIZED' };
  if (!bank || bank.matches(':disabled') || fields.some(({ element, value }) => !element || !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.matches(':disabled') || element.readOnly || element.type === 'hidden'
    || (element.maxLength >= 0 && value.length > element.maxLength)
    || (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === value && !option.disabled)))) return { ok: false, code: 'FORM_FIELDS_UNRECOGNIZED' };
  const changed = element => { element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
  for (const { element, value } of fields) {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    changed(element);
  }
  for (const element of [bank, ...terms]) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(element, true);
    changed(element);
  }
  return { ok: fields.every(({ element, value }) => element.value === value) && bank.checked && terms.every(element => element.checked) && form.checkValidity(), code: 'FORM_VALIDATION_FAILED' };
}

function readCampLookupSelections({ expectedName, expectedPhone }) {
  const picks = [...document.querySelectorAll('.done-wrap .lookup-pick')];
  if (!picks.length || picks.length > 20) return null;
  const selections = picks.map(form => {
    if (form.tagName !== 'FORM' || form.method.toLowerCase() !== 'post') return null;
    const action = new URL(form.action);
    if (action.origin !== location.origin || action.pathname !== '/camp/lookup.php' || action.search) return null;
    const inputs = [...form.querySelectorAll('input')];
    const names = ['_csrf', 'name', 'phone', 'pick'];
    if (inputs.length !== 4 || names.some(name => inputs.filter(input => input.type === 'hidden' && input.name === name && !input.disabled).length !== 1)) return null;
    const fields = Object.fromEntries(inputs.map(input => [input.name, input.value]));
    if (!fields._csrf || fields._csrf.length > 1024 || !/^[A-Za-z0-9_-]{1,256}$/.test(fields.pick)
      || fields.name.replace(/\s/g, '') !== String(expectedName || '').replace(/\s/g, '')
      || fields.phone.replace(/\D/g, '') !== String(expectedPhone || '').replace(/\D/g, '')) return null;
    const button = form.querySelector('button[type="submit"]');
    if (!button || button.disabled || button.hasAttribute('formaction') || button.textContent.replace(/\s/g, '') !== '자세히보기') return null;
    const ids = [...new Set(form.textContent.match(/\b[A-Z][A-Z0-9]{2,}-[A-Z0-9]{2,}\b/gi) || [])];
    // Imported/confirmed reservations may omit the public booking number on the
    // compact card. The server-provided pick still identifies the detail; never
    // derive it from a guessed booking number.
    return ids.length <= 1 ? { id: ids[0] || null, fields } : null;
  });
  if (selections.some(item => !item) || new Set(selections.map(item => item.id).filter(Boolean)).size !== selections.filter(item => item.id).length
    || new Set(selections.map(item => item.fields.pick)).size !== selections.length) return null;
  return selections;
}

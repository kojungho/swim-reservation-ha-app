export function readPageDiagnostics() {
  const clean = (value, limit = 240) => String(value || "")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email-redacted]")
    .replace(/\b(?:\d[ -]?){6,}\d\b/g, "[number-redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
  const safeUrl = (value) => {
    try {
      const parsed = new URL(value, location.href);
      const safe = new URL(`${parsed.origin}${parsed.pathname}`);
      for (const key of ["id", "adaystart"]) {
        if (parsed.searchParams.has(key)) safe.searchParams.set(key, parsed.searchParams.get(key));
      }
      return safe.href;
    } catch {
      return clean(String(value || "").split(/[?#]/)[0], 160);
    }
  };
  const contextFor = (element) => {
    const row = element.closest("tr");
    const previousCell = element.closest("td")?.previousElementSibling;
    const label = element.labels?.[0]?.innerText || element.closest("label")?.innerText;
    return clean(label || previousCell?.innerText || row?.innerText || element.parentElement?.innerText, 180);
  };

  return {
    capturedAt: Date.now(),
    url: safeUrl(location.href),
    title: clean(document.title, 160),
    headings: [...document.querySelectorAll("h1, h2, h3, legend")].map((element) => clean(element.innerText, 120)).filter(Boolean).slice(0, 20),
    forms: [...document.forms].map((form) => ({
      name: clean(form.getAttribute("name"), 80),
      id: clean(form.id, 80),
      method: clean(form.method, 20),
      action: safeUrl(form.action)
    })).slice(0, 20),
    fields: [...document.querySelectorAll("input, select, textarea")].map((field) => ({
      tag: field.tagName.toLowerCase(),
      type: clean(field.getAttribute("type") || field.type, 30),
      name: clean(field.getAttribute("name"), 100),
      id: clean(field.id, 100),
      maxLength: Number.isFinite(field.maxLength) ? field.maxLength : null,
      disabled: Boolean(field.disabled),
      readOnly: Boolean(field.readOnly),
      context: contextFor(field)
    })).slice(0, 120),
    buttons: [...document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="image"], img[onclick], a[onclick]')].map((button) => ({
      tag: button.tagName.toLowerCase(),
      type: clean(button.getAttribute("type"), 30),
      name: clean(button.getAttribute("name"), 100),
      id: clean(button.id, 100),
      label: clean(button.innerText || button.getAttribute("alt") || button.getAttribute("title") || button.getAttribute("value"), 120)
    })).slice(0, 40),
    frames: [...document.querySelectorAll("iframe")].map((frame) => ({
      name: clean(frame.name, 100),
      id: clean(frame.id, 100),
      title: clean(frame.title, 120),
      src: safeUrl(frame.src)
    })).slice(0, 20)
  };
}

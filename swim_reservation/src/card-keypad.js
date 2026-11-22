import { spawn } from 'node:child_process';
import { cardError } from './card-vault.js';
import { PNG } from 'pngjs';

export function prepareKeyImage(png) {
  const source = PNG.sync.read(png);
  if (source.width > 300 || source.height > 300 || source.width < 10 || source.height < 10) throw cardError('KEYPAD_OCR_FAILED');
  // Tight single-character crops confuse the OCR baseline classifier (notably 9).
  // Preserve antialiasing and provide a white margin; do not guess missing digits.
  const height = 30, width = Math.round(source.width * height / source.height), border = 20;
  const result = new PNG({ width: width + border * 2, height: height + border * 2 }); result.data.fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.floor(x * source.width / width), x1 = Math.max(x0 + 1, Math.floor((x+1) * source.width / width));
    const y0 = Math.floor(y * source.height / height), y1 = Math.max(y0 + 1, Math.floor((y+1) * source.height / height));
    const sum = [0,0,0]; let count = 0;
    for (let sy=y0;sy<y1;sy++) for(let sx=x0;sx<x1;sx++) { const offset=(sy*source.width+sx)*4; for(let c=0;c<3;c++)sum[c]+=source.data[offset+c];count++; }
    const offset=((y+border)*result.width+x+border)*4; for(let c=0;c<3;c++)result.data[offset+c]=Math.round(sum[c]/count); result.data[offset+3]=255;
  }
  try { return PNG.sync.write(result); } finally { source.data.fill(0); result.data.fill(0); }
}

// Local OCR only; key PNGs are never written to disk or sent to a remote model.
export async function recognizeDigit(png, { executable = process.env.TESSERACT_PATH || 'tesseract' } = {}) {
  const prepared = prepareKeyImage(png);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['stdin', 'stdout', '-l', 'eng', '--psm', '10', '--dpi', '300', '-c', 'tessedit_char_whitelist=0123456789'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let size = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); prepared.fill(0); error ? reject(cardError('KEYPAD_OCR_FAILED')) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(true); }, 5000);
    child.on('error', () => finish(true)); child.stdin.on('error', () => finish(true));
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 256) { child.kill('SIGKILL'); finish(true); } else chunks.push(chunk); });
    child.on('close', code => { const value = Buffer.concat(chunks).toString('utf8').trim(); finish(code !== 0 || !/^\d$/.test(value), value); });
    child.stdin.end(prepared);
  });
}
export function digitMap(keys) {
  if (keys.length !== 10 || keys.some(key => !/^\d$/.test(key.digit) || !Number.isFinite(key.x) || !Number.isFinite(key.y)) || new Set(keys.map(key => key.digit)).size !== 10) throw cardError('KEYPAD_AMBIGUOUS');
  return new Map(keys.map(key => [key.digit, { x: key.x, y: key.y }]));
}
export async function inspectKeypad(page, ocr = recognizeDigit) {
  // The visible keyboard image and individual key rectangles, not vendor internals.
  const background = page.locator('img[alt="키패드"][id$="_bg_img"]:visible');
  await background.waitFor({ state: 'visible', timeout: 12000 });
  if (await background.count() !== 1) throw cardError('KEYPAD_AMBIGUOUS');
  const bounds = await background.boundingBox();
  if (!bounds || bounds.width < 200 || bounds.width > 350 || bounds.height < 100 || bounds.height > 200) throw cardError('KEYPAD_AMBIGUOUS');
  const images = page.locator('img[alt="키패드"]:visible');
  const rectangles = await images.evaluateAll((elements, b) => elements.map((element, index) => { const r = element.getBoundingClientRect(); return { index, x: r.x, y: r.y, width: r.width, height: r.height }; }).filter(r => r.width >= 30 && r.width <= 45 && r.height >= 25 && r.height <= 35 && r.x >= b.x && r.x + r.width <= b.x + b.width + 1 && r.y >= b.y + 25 && r.y + r.height <= b.y + 101), bounds);
  if (rectangles.length !== 10) throw cardError('KEYPAD_AMBIGUOUS');
  const keys = [];
  for (const rect of rectangles) {
    // Element screenshots account for page scrolling; viewport rects are only for clicks.
    const image = await images.nth(rect.index).screenshot({ scale: 'device', animations: 'disabled' });
    try { keys.push({ digit: await ocr(image), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }); }
    finally { image.fill(0); }
  }
  return { digits: digitMap(keys), bounds, backgroundId: await background.getAttribute('id'), signature: await images.evaluateAll(elements => elements.map(e => e.currentSrc).join('\n')) };
}
export async function fillKeypad(page, field, value, { ocr = recognizeDigit, beforeTyping } = {}) {
  if (!/^\d+$/.test(value)) throw cardError('CARD_FORMAT');
  await field.click();
  const keyboard = await inspectKeypad(page, ocr);
  if (beforeTyping) await beforeTyping();
  if (!await field.evaluate(element => element.value.length === 0)) throw cardError('FIELD_NOT_EMPTY');
  let previousLength = 0;
  for (const digit of value) {
    // A changing layout must stop, never continue using old coordinates.
    const box = await page.locator('img[alt="키패드"][id$="_bg_img"]:visible').boundingBox();
    if (!box || Math.abs(box.x - keyboard.bounds.x) > 1 || Math.abs(box.y - keyboard.bounds.y) > 1) throw cardError('KEYPAD_MOVED');
    const signature = await page.locator('img[alt="키패드"]:visible').evaluateAll(elements => elements.map(e => e.currentSrc).join('\n'));
    if (signature !== keyboard.signature) throw cardError('KEYPAD_MOVED');
    const point = keyboard.digits.get(digit);
    await page.mouse.click(point.x, point.y);
    const length = await field.evaluate(element => element.value.length);
    if (length <= previousLength) throw cardError('KEYPAD_INPUT_UNVERIFIED');
    previousLength = length;
  }
  // Closing the keyboard does not submit the issuer form. Target its close icon.
  const b = keyboard.bounds;
  const remaining = page.locator('img[alt="키패드"][id$="_bg_img"]:visible');
  if (await remaining.count()) {
    if (await remaining.count() !== 1 || await remaining.getAttribute('id') !== keyboard.backgroundId) throw cardError('KEYPAD_MOVED');
    const current = await remaining.boundingBox();
    if (!current || Math.abs(current.x-b.x)>1 || Math.abs(current.y-b.y)>1) throw cardError('KEYPAD_MOVED');
    await page.mouse.click(b.x + b.width - 13, b.y + 13);
  }
  return { entered: value.length };
}

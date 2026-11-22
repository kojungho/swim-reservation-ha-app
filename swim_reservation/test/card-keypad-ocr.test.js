import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {recognizeDigit} from '../src/card-keypad.js';
const available=spawnSync(process.env.TESSERACT_PATH||'tesseract',['--version'],{stdio:'ignore'}).status===0;
test('local OCR distinguishes all ten synthetic keypad glyphs, including 9',{skip:!available},async()=>{
  for(let digit=0;digit<10;digit++)assert.equal(await recognizeDigit(await readFile(new URL(`./fixtures/keypad/digit-${digit}.png`,import.meta.url))),String(digit));
});

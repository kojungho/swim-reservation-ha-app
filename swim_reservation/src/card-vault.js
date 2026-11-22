import { randomBytes, createCipheriv, createDecipheriv, scrypt as derive } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import path from 'node:path';

const scrypt = promisify(derive);
const AAD = Buffer.from('swim:samsung:review-only:v1');
export const cardError = code => Object.assign(new Error(code), { code });
export function validateCard(input) {
  const cardNumber = String(input.cardNumber || '').replace(/[ -]/g, '');
  const cvc = String(input.cvc || ''), password = String(input.password || '');
  if (!/^\d{15,16}$/.test(cardNumber) || !/^\d{3}$/.test(cvc) || !/^\d{6}$/.test(password)) throw cardError('CARD_FORMAT');
  let sum = 0, double = false;
  for (let i = cardNumber.length - 1; i >= 0; i--) { let n = Number(cardNumber[i]); if (double && (n *= 2) > 9) n -= 9; sum += n; double = !double; }
  if (sum % 10) throw cardError('CARD_FORMAT');
  return { cardNumber, cvc, password };
}
function checkPassphrase(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw cardError('VAULT_PASSPHRASE');
}
async function keyFor(passphrase, salt) {
  checkPassphrase(passphrase);
  return scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
// No key/passphrase file. Backups contain authenticated ciphertext only.
export class CardVault {
  constructor(dataDir) { this.directory = path.join(dataDir, 'card-review-private'); this.file = path.join(this.directory, 'vault.json'); this.busy = false; }
  async status() {
    try { await readFile(this.file); return { configured: true, mode: 'review-only' }; }
    catch (error) { if (error.code === 'ENOENT') return { configured: false, mode: 'review-only' }; throw cardError('VAULT_UNAVAILABLE'); }
  }
  async save(input, passphrase) {
    if (this.busy) throw cardError('VAULT_BUSY');
    this.busy = true; let key, plain;
    try {
      const card = validateCard(input), salt = randomBytes(32), iv = randomBytes(12);
      key = await keyFor(passphrase, salt); plain = Buffer.from(JSON.stringify(card));
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(AAD);
      const data = Buffer.concat([cipher.update(plain), cipher.final()]);
      const envelope = { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
      const temporary = this.file + '.' + randomBytes(8).toString('hex');
      try { await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' }); await rename(temporary, this.file); }
      finally { await unlink(temporary).catch(() => {}); }
      return this.status();
    } finally { key?.fill(0); plain?.fill(0); this.busy = false; }
  }
  async open(passphrase) {
    let key, plain;
    try {
      checkPassphrase(passphrase);
      const raw = await readFile(this.file, 'utf8');
      if (raw.length > 4096) throw cardError('VAULT_OPEN_FAILED');
      const box = JSON.parse(raw), salt = Buffer.from(box.salt, 'base64'), iv = Buffer.from(box.iv, 'base64'), tag = Buffer.from(box.tag, 'base64');
      if (box.version !== 1 || salt.length !== 32 || iv.length !== 12 || tag.length !== 16) throw cardError('VAULT_OPEN_FAILED');
      key = await keyFor(passphrase, salt);
      const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(AAD); decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
      return validateCard(JSON.parse(plain.toString('utf8')));
    } catch { throw cardError('VAULT_OPEN_FAILED'); }
    finally { key?.fill(0); plain?.fill(0); }
  }
  async remove() { if (this.busy) throw cardError('VAULT_BUSY'); await unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw cardError('VAULT_UNAVAILABLE'); }); return this.status(); }
}

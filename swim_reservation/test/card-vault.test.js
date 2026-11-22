import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CardVault, validateCard } from '../src/card-vault.js';

const synthetic = { cardNumber: '378282246310005', cvc: '123', password: '123456' };
const passphrase = 'local-test-passphrase-only';
test('vault persists authenticated ciphertext only and round trips all three values', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'swim-card-vault-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const vault = new CardVault(dir); assert.equal((await vault.status()).configured,false);
  await vault.save(synthetic, passphrase);
  const saved = await readFile(vault.file,'utf8');
  for (const value of [synthetic.cardNumber, synthetic.password, passphrase]) assert.equal(saved.includes(value),false);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(),['data','iv','salt','tag','version']);
  assert.deepEqual(await vault.open(passphrase),synthetic);
  assert.deepEqual(await vault.status(),{configured:true,mode:'review-only'});
  assert.equal((await stat(vault.file)).mode&0o777,0o600); assert.equal((await stat(vault.directory)).mode&0o777,0o700);
  assert.deepEqual(await readdir(vault.directory),['vault.json']);
  await vault.remove(); assert.equal((await vault.status()).configured,false);
});
test('wrong password, ciphertext modification and short passphrase fail closed',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'swim-card-vault-'));t.after(()=>rm(dir,{recursive:true,force:true}));const vault=new CardVault(dir);
  await assert.rejects(vault.save(synthetic,'short'),{code:'VAULT_PASSPHRASE'});
  await vault.save(synthetic,passphrase);
  await assert.rejects(vault.open('wrong-long-passphrase'),{code:'VAULT_OPEN_FAILED'});
  const box=JSON.parse(await readFile(vault.file,'utf8'));const data=Buffer.from(box.data,'base64');data[0]^=1;box.data=data.toString('base64');await writeFile(vault.file,JSON.stringify(box));
  await assert.rejects(vault.open(passphrase),{code:'VAULT_OPEN_FAILED'});
});
test('invalid values never reach storage and PAN separators are normalized',()=>{
  assert.deepEqual(validateCard({...synthetic,cardNumber:'3782 822463 10005'}),synthetic);
  for(const patch of [{cardNumber:'378282246310006'},{cvc:'12'},{password:'abcdef'},{password:'12345'}]) assert.throws(()=>validateCard({...synthetic,...patch}),{code:'CARD_FORMAT'});
});

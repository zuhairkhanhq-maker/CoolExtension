import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
test('Configured package pins public key, disables trial fallback, excludes checkout hosts and rejects private keys/overwrite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bypass-build-')),keyPath=join(dir,'public.json'),output=join(dir,'extension');
  const pair=generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'test'};
  await writeFile(keyPath,JSON.stringify(jwk));
  const script=new URL('../scripts/configure-extension.js',import.meta.url);
  execFileSync(process.execPath,[script.pathname,'https://billing.test',keyPath,output]);
  const cfg=await readFile(join(output,'core/billing-config.js'),'utf8'),manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  assert.match(cfg,/"enabled":true/);assert.ok(!cfg.includes('"d":'));assert.ok(manifest.content_scripts[0].exclude_matches.includes('https://billing.test/*'));assert.equal(manifest.version,'0.8.0');
  assert.throws(()=>execFileSync(process.execPath,[script.pathname,'https://billing.test',keyPath,output],{stdio:'pipe'}));
  await writeFile(keyPath,JSON.stringify({...pair.privateKey.export({format:'jwk'}),kid:'test'}));
  assert.throws(()=>execFileSync(process.execPath,[script.pathname,'https://billing.test',keyPath,join(dir,'unsafe')],{stdio:'pipe'}));
});

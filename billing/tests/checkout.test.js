import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/checkout.js',import.meta.url),'utf8');
test('Hosted payment link initializes once, lets Paddle auto-open _ptxn, and locks customer selection',async()=>{
  const status={textContent:''};let initialized=0,options;
  await vm.runInNewContext(source,{document:{getElementById:()=>status},location:{href:'https://billing.test/checkout?_ptxn=txn_'+'a'.repeat(26)},URL,fetch:async()=>({ok:true,json:async()=>({environment:'sandbox',token:'public-token'})}),Paddle:{Environment:{set:mode=>assert.equal(mode,'sandbox')},Initialize:value=>{initialized++;options=value;},Checkout:{open:()=>{throw Error('Must not double-open an automatic payment link.');}}}});
  assert.equal(initialized,1);assert.equal(options.checkout.settings.allowLogout,false);
  options.eventCallback({name:'checkout.completed'});assert.match(status.textContent,/Verification/);
});
test('Malformed transaction links never initialize checkout',async()=>{
  let initialized=0;const status={};
  await vm.runInNewContext(source,{document:{getElementById:()=>status},location:{href:'https://billing.test/checkout?_ptxn=bad'},URL,fetch:async()=>({ok:true,json:async()=>({})}),Paddle:{Initialize:()=>initialized++}});
  assert.equal(initialized,0);assert.match(status.textContent,/could not load/);
});

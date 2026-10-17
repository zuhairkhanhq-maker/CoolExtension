import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('Broken billing configuration fails Pro closed without disabling Free setting writes',async()=>{
  const source=await readFile(new URL('../../Bypass-Extension/background/service-worker.js',import.meta.url),'utf8');
  const listeners=[],values={};let proImported=false;
  const chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:fn=>listeners.push(fn)},onInstalled:{addListener:()=>{}}},storage:{local:{get:async()=>values,set:async v=>Object.assign(values,v)}}};
  const context=vm.createContext({chrome,setTimeout,clearTimeout,console,importScripts:(...files)=>{if(files.includes('billing.js'))throw Error('Invalid billing config');if(files.includes('pro-worker.js'))proImported=true;}});
  vm.runInContext(source,context);assert.equal(proImported,true);assert.equal((await context.BypassBilling.status()).active,false);
  const reply=await new Promise(resolve=>{for(const listener of listeners)listener({type:'setting',host:'example.com',key:'paused',value:true},{id:'fixture',url:'chrome-extension://fixture/ui/popup.html'},resolve);});
  assert.equal(reply.ok,true);assert.equal(values['site:example.com'].paused,true);
});

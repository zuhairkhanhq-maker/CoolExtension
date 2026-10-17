const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const results = [];
const clone = value => structuredClone(value);
let data = {}, session = {}, writes = 0, focused = true, clock = Date.now();
const listeners = [], alarmListeners = [], alarms = new Map(), messages = [];
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
function boot() {
  listeners.length = alarmListeners.length = 0;
  const store = (target, count = false) => ({get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => Object.hasOwn(target,k)).map(k=>[k,clone(target[k])])),set: async values => { if(count) writes++;Object.assign(target,clone(values)); }});
  const chrome = {
    storage:{local:store(data,true),session:store(session)},
    runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:{addListener:f=>listeners.push(f)},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}},
    tabs:{query:async opts => opts.active ? [{id:1,windowId:1}] : [{id:1}],sendMessage:async (id,m) => {messages.push(m);}},
    windows:{get:async () => ({focused})},
    alarms:{get:async n=>alarms.get(n),create:async (n,a)=>alarms.set(n,a),onAlarm:{addListener:f=>alarmListeners.push(f)}}
  };
  const context = vm.createContext({chrome,URL,Date:Clock,setTimeout,clearTimeout,console});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'core/pro-model.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'background/pro-worker.js'),'utf8'),context);
  return context.BypassProModel;
}
let M = boot();
const internal = {id:'test',url:'chrome-extension://test/ui/popup.html'};
const content = {id:'test',url:'https://fixture.test/path',frameId:0,tab:{id:1}};
function request(type, extra = {}, sender = internal) {
  if (type === 'pro-save' && extra.revision === undefined) extra = {...extra,revision:data.proRevision || 0};
  return new Promise(resolve => { const accepted=listeners[0]({type,...extra},sender,resolve); if(accepted !== true) resolve(undefined); });
}
async function test(name,fn) { const start=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);} }
(async()=>{
  await test('Sender checks reject page, iframe and content trial/config mutations',async()=>{
    assert.equal(await request('pro-trial',{},content),undefined);
    assert.equal(await request('pro-get',{}, {...content,frameId:1}),undefined);
    assert.equal(await request('pro-get',{}, {...internal,id:'other'}),undefined);
    assert.equal(await request('pro-save',{config:{}},content),undefined);
  });
  await test('Concurrent trial starts serialize; only one succeeds',async()=>{
    const response=await Promise.all([request('pro-trial'),request('pro-trial')]);
    assert.equal(response.filter(r=>r.ok).length,1);assert.equal(data.proLicense.startedAt,clock);
  });
  let config={mode:'work',rules:[],schedules:[],limits:[{host:'fixture.test',minutes:1}]};
  await test('Config validates bounds and invalid saves preserve last good value',async()=>{
    assert.equal((await request('pro-save',{config})).ok,true);
    assert.equal((await request('pro-save',{config:{...config,limits:[{host:'fixture.test',minutes:0}]}})).ok,false);
    assert.equal(data.proConfig.limits[0].minutes,1);
    assert.throws(()=>M.validate({...config,schedules:[{mode:'study',start:0,end:0,days:[1]}]}));
    assert.throws(()=>M.validate({...config,rules:[{host:'fixture.test',kind:'skip',selector:'button',action:'buy'}]}));
  });
  await test('Stale configuration writes cannot overwrite another window',async()=>{
    const result = await request('pro-save',{config,revision:0});assert.equal(result.ok,false);assert.match(result.error,/another window/);
  });
  await test('Rules bind to sender hostname rather than supplied host',async()=>{
    const result=await request('pro-add-rule',{rule:{host:'evil.test',kind:'hide',selector:'#x'}},content);
    assert.equal(result.ok,true);assert.equal(data.proConfig.rules[0].host,'fixture.test');
    await request('pro-add-rule',{rule:{kind:'hide',selector:'#x'}},content);
    assert.equal(data.proConfig.rules.length,1);
  });
  await test('100 simultaneous metrics batch into one storage write without drops',async()=>{
    const before=writes;
    const responses=await Promise.all(Array.from({length:100},()=>request('pro-event',{key:'hidden'},content)));
    assert.ok(responses.every(r=>r.ok));assert.equal(data.proProgress.hidden,100);assert.equal(writes-before,1);
  });
  await test('Only focused active top-frame usage counts, and sleep gaps are capped',async()=>{
    await request('pro-tick',{visible:true},content);
    clock+=15000;await request('pro-tick',{visible:true},content);assert.equal(data.proUsage.hosts['fixture.test'],15);
    clock+=3600000;await request('pro-tick',{visible:true},content);assert.equal(data.proUsage.hosts['fixture.test'],35);
    focused=false;clock+=15000;await request('pro-tick',{visible:true},content);assert.equal(data.proUsage.hosts['fixture.test'],35);focused=true;
    clock+=15000;await request('pro-tick',{visible:true},{...content,tab:{id:2}});assert.equal(data.proUsage.hosts['fixture.test'],35);
  });
  await test('Worker cold start recovers config, trial and counters from storage',async()=>{
    M=boot();const result=await request('pro-get');assert.equal(result.state.active,true);assert.equal(result.state.config.mode,'work');assert.equal(result.state.progress.hidden,100);
    assert.equal(alarms.get('pro-reconcile').periodInMinutes,1);
  });
  await test('Local midnight resets usage without erasing all-time progress',async()=>{
    data.proUsage.day='old-day';const result=await request('pro-get');assert.equal(Object.keys(result.state.usage).length,0);assert.equal(result.state.progress.hidden,100);
  });
  await test('Overnight schedules and overlapping precedence are deterministic',()=>{
    const c={mode:'relax',schedules:[{mode:'study',start:1320,end:120,days:[1]}]};
    assert.equal(M.effectiveMode(c,new Date(2026,9,19,23)),'study');assert.equal(M.effectiveMode(c,new Date(2026,9,20,1)),'study');assert.equal(M.effectiveMode(c,new Date(2026,9,20,2)),'relax');
    c.schedules.push({mode:'work',start:0,end:120,days:[2]});assert.equal(M.effectiveMode(c,new Date(2026,9,20,1)),'work');
  });
  await test('Expired trial refuses Pro but retains saved rules and free site choices',async()=>{
    data['site:fixture.test']={cookies:true,video:true};clock=data.proLicense.startedAt+604800000;
    assert.equal((await request('pro-get')).state.active,false);assert.equal((await request('pro-save',{config})).ok,false);
    assert.equal(data['site:fixture.test'].cookies,true);assert.equal(data.proConfig.rules.length,1);
  });
  await test('Clock rollback and malformed license never grant access',()=>{
    assert.equal(M.access({kind:'local-trial',startedAt:clock,lastSeen:clock+600000},clock),false);assert.equal(M.access({kind:'paid'},clock),false);
  });
  fs.writeFileSync(path.join(__dirname,'pro-worker-results.json'),JSON.stringify(results,null,2));
  console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
})();

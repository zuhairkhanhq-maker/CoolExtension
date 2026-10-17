const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const sandbox = { URL, Date };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'core/pro-model.js'), 'utf8'), sandbox);
const M = sandbox.BypassProModel;
const results = [];
async function test(name, fn) { const start = Date.now(); try { await fn(); results.push({ name, pass: true, ms: Date.now() - start }); console.log('PASS', name); } catch(e) { results.push({ name, pass: false, error: e.stack }); console.error('FAIL', name, e.message); } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await test('Model validates bounds and rejects malformed limits/rules', () => {
    assert.throws(() => M.validate({ mode: 'work', rules: [], schedules: [], limits: [{host:'youtube.com/path',minutes:5}] }));
    assert.throws(() => M.validate({ mode: 'study', rules: [], schedules: [{mode:'study',start:1,end:1,days:[1]}], limits: [] }));
    assert.throws(() => M.validate({ mode: 'off', rules: [{host:'example.com',kind:'skip',selector:'#x',action:'buy'}], schedules:[],limits:[] }));
  });
  await test('Overnight schedules, end boundaries and manual fallback', () => {
    const config = { mode: 'relax', schedules: [{mode:'study',start:1320,end:120,days:[1]}] };
    assert.equal(M.effectiveMode(config, new Date(2026,9,19,23)), 'study');
    assert.equal(M.effectiveMode(config, new Date(2026,9,20,1)), 'study');
    assert.equal(M.effectiveMode(config, new Date(2026,9,20,2)), 'relax');
    assert.equal(M.effectiveMode(config, new Date(2026,9,21,1)), 'relax');
  });
  await test('Trial expires exactly, rejects clock rollback and invalid license', () => {
    const now = Date.now(), l = {kind:'local-trial',startedAt:now,lastSeen:now};
    assert.equal(M.access(l,now),true); assert.equal(M.access(l,now+604800000),false);
    assert.equal(M.access({...l,lastSeen:now+600000},now),false); assert.equal(M.access({},now),false);
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bypass-pro-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-sandbox'] });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ui = await context.newPage();
  const browserErrors = [];
  context.on('page', p => p.on('pageerror', e => browserErrors.push(e.message)));
  ui.on('pageerror', e => browserErrors.push(e.message));
  await ui.goto(`chrome-extension://${id}/ui/popup.html?pro=1`);
  await ui.locator('#pro-trial').waitFor();
  const request = (type, extra = {}) => ui.evaluate(async ({type,extra}) => {
    if (type === 'pro-save') extra.revision = (await chrome.runtime.sendMessage({type:'pro-get'})).state.revision;
    return chrome.runtime.sendMessage({type,...extra});
  }, {type,extra});
  let page;
  await context.route('https://fixture.test/**', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main><h1>Main content</h1></main><div id="distraction" style="height:50px;width:180px">Promoted clutter</div><form><button id="pay">Pay now</button><input id="email"></form><button id="fake">Skip Intro</button><video></video></body></html>'}));
  await context.route('https://fixture.test/player.webm', route => route.fulfill({contentType:'video/webm',body:fs.readFileSync(path.join(__dirname,'fixtures/player.webm'))}));
  await test('Real MV3 trial starts once and UI unlocks', async () => {
    await ui.locator('#pro-trial').click();
    await ui.waitForFunction(() => !document.getElementById('pro-controls').disabled);
    assert.equal((await request('pro-get')).state.active,true);
    assert.equal((await request('pro-trial')).ok,false);
  });
  await test('Pro controls save modes, schedules and website limits through the UI', async () => {
    await ui.locator('[data-mode="study"]').click();
    await ui.waitForFunction(() => document.getElementById('pro-mode-status').textContent.includes('study'));
    await ui.locator('#pro-start').fill('03:00');await ui.locator('#pro-end').fill('04:00');
    await ui.locator('#pro-schedule-form button').click();
    await ui.waitForFunction(() => document.querySelectorAll('#pro-schedules li').length===1);
    await ui.locator('#pro-schedules button').click();
    await ui.waitForFunction(() => document.querySelectorAll('#pro-schedules li').length===0);
    await ui.locator('#pro-limit-host').fill('fixture.test');await ui.locator('#pro-limit-minutes').fill('10');
    await ui.locator('#pro-limit-form button').click();
    await ui.waitForFunction(() => document.querySelectorAll('#pro-limits li').length===1);
    await ui.locator('#pro-limits button').click();
    await ui.waitForFunction(() => document.querySelectorAll('#pro-limits li').length===0);
    const s=(await request('pro-get')).state;assert.equal(s.config.mode,'study');assert.equal(s.config.schedules.length,0);assert.equal(s.config.limits.length,0);
  });
  await test('Installed Pro UI has no horizontal overflow and passes automated accessibility rules',async()=>{
    await ui.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
    const report=await ui.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    assert.deepEqual(report.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
    assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await ui.screenshot({path:path.join(__dirname,'pro-full-preview.png'),fullPage:true});
  });
  let config = {mode:'work',rules:[{host:'fixture.test',kind:'hide',selector:'#distraction'},{host:'fixture.test',kind:'hide',selector:'main'},{host:'fixture.test',kind:'hide',selector:'form'}],schedules:[],limits:[]};
  await test('Real DOM hides only selected safe element; forms/main preserved', async () => {
    assert.equal((await request('pro-save',{config})).ok,true);
    page = await context.newPage(); await page.goto('https://fixture.test/');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'none');
    assert.equal(await page.locator('main').isVisible(),true);
    assert.equal(await page.locator('form').isVisible(),true);
  });
  await test('Dynamic nodes handled and rule removal restores original display', async () => {
    await page.evaluate(() => { document.getElementById('distraction').remove(); const d=document.createElement('div');d.id='distraction';d.style.cssText='display:flex;width:180px;height:50px';d.textContent='New clutter';document.body.append(d); });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'none');
    config.rules=[]; await request('pro-save',{config});
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'flex');
  });
  await test('Site pause restores selected elements, resume re-applies', async () => {
    config.rules=[{host:'fixture.test',kind:'hide',selector:'#distraction'}]; await request('pro-save',{config});
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'none');
    await ui.evaluate(() => chrome.storage.local.set({'site:fixture.test':{paused:true}}));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'flex');
    await ui.evaluate(() => chrome.storage.local.set({'site:fixture.test':{paused:false}}));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'none');
  });
  await test('Custom media rule never clicks a fake button without playing media', async () => {
    await page.evaluate(() => { globalThis.clicks=0; document.getElementById('fake').addEventListener('click',()=>globalThis.clicks++); });
    config.rules=[{host:'fixture.test',kind:'skip',selector:'#fake',action:'intro'}];await request('pro-save',{config});
    await sleep(500); assert.equal(await page.evaluate(()=>globalThis.clicks),0);
  });
  await test('Custom media uses native playing video, attempts one click, and rejects purchase labels',async()=>{
    await page.evaluate(async()=>{const v=document.querySelector('video');v.muted=true;v.src='/player.webm';await v.play();});
    await page.waitForFunction(()=>Number.isFinite(document.querySelector('video').duration));
    await request('pro-save',{config:{...config,mode:'study'}});
    await page.waitForFunction(()=>globalThis.clicks===1);
    await sleep(500);assert.equal(await page.evaluate(()=>globalThis.clicks),1);
    await page.evaluate(()=>{document.getElementById('fake').textContent='Buy now';});
    await request('pro-save',{config:{...config,mode:'work'}});
    await sleep(500);assert.equal(await page.evaluate(()=>globalThis.clicks),1);
  });
  await test('Sensitive checkout path remains untouched', async () => {
    config.rules=[{host:'fixture.test',kind:'hide',selector:'#distraction'}];await request('pro-save',{config});
    await page.goto('https://fixture.test/checkout'); await sleep(500);
    assert.equal(await page.locator('#distraction').isVisible(),true);
  });
  await test('Expired trial restores page and denies further Pro saves', async () => {
    await page.goto('https://fixture.test/');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display === 'none');
    await ui.evaluate(async () => { await chrome.storage.local.set({proLicense:{kind:'local-trial',startedAt:Date.now()-604800001,lastSeen:Date.now()}}); const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); });
    const expired = await request('pro-get'); assert.equal(expired.state.active,false);
    await worker.evaluate(async state => { const tabs=await chrome.tabs.query({});for(const tab of tabs) await chrome.tabs.sendMessage(tab.id,{type:'pro-state',state}).catch(()=>{}); }, expired.state);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('distraction')).display !== 'none');
    assert.equal((await request('pro-save',{config})).ok,false);
  });
  await test('Installed extension flow has no uncaught page errors',()=>assert.deepEqual(browserErrors,[]));
  await context.close();
  fs.writeFileSync(path.join(__dirname,'pro-results.json'),JSON.stringify(results,null,2));
  console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);
  if(results.some(r=>!r.pass)) process.exitCode=1;
})().catch(e => {
  console.error(e);
  results.push({name:'Real-browser extension integration',pass:false,status:'BLOCKED',error:e.message});
  fs.writeFileSync(path.join(__dirname,'pro-results.json'),JSON.stringify(results,null,2));
  process.exitCode=1;
});

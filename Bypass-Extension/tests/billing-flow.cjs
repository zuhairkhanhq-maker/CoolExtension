const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {generateKeyPairSync,randomUUID,randomBytes,sign}=require('node:crypto');
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);}}
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bypass-billing-')),extension=path.join(temp,'extension');
  fs.cpSync(path.resolve(__dirname,'..'),extension,{recursive:true});
  const pair=generateKeyPairSync('ec',{namedCurve:'P-256'}),publicKey={...pair.publicKey.export({format:'jwk'}),kid:'fixture'};
  fs.writeFileSync(path.join(extension,'core/billing-config.js'),`globalThis.BypassBillingConfig=${JSON.stringify({enabled:true,apiOrigin:'https://billing.fixture',publicKeys:[publicKey]})};`);
  const context=await chromium.launchPersistentContext(path.join(temp,'profile'),{headless:true,channel:'chromium',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-sandbox']});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).hostname;
  let device,plan='free',forged=false,online=true,checkoutCount=0;
  function grant(){const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'ES256',typ:'JWT',kid:'fixture'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'https://billing.fixture',aud:'bypass-pro',device,sub:randomUUID(),plan,iat:now,exp:now+3600})).toString('base64url');const input=`${header}.${body}`;return `${input}.${sign('sha256',Buffer.from(input),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;}
  // Service-worker fetch is intercepted by Playwright's worker CDP session below.
  const session=await context.newCDPSession(await context.newPage());await session.detach();
  const originalFetch=`globalThis.__billingFixture={plan:'free',device:null,forged:false,online:true,checkouts:0};globalThis.fetch=async(url,init)=>{const f=globalThis.__billingFixture;if(!f.online)throw Error('offline');const body=JSON.parse(init.body);const p=new URL(url).pathname;let data={};if(p==='/v1/auth/start'){f.device=body.deviceId;data={challengeId:'${randomUUID()}'};}else if(p==='/v1/auth/verify'){data={session:'${randomBytes(32).toString('base64url')}'};}else if(p==='/v1/checkout'){f.checkouts++;data={url:'https://billing.fixture/checkout?_ptxn=txn_${'a'.repeat(26)}'};}else if(p==='/v1/portal'){data={url:'https://customer-portal.paddle.com/example'};}else if(p==='/v1/trial'||p==='/v1/entitlement'){if(p==='/v1/trial')f.plan='trial';data={token:f.token,email:'qa@example.test',plan:f.plan,status:f.plan==='free'?'free':'active',trialUsed:f.plan!=='free',accessUntil:Date.now()+3600000};}return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};`;
  await worker.evaluate(originalFetch);
  await context.route('https://billing.fixture/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture checkout</title><p>Checkout fixture. No actual payment.</p>'}));
  const ui=await context.newPage();await ui.goto(`chrome-extension://${extensionId}/ui/popup.html?pro=1`);await ui.locator('#billing-login').waitFor();
  const send=(type,extra={})=>ui.evaluate(async({type,extra})=>chrome.runtime.sendMessage({type,...extra}),{type,extra});
  async function issue(p){plan=p;device=await worker.evaluate(()=>globalThis.__billingFixture.device);const token=grant();await worker.evaluate(({token,p})=>{globalThis.__billingFixture.token=token;globalThis.__billingFixture.plan=p;},{token,p});}
  await test('Configured build never unlocks from a forged local trial record',async()=>{
    await ui.evaluate(()=>chrome.storage.local.set({proLicense:{kind:'local-trial',startedAt:Date.now(),lastSeen:Date.now()}}));
    assert.equal((await send('pro-get')).state.active,false);assert.equal((await send('pro-trial')).ok,false);
  });
  await test('Email sign-in stores session privately and verifies a signed Free grant',async()=>{
    await ui.locator('#billing-email').fill('qa@example.test');await ui.locator('#billing-login button').click();
    await ui.locator('#billing-code').waitFor();await issue('free');
    await ui.locator('#billing-code').fill('123456');await ui.locator('#billing-code-form button').click();
    await ui.waitForFunction(()=>document.getElementById('billing-account').textContent.includes('qa@example.test'));
    const data=await ui.evaluate(()=>chrome.storage.local.get(null));assert.ok(!JSON.stringify(data).includes('qa@example.test'));
    assert.equal((await send('pro-get')).state.active,false);
  });
  await test('Server-issued trial unlocks the real Pro controls',async()=>{
    await issue('trial');await ui.locator('#pro-trial').click();await ui.waitForFunction(()=>!document.getElementById('pro-controls').disabled);
    assert.equal((await send('pro-get')).state.plan,'trial');
  });
  await test('Checkout does not grant paid access; only a verified paid refresh does',async()=>{
    await ui.locator('#billing-buy').click();await ui.waitForTimeout(200);
    assert.equal((await send('pro-get')).state.plan,'trial');assert.equal(await worker.evaluate(()=>globalThis.__billingFixture.checkouts),1);
    await issue('pro');await ui.locator('#billing-refresh').click();
    await ui.waitForFunction(()=>document.getElementById('footer-plan').textContent==='Plan: Pro');
  });
  await test('Tampered grant is rejected and transient outage retains only existing signed access',async()=>{
    await worker.evaluate(()=>{globalThis.__billingFixture.token='bad.token.signature';});
    assert.equal((await send('billing-refresh')).ok,false);assert.equal((await send('pro-get')).state.active,true);
    await worker.evaluate(()=>{globalThis.__billingFixture.online=false;});assert.equal((await send('billing-refresh')).ok,false);assert.equal((await send('pro-get')).state.active,true);
    await worker.evaluate(()=>{globalThis.__billingFixture.online=true;});
  });
  await test('Signed billing UI passes automated accessibility and sign-out restores Free',async()=>{
    await ui.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
    const audit=await ui.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));assert.deepEqual(audit.violations.map(v=>v.id),[]);
    await ui.locator('#billing-actions details summary').click();await ui.locator('#billing-logout').click();
    await ui.waitForFunction(()=>document.getElementById('footer-plan').textContent==='Plan: Free');assert.equal((await send('pro-get')).state.active,false);
  });
  await test('No uncaught extension UI errors',()=>assert.deepEqual(errors,[]));
  await context.close();fs.writeFileSync(path.join(__dirname,'billing-results.json'),JSON.stringify(results,null,2));
  if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});

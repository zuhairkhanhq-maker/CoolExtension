import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,randomUUID,createHmac} from 'node:crypto';
import pg from 'pg';
import {Billing} from '../src/service.js';
import {enqueue,runOne,syncSubscription,processEntity} from '../src/jobs.js';
import {server} from '../src/http.js';
import {verifyGrant} from '../src/security.js';
const enabled=!!process.env.DATABASE_URL;
const integration=(name,fn)=>test(name,{skip:!enabled},fn);
let pool,billing,mail,provider,cfg,sub,created=0;
const id=prefix=>`${prefix}_${'a'.repeat(26)}`;
before(async()=>{
  if(!enabled)return;
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:15});
  await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  cfg={privateJwk:generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'}),keyId:'test',origin:'https://billing.test',hmac:'x'.repeat(48),sessionDays:30,grantSeconds:3600,graceHours:72,prices:{monthly:id('pri'),annual:`pri_${'b'.repeat(26)}`},checkoutOrigin:'https://billing.test',extensionOrigins:['chrome-extension://'+'a'.repeat(32)],proxyHops:0,webhookSecret:'webhook-secret',mailFrom:'test@example.test',mode:'sandbox',clientToken:'test'};
});
beforeEach(async()=>{
  if(!enabled)return;
  await pool.query('TRUNCATE accounts,rate_limits,webhook_jobs,adjustments,checkout_intents CASCADE');created=0;mail=[];
  provider={call:async(path,method,body)=>{
    if(path==='/customers')return {data:{id:id('ctm')}};
    if(path==='/transactions'){created++;await new Promise(r=>setTimeout(r,20));return {data:{id:id('txn'),checkout:{url:'https://billing.test/checkout?_ptxn='+id('txn')}}};}
    if(path.endsWith('/portal-sessions'))return {data:{urls:{general:{overview:'https://customer-portal.paddle.com/example'}}}};
    if(method==='PATCH')return {data:{status:'canceled'}};
    throw Error('Unexpected API '+path);
  },get:async(path)=>{if(path.startsWith('/subscriptions/'))return sub;throw Error('Unexpected API '+path);},list:async()=>[]};
  billing=new Billing(pool,cfg,provider,{sendMail:async message=>mail.push(message)});
});
after(async()=>{if(pool)await pool.end();});
async function login(email='qa@example.test'){
  const device=randomUUID(),challenge=await billing.startAuth(email,device,'127.0.0.1');
  const code=mail.at(-1).text.match(/\b\d{6}\b/)[0];
  const result=await billing.verifyAuth(challenge.challengeId,code,device,'127.0.0.1');
  return {session:await billing.authenticate(result.session),token:result.session,device,challenge,code};
}
integration('OTP is single-use, device-bound and failed attempts persist',async()=>{
  const a=await login();await assert.rejects(()=>billing.verifyAuth(a.challenge.challengeId,a.code,a.device,'127.0.0.1'),/invalid/);
  const next=await billing.startAuth('other@example.test',a.device,'127.0.0.1');
  const actual=mail.at(-1).text.match(/\b\d{6}\b/)[0],wrong=actual==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)await assert.rejects(()=>billing.verifyAuth(next.challengeId,wrong,a.device,'127.0.0.1'));
  const row=(await pool.query('SELECT attempts FROM challenges WHERE id=$1',[next.challengeId])).rows[0];assert.equal(row.attempts,5);
  await assert.rejects(()=>billing.verifyAuth(next.challengeId,actual,a.device,'127.0.0.1'));
});
integration('20 concurrent trial starts grant only once; signed entitlement is account/device scoped',async()=>{
  const a=await login();const trials=await Promise.allSettled(Array.from({length:20},()=>billing.trial(a.session)));
  assert.equal(trials.filter(x=>x.status==='fulfilled').length,1);
  const grant=await billing.entitlement(a.session);assert.equal(verifyGrant(grant.token,billing.signer.publicJwk,cfg.origin,a.device).plan,'trial');
  assert.equal(verifyGrant(grant.token,billing.signer.publicJwk,cfg.origin,randomUUID()),null);
});
integration('Concurrent checkout requests create one provider transaction and reuse its URL',async()=>{
  const a=await login();const results=await Promise.allSettled(Array.from({length:12},()=>billing.checkout(a.session,'monthly')));
  assert.equal(created,1);assert.ok(results.some(r=>r.status==='fulfilled'));
  assert.equal((await billing.checkout(a.session,'monthly')).url,'https://billing.test/checkout?_ptxn='+id('txn'));
  await assert.rejects(()=>billing.checkout(a.session,'annual'),/Discard/);
});
integration('Ambiguous provider timeout is never blindly retried as another purchase',async()=>{
  const a=await login();await pool.query('INSERT INTO billing_customers(account_id,customer_id) VALUES($1,$2)',[a.session.account_id,id('ctm')]);provider.call=async()=>{created++;throw Error('timeout');};
  await assert.rejects(()=>billing.checkout(a.session,'monthly'));
  await assert.rejects(()=>billing.checkout(a.session,'monthly'),/confirmation/);assert.equal(created,1);
});
integration('100 duplicate webhook deliveries persist one job and do not grant from event body',async()=>{
  const event={event_id:id('evt'),event_type:'subscription.activated',occurred_at:new Date().toISOString(),data:{id:id('sub'),status:'active'}};
  await Promise.all(Array.from({length:100},()=>enqueue(pool,event)));
  assert.equal((await pool.query('SELECT count(*) FROM webhook_jobs')).rows[0].count,'1');
  assert.equal((await pool.query('SELECT count(*) FROM subscriptions')).rows[0].count,'0');
});
integration('Out-of-order canonical updates cannot regress stored subscription or change account ownership',async()=>{
  const a=await login();const now=Date.now();sub={id:id('sub'),custom_data:{account_id:a.session.account_id},customer_id:id('ctm'),status:'active',updated_at:new Date(now).toISOString(),current_billing_period:{starts_at:new Date(now-10000).toISOString(),ends_at:new Date(now+86400000).toISOString()},items:[{status:'active',price:{id:cfg.prices.monthly}}]};
  await pool.query('INSERT INTO billing_customers(account_id,customer_id) VALUES($1,$2)',[a.session.account_id,id('ctm')]);
  await syncSubscription(pool,cfg,provider,sub.id);
  sub={...sub,status:'canceled',updated_at:new Date(now-1000).toISOString()};await syncSubscription(pool,cfg,provider,sub.id);
  assert.equal((await billing.entitlement(a.session)).plan,'pro');
  sub={...sub,status:'active',updated_at:new Date(now+1000).toISOString(),custom_data:{account_id:randomUUID()}};await assert.rejects(()=>syncSubscription(pool,cfg,provider,sub.id));
});
integration('Two workers claim one job once; expired leases recover and failures schedule bounded retries',async()=>{
  const a=await login();const now=Date.now();sub={id:id('sub'),custom_data:{account_id:a.session.account_id},customer_id:id('ctm'),status:'active',updated_at:new Date(now).toISOString(),current_billing_period:{starts_at:new Date(now-1000).toISOString(),ends_at:new Date(now+1000000).toISOString()},items:[{price:{id:cfg.prices.monthly}}]};
  await pool.query('INSERT INTO billing_customers(account_id,customer_id) VALUES($1,$2)',[a.session.account_id,id('ctm')]);
  await enqueue(pool,{event_id:id('evt'),event_type:'subscription.updated',occurred_at:new Date().toISOString(),data:{id:sub.id}});
  const results=await Promise.all([runOne(pool,cfg,provider),runOne(pool,cfg,provider)]);assert.equal(results.filter(Boolean).length,1);
  await pool.query("UPDATE webhook_jobs SET state='processing',lease_until=now()-interval '1 minute'");provider.get=async()=>{throw Error('down');};
  assert.equal(await runOne(pool,cfg,provider),true);const job=(await pool.query('SELECT * FROM webhook_jobs')).rows[0];assert.equal(job.state,'pending');assert.equal(job.error_code,'processing_failed');
});
integration('HTTP rejects untrusted origins and unsigned webhooks; signed retries ACK idempotently',async()=>{
  const app=server(billing);await new Promise(r=>app.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${app.address().port}`;
  try{
    assert.equal((await fetch(url+'/v1/auth/start',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'})).status,403);
    const event={event_id:id('evt'),event_type:'subscription.updated',occurred_at:new Date().toISOString(),data:{id:id('sub')}};const raw=JSON.stringify(event);
    assert.equal((await fetch(url+'/webhooks/paddle',{method:'POST',body:raw})).status,401);
    const ts=Math.floor(Date.now()/1000),sig=createHmac('sha256',cfg.webhookSecret).update(`${ts}:${raw}`).digest('hex');
    for(let i=0;i<2;i++)assert.equal((await fetch(url+'/webhooks/paddle',{method:'POST',headers:{'Paddle-Signature':`ts=${ts};h1=${sig}`},body:raw})).status,200);
    assert.equal((await pool.query('SELECT count(*) FROM webhook_jobs')).rows[0].count,'1');
  }finally{await new Promise(r=>app.close(r));}
});
integration('Session revocation and portal ownership do not trust a client-supplied customer ID',async()=>{
  const a=await login();await assert.rejects(()=>billing.portal(a.session),/No subscription/);
  await pool.query('DELETE FROM sessions WHERE account_id=$1',[a.session.account_id]);await assert.rejects(()=>billing.authenticate(a.token),/expired/);
});
integration('Customer mapping rejects cross-account reuse before portal access is possible',async()=>{
  const a=await login(),b=await login('other@example.test');
  await pool.query('INSERT INTO billing_customers(account_id,customer_id) VALUES($1,$2)',[a.session.account_id,id('ctm')]);
  provider.list=async()=>[{id:id('ctm'),email:b.session.email}];
  await assert.rejects(()=>billing.customer(b.session));
  await assert.rejects(()=>billing.portal(b.session));
});
integration('Canonical approved refund revokes access, reversal recovers, unknown price fails closed',async()=>{
  const a=await login(),now=Date.now();await pool.query('INSERT INTO billing_customers(account_id,customer_id) VALUES($1,$2)',[a.session.account_id,id('ctm')]);
  sub={id:id('sub'),custom_data:{account_id:a.session.account_id},customer_id:id('ctm'),status:'active',updated_at:new Date(now).toISOString(),current_billing_period:{starts_at:new Date(now-10000).toISOString(),ends_at:new Date(now+1000000).toISOString()},items:[{price:{id:cfg.prices.monthly}}]};
  const adj={id:id('adj'),transaction_id:id('txn'),action:'refund',status:'approved',type:'full',created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()};
  provider.get=async path=>path.startsWith('/subscriptions')?sub:path.startsWith('/adjustments')?adj:{id:id('txn'),subscription_id:id('sub'),billed_at:new Date(now).toISOString()};provider.list=async()=>[adj];
  await processEntity(pool,cfg,provider,{entity_id:adj.id});assert.equal((await billing.entitlement(a.session)).plan,'free');
  adj.status='reversed';adj.updated_at=new Date(now+1000).toISOString();await processEntity(pool,cfg,provider,{entity_id:adj.id});assert.equal((await billing.entitlement(a.session)).plan,'pro');
  sub={...sub,updated_at:new Date(now+2000).toISOString(),items:[{price:{id:'pri_unlicensed'}}]};await syncSubscription(pool,cfg,provider,sub.id);assert.equal((await billing.entitlement(a.session)).plan,'free');
});

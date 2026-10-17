import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHmac,randomUUID} from 'node:crypto';
import {webhookValid,signer,verifyGrant} from '../src/security.js';
import {accessPolicy} from '../src/policy.js';
const pair=generateKeyPairSync('ec',{namedCurve:'P-256'}),key=pair.privateKey.export({format:'jwk'}),s=signer(key,'test','https://billing.test');
test('Raw-byte signature, rotated signatures, replay, future timestamp and tampering',()=>{
  const now=Date.now(),ts=String(Math.floor(now/1000)),raw=Buffer.from('{"hello": "world"}');const signature=createHmac('sha256','secret').update(`${ts}:`).update(raw).digest('hex');
  assert.equal(webhookValid(raw,`ts=${ts};h1=${'0'.repeat(64)};h1=${signature}`,'secret',now),true);
  assert.equal(webhookValid(Buffer.from('{"hello":"world"}'),`ts=${ts};h1=${signature}`,'secret',now),false);
  assert.equal(webhookValid(raw,`ts=${ts};h1=${signature}`,'secret',now+6000),false);
  assert.equal(webhookValid(raw,`ts=${ts};h1=${signature}`,'secret',now-6000),false);
  assert.equal(webhookValid(raw,`ts=${ts};ts=${ts};h1=${signature}`,'secret',now),false);
});
test('Signed grant rejects wrong device, tampering, unknown key and expiration',()=>{
  const device=randomUUID(),now=Math.floor(Date.now()/1000),token=s.issue({sub:randomUUID(),device,plan:'pro',iat:now,exp:now+3600});
  assert.equal(verifyGrant(token,s.publicJwk,'https://billing.test',device).plan,'pro');
  assert.equal(verifyGrant(token,s.publicJwk,'https://billing.test',randomUUID()),null);
  assert.equal(verifyGrant(token.slice(0,-8)+'aaaaaaaa',s.publicJwk,'https://billing.test',device),null);
  assert.equal(verifyGrant(token,{...s.publicJwk,kid:'wrong'},'https://billing.test',device),null);
  assert.equal(verifyGrant(token,s.publicJwk,'https://billing.test',device,(now+3600)*1000),null);
});
const now=Date.now(),sub={id:'sub_test',status:'active',period_start:new Date(now-100000),period_end:new Date(now+100000),scheduled_action:'cancel'};
test('Scheduled cancellation keeps paid access, period expiry and pauses do not',()=>{
  assert.equal(accessPolicy({},[sub],[],now,72).plan,'pro');assert.equal(accessPolicy({},[sub],[],now,72).cancelAtEnd,true);
  assert.equal(accessPolicy({},[{...sub,period_end:new Date(now-1)}],[],now,72).plan,'free');
  assert.equal(accessPolicy({},[{...sub,status:'paused'}],[],now,72).plan,'free');
  assert.equal(accessPolicy({},[{...sub,status:'canceled'}],[],now,72).plan,'free');
});
test('Payment recovery grace is bounded and never becomes unlimited access',()=>{
  const late={...sub,status:'past_due',past_due_since:new Date(now-3600000)};
  assert.equal(accessPolicy({},[late],[],now,72).plan,'pro');
  assert.equal(accessPolicy({},[late],[],now+72*3600000,72).plan,'free');
});
test('Only approved full current-period refunds and chargebacks revoke, reversals recover',()=>{
  const refund={subscription_id:sub.id,status:'approved',action:'refund',type:'full',billed_at:new Date(now)};
  assert.equal(accessPolicy({},[sub],[refund],now,72).plan,'free');
  for(const patch of [{status:'pending_approval'},{type:'partial'},{billed_at:new Date(now-200000)},{status:'reversed'}])assert.equal(accessPolicy({},[sub],[{...refund,...patch}],now,72).plan,'pro');
  assert.equal(accessPolicy({},[sub],[{...refund,action:'chargeback',billed_at:new Date(0)}],now,72).plan,'free');
});
test('Account trial is server-timed and cannot revive a canceled paid subscription',()=>{
  const account={trial_started_at:new Date(now-86400000)};
  assert.equal(accessPolicy(account,[],[],now,72).plan,'trial');
  assert.equal(accessPolicy(account,[{...sub,status:'canceled'}],[],now,72).plan,'free');
  assert.equal(accessPolicy({trial_started_at:new Date(now-8*86400000)},[],[],now,72).plan,'free');
});

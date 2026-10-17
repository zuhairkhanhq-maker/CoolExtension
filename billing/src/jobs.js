import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { subscriptionState } from './policy.js';
import { uuid } from './security.js';
export async function enqueue(pool,event) {
  if(!/^evt_[a-z0-9]{26}$/.test(event.event_id||'') || !Number.isFinite(Date.parse(event.occurred_at)))throw Object.assign(Error('Invalid event.'),{status:400});
  const kind=event.event_type?.split('.')[0],entity=event.data?.id;
  if(!['subscription','transaction','adjustment'].includes(kind))return;
  const prefix={subscription:'sub',transaction:'txn',adjustment:'adj'}[kind];
  if(!new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(entity||''))throw Object.assign(Error('Invalid entity.'),{status:400});
  await pool.query(`INSERT INTO webhook_jobs(event_id,event_type,entity_id,occurred_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[event.event_id,event.event_type,entity,event.occurred_at]);
}
export async function syncSubscription(pool,cfg,paddle,id) {
  const raw=await paddle.get(`/subscriptions/${id}`);
  const previous=(await pool.query('SELECT account_id FROM subscriptions WHERE id=$1',[id])).rows[0];
  const sub=subscriptionState({...raw,custom_data:{...raw.custom_data,account_id:raw.custom_data?.account_id||previous?.account_id}},cfg.prices);
  if(!sub){if(Number.isFinite(Date.parse(raw.updated_at)))await pool.query(`UPDATE subscriptions SET status='paused',source_updated_at=$2,synced_at=now() WHERE id=$1 AND source_updated_at<=$2`,[id,raw.updated_at]);return;}
  if(!uuid(sub.account))throw Error('Unmapped subscription.');
  await transaction(pool,async client=>{
    const account=await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[sub.account]);if(!account.rows.length)throw Error('Unknown account.');
    const customer=await client.query('SELECT customer_id FROM billing_customers WHERE account_id=$1',[sub.account]);if(customer.rows[0]?.customer_id!==sub.customer)throw Error('Customer ownership mismatch.');
    const old=await client.query('SELECT account_id FROM subscriptions WHERE id=$1',[id]);if(old.rows.length&&old.rows[0].account_id!==sub.account)throw Error('Subscription ownership mismatch.');
    await client.query(`INSERT INTO subscriptions(id,account_id,customer_id,status,price_id,period_start,period_end,trial_end,past_due_since,scheduled_action,source_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $4='past_due' THEN $10::timestamptz ELSE NULL END,$9,$10)
      ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,status=excluded.status,price_id=excluded.price_id,period_start=excluded.period_start,period_end=excluded.period_end,trial_end=excluded.trial_end,past_due_since=CASE WHEN excluded.status='past_due' THEN coalesce(subscriptions.past_due_since,excluded.past_due_since) ELSE NULL END,scheduled_action=excluded.scheduled_action,source_updated_at=excluded.source_updated_at,synced_at=now() WHERE subscriptions.source_updated_at<=excluded.source_updated_at`,[sub.id,sub.account,sub.customer,sub.status,sub.price,sub.start,sub.end,sub.trial,sub.scheduled,sub.updated]);
  });
}
async function syncTransaction(pool,cfg,paddle,id) {
  const txn=await paddle.get(`/transactions/${id}`);
  const intent=txn.custom_data?.checkout_intent_id,account=txn.custom_data?.account_id;
  if(uuid(intent)&&uuid(account))await pool.query(`UPDATE checkout_intents SET transaction_id=$3,checkout_url=coalesce(checkout_url,$4),state=CASE WHEN $5='completed' THEN 'complete' WHEN $5='canceled' THEN 'canceled' ELSE CASE WHEN state IN ('complete','canceled') THEN state ELSE 'ready' END END WHERE id=$1 AND account_id=$2`,[intent,account,txn.id,txn.checkout?.url||null,txn.status]);
  if(txn.subscription_id)await syncSubscription(pool,cfg,paddle,txn.subscription_id);
  return txn;
}
export async function processEntity(pool,cfg,paddle,job) {
  if(job.entity_id.startsWith('sub_'))return syncSubscription(pool,cfg,paddle,job.entity_id);
  if(job.entity_id.startsWith('txn_'))return syncTransaction(pool,cfg,paddle,job.entity_id);
  const adjustment=await paddle.get(`/adjustments/${job.entity_id}`);
  const txn=await syncTransaction(pool,cfg,paddle,adjustment.transaction_id);
  if(!txn.subscription_id)return;
  const all=await paddle.list(`/adjustments?transaction_id=${encodeURIComponent(txn.id)}&per_page=200`);
  await transaction(pool,async client=>{
    for(const a of all) {
      if(a.transaction_id!==txn.id)throw Error('Adjustment transaction mismatch');
      await client.query(`INSERT INTO adjustments(id,subscription_id,transaction_id,action,status,type,billed_at,source_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET action=excluded.action,status=excluded.status,type=excluded.type,billed_at=excluded.billed_at,source_updated_at=excluded.source_updated_at WHERE adjustments.source_updated_at<=excluded.source_updated_at`,[a.id,txn.subscription_id,txn.id,a.action,a.status,a.type,txn.billed_at||txn.created_at,a.updated_at||a.created_at]);
    }
  });
}
export async function runOne(pool,cfg,paddle) {
  const lease=randomUUID();
  const {rows:[job]}=await pool.query(`UPDATE webhook_jobs SET state='processing',lease_token=$1,lease_until=now()+interval '5 minutes',attempts=attempts+1 WHERE event_id=(SELECT event_id FROM webhook_jobs WHERE (state='pending' AND next_at<=now()) OR (state='processing' AND lease_until<now()) ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[lease]);
  if(!job)return false;
  try {await processEntity(pool,cfg,paddle,job);await pool.query(`UPDATE webhook_jobs SET state='done',done_at=now(),lease_until=NULL,error_code=NULL WHERE event_id=$1 AND lease_token=$2`,[job.event_id,lease]);}
  catch(error){const delay=Math.min(3600,2**Math.min(job.attempts,11))+Math.floor(Math.random()*10);await pool.query(`UPDATE webhook_jobs SET state=$3,next_at=now()+$4*interval '1 second',lease_until=NULL,error_code=$5 WHERE event_id=$1 AND lease_token=$2`,[job.event_id,lease,job.attempts>=12?'dead':'pending',delay,/^paddle_\d+$/.test(error.code||'')?error.code:'processing_failed']);}
  return true;
}
export async function maintenance(pool,cfg,paddle) {
  await transaction(pool,async client=>{
    const subs=await client.query(`SELECT id FROM subscriptions WHERE status NOT IN ('canceled','paused') AND reconcile_after<=now() ORDER BY reconcile_after FOR UPDATE SKIP LOCKED LIMIT 100`);
    const checkouts=await client.query(`SELECT id,transaction_id FROM checkout_intents WHERE state='ready' AND transaction_id IS NOT NULL AND reconcile_after<=now() ORDER BY reconcile_after FOR UPDATE SKIP LOCKED LIMIT 25`);
    for(const row of subs.rows){await client.query(`UPDATE subscriptions SET reconcile_after=now()+interval '6 hours' WHERE id=$1`,[row.id]);await client.query(`INSERT INTO webhook_jobs(event_id,event_type,entity_id,occurred_at) VALUES($1,'reconcile.subscription',$2,now()) ON CONFLICT DO NOTHING`,[`reconcile:${row.id}:${Math.floor(Date.now()/21600000)}`,row.id]);}
    for(const row of checkouts.rows){await client.query(`UPDATE checkout_intents SET reconcile_after=now()+interval '5 minutes' WHERE id=$1`,[row.id]);await client.query(`INSERT INTO webhook_jobs(event_id,event_type,entity_id,occurred_at) VALUES($1,'reconcile.transaction',$2,now()) ON CONFLICT DO NOTHING`,[`reconcile:${row.id}:${Math.floor(Date.now()/300000)}`,row.transaction_id]);}
  });
  await pool.query(`DELETE FROM sessions WHERE expires_at<now(); DELETE FROM challenges WHERE expires_at<now()-interval '1 day'; DELETE FROM rate_limits WHERE reset_at<now()-interval '1 day'; DELETE FROM webhook_jobs WHERE state='done' AND done_at<now()-interval '90 days'`);
}

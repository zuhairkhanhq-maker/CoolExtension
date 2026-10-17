import { randomUUID, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { transaction, rate } from './db.js';
import { hash, uuid, signer } from './security.js';
import { accessPolicy } from './policy.js';
const fail=(status,message)=>Object.assign(Error(message),{status});
export class Billing {
  constructor(pool,cfg,paddle,mail){this.pool=pool;this.cfg=cfg;this.paddle=paddle;this.mail=mail;this.signer=signer(cfg.privateJwk,cfg.keyId,cfg.origin);}
  async startAuth(email,device,ip) {
    if(typeof email!=='string'||email.length>254||!(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/).test(email)||!uuid(device))throw fail(400,'Enter a valid email.');
    email=email.trim().toLowerCase();
    await rate(this.pool,hash(`auth-ip:${ip}`,this.cfg.hmac),20,3600);
    await rate(this.pool,hash(`auth-email:${email}`,this.cfg.hmac),5,3600);
    const id=randomUUID(),code=String(randomInt(1000000)).padStart(6,'0');
    const row=await this.pool.query('INSERT INTO accounts(id,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id',[randomUUID(),email]);
    await this.pool.query(`INSERT INTO challenges(id,account_id,device_id,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,[id,row.rows[0].id,device,hash(`${id}:${code}`,this.cfg.hmac)]);
    try {await this.mail.sendMail({from:this.cfg.mailFrom,to:email,subject:'Your Bypass sign-in code',text:`Your Bypass code is ${code}. It expires in 10 minutes. Never share it. If you did not request it, ignore this email.`});}
    catch {await this.pool.query('DELETE FROM challenges WHERE id=$1',[id]);throw fail(503,'Could not send the code. Try again shortly.');}
    return {challengeId:id};
  }
  async verifyAuth(id,code,device,ip) {
    if(!uuid(id)||!uuid(device)||!/^\d{6}$/.test(code||''))throw fail(400,'Check the code.');
    await rate(this.pool,hash(`verify:${ip}`,this.cfg.hmac),60,3600);
    const token=randomBytes(32).toString('base64url');
    const valid=await transaction(this.pool,async client=>{
      const {rows:[challenge]}=await client.query('SELECT * FROM challenges WHERE id=$1 FOR UPDATE',[id]);
      if(!challenge||challenge.consumed_at||challenge.attempts>=5||+challenge.expires_at<=Date.now()||challenge.device_id!==device)return false;
      await client.query('UPDATE challenges SET attempts=attempts+1 WHERE id=$1',[id]);
      if(!timingSafeEqual(Buffer.from(challenge.code_hash,'hex'),Buffer.from(hash(`${id}:${code}`,this.cfg.hmac),'hex')))return false;
      await client.query('UPDATE challenges SET consumed_at=now() WHERE id=$1',[id]);
      await client.query('UPDATE accounts SET verified_at=coalesce(verified_at,now()) WHERE id=$1',[challenge.account_id]);
      await client.query(`INSERT INTO sessions(token_hash,account_id,device_id,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 day')`,[hash(token,this.cfg.hmac),challenge.account_id,device,this.cfg.sessionDays]);
      return true;
    });
    if(!valid)throw fail(401,'Code is invalid, expired or already used.');
    return {session:token};
  }
  async authenticate(token) {
    if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))throw fail(401,'Sign in to continue.');
    const {rows:[session]}=await this.pool.query(`SELECT sessions.*,accounts.email FROM sessions JOIN accounts ON accounts.id=sessions.account_id WHERE token_hash=$1 AND expires_at>now()`,[hash(token,this.cfg.hmac)]);
    if(!session)throw fail(401,'Your session expired. Sign in again.');return session;
  }
  async trial(session) {
    await transaction(this.pool,async client=>{
      await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[session.account_id]);
      const {rows:[account]}=await client.query('SELECT * FROM accounts WHERE id=$1',[session.account_id]);
      const {rows}=await client.query('SELECT id FROM subscriptions WHERE account_id=$1 LIMIT 1',[session.account_id]);
      if(account.trial_started_at||rows.length)throw fail(409,'This account has already used its trial or has a subscription.');
      await client.query('UPDATE accounts SET trial_started_at=now() WHERE id=$1',[session.account_id]);
    });
    return this.entitlement(session);
  }
  async entitlement(session) {
    const {rows:[account]}=await this.pool.query('SELECT * FROM accounts WHERE id=$1',[session.account_id]);
    const {rows:subs}=await this.pool.query('SELECT * FROM subscriptions WHERE account_id=$1 ORDER BY source_updated_at DESC',[session.account_id]);
    const {rows:adjustments}=await this.pool.query('SELECT adjustments.* FROM adjustments JOIN subscriptions ON subscriptions.id=adjustments.subscription_id WHERE subscriptions.account_id=$1',[session.account_id]);
    const now=Date.now(),policy=accessPolicy(account,subs,adjustments,now,this.cfg.graceHours,this.cfg.maxStateAgeHours);
    const issued=Math.floor(now/1000),expires=Math.min(Math.floor(policy.until/1000),issued+this.cfg.grantSeconds);
    return {token:this.signer.issue({sub:account.id,device:session.device_id,plan:policy.plan,status:policy.status,iat:issued,exp:expires,cancelAtEnd:policy.cancelAtEnd}),email:account.email,plan:policy.plan,status:policy.status,trialUsed:!!account.trial_started_at||!!subs.length,accessUntil:policy.until,cancelAtEnd:policy.cancelAtEnd,refreshAfter:Math.min(1800,Math.max(120,Math.floor((expires-issued)/2)))};
  }
  async checkout(session,plan) {
    if(!Object.hasOwn(this.cfg.prices,plan))throw fail(400,'Choose monthly or annual.');
    await rate(this.pool,`checkout:${session.account_id}`,20,3600);
    const intent=await transaction(this.pool,async client=>{
      await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[session.account_id]);
      const active=await client.query(`SELECT id FROM subscriptions WHERE account_id=$1 AND status IN ('active','trialing','past_due') LIMIT 1`,[session.account_id]);
      if(active.rows.length)throw fail(409,'Manage your existing subscription instead of buying twice.');
      const existing=await client.query(`SELECT * FROM checkout_intents WHERE account_id=$1 AND state IN ('creating','ready','uncertain')`,[session.account_id]);
      if(existing.rows.length){const row=existing.rows[0];if(row.plan!==plan)throw fail(409,'Discard the pending checkout before changing plans.');return {...row,existing:true};}
      const {rows:[row]}=await client.query(`INSERT INTO checkout_intents(id,account_id,plan,expires_at) VALUES($1,$2,$3,now()+interval '1 hour') RETURNING *`,[randomUUID(),session.account_id,plan]);return row;
    });
    if(intent.existing){if(intent.checkout_url)return {url:intent.checkout_url};throw fail(409,'Checkout is awaiting payment-provider confirmation. Refresh shortly; no duplicate checkout was created.');}
    try {
      let customer;
      try{customer=await this.customer(session);}catch(error){error.confirmedNoMutation=true;throw error;}
      const {data}=await this.paddle.call('/transactions','POST',{customer_id:customer,items:[{price_id:this.cfg.prices[plan],quantity:1}],collection_mode:'automatic',custom_data:{account_id:session.account_id,checkout_intent_id:intent.id},checkout:{url:`${this.cfg.checkoutOrigin}/checkout`}});
      const url=new URL(data.checkout?.url);
      if(url.origin!==this.cfg.checkoutOrigin||url.protocol!=='https:')throw Error('Unexpected checkout URL');
      await this.pool.query(`UPDATE checkout_intents SET transaction_id=$2,checkout_url=$3,state=CASE WHEN state='complete' THEN state ELSE 'ready' END WHERE id=$1`,[intent.id,data.id,url.href]);
      return {url:url.href};
    } catch(error){await this.pool.query(`UPDATE checkout_intents SET state=$2 WHERE id=$1 AND state='creating'`,[intent.id,error.confirmedNoMutation?'canceled':'uncertain']);throw error;}
  }
  async customer(session){
    const existing=await this.pool.query('SELECT customer_id FROM billing_customers WHERE account_id=$1',[session.account_id]);if(existing.rows.length)return existing.rows[0].customer_id;
    const matches=await this.paddle.list(`/customers?email=${encodeURIComponent(session.email)}&per_page=200`);
    if(matches.length>1)throw fail(409,'Multiple billing records need support review. No new purchase was started.');
    let customer=matches[0];
    if(customer&&(customer.email?.toLowerCase()!==session.email||customer.custom_data?.account_id&&customer.custom_data.account_id!==session.account_id))throw fail(409,'Billing ownership needs support review.');
    if(!customer)customer=(await this.paddle.call('/customers','POST',{email:session.email,custom_data:{account_id:session.account_id}})).data;
    if(!/^ctm_[a-z0-9]{26}$/.test(customer.id||''))throw Error('Invalid customer response');
    await this.pool.query('INSERT INTO billing_customers(account_id,customer_id) VALUES($1,$2)',[session.account_id,customer.id]);return customer.id;
  }
  async discard(session) {
    const {rows:[intent]}=await this.pool.query(`SELECT * FROM checkout_intents WHERE account_id=$1 AND state IN ('creating','ready','uncertain')`,[session.account_id]);
    if(!intent)return {ok:true};
    if(!intent.transaction_id)throw fail(409,'Checkout confirmation is pending. Contact support if this persists.');
    await this.paddle.call(`/transactions/${intent.transaction_id}`,'PATCH',{status:'canceled'});
    await this.pool.query(`UPDATE checkout_intents SET state='canceled' WHERE id=$1`,[intent.id]);return {ok:true};
  }
  async portal(session) {
    const {rows:[sub]}=await this.pool.query('SELECT customer_id FROM subscriptions WHERE account_id=$1 ORDER BY source_updated_at DESC LIMIT 1',[session.account_id]);
    if(!sub)throw fail(404,'No subscription to manage yet.');
    const {data}=await this.paddle.call(`/customers/${sub.customer_id}/portal-sessions`,'POST',{});
    const url=new URL(data.urls.general.overview);
    if(url.protocol!=='https:'||!['customer-portal.paddle.com','sandbox-customer-portal.paddle.com'].includes(url.hostname))throw Error('Unexpected portal URL');return {url:url.href};
  }
}

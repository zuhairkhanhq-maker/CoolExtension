export function subscriptionState(sub, prices) {
  const price=sub.items?.find(item=>item.status!=='inactive'&&Object.values(prices).includes(item.price?.id))?.price?.id;
  if(!price || !['active','trialing','past_due','paused','canceled'].includes(sub.status)) return null;
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value):null;
  const updated=date(sub.updated_at);if(!updated)throw Error('Subscription missing updated_at');
  return {id:sub.id,account:sub.custom_data?.account_id,customer:sub.customer_id,status:sub.status,price,
    start:date(sub.current_billing_period?.starts_at),end:date(sub.current_billing_period?.ends_at),trial:date(sub.next_billed_at),updated:sub.updated_at,scheduled:sub.scheduled_change?.action||null};
}
export function accessPolicy(account, subscriptions, adjustments, now, graceHours, maxStateAgeHours=24) {
  const live=[];
  for(const sub of subscriptions) {
    if(sub.synced_at && now-+new Date(sub.synced_at)>maxStateAgeHours*3600000)continue;
    const blocked=adjustments.some(a=>a.subscription_id===sub.id && a.status==='approved' && (a.action==='chargeback' || (a.action==='refund'&&a.type==='full'&&a.billed_at&&sub.period_start&&new Date(a.billed_at)>=new Date(sub.period_start))));
    if(blocked)continue;
    let until=0;
    if(sub.status==='active')until=+new Date(sub.period_end||0);
    if(sub.status==='trialing')until=+new Date(sub.trial_end||sub.period_end||0);
    if(sub.status==='past_due')until=+new Date(sub.past_due_since||0)+graceHours*3600000;
    if(until>now)live.push({plan:sub.status==='trialing'?'trial':'pro',status:sub.status,until,subscriptionId:sub.id,cancelAtEnd:sub.scheduled_action==='cancel'});
  }
  if(live.length)return live.sort((a,b)=>b.until-a.until)[0];
  const end=account.trial_started_at?+new Date(account.trial_started_at)+7*86400000:0;
  if(!subscriptions.length && end>now)return {plan:'trial',status:'trialing',until:end,cancelAtEnd:false};
  return {plan:'free',status:subscriptions[0]?.status||'free',until:now+3600000,cancelAtEnd:false};
}

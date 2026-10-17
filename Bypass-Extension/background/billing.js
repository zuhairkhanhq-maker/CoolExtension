'use strict';
(() => {
  const cfg=globalThis.BypassBillingConfig;
  let memory=null,opening=null,loading=null,refreshing=null,authWork=Promise.resolve(),storageWork=Promise.resolve(),validated=null;
  const enabled=!!cfg?.enabled;
  const origin=enabled?new URL(cfg.apiOrigin).origin:'';
  if(enabled && (!origin.startsWith('https://') || origin!==cfg.apiOrigin || !Array.isArray(cfg.publicKeys) || !cfg.publicKeys.length))throw Error('Invalid billing deployment configuration.');
  function db(){if(!opening)opening=new Promise((resolve,reject)=>{const request=indexedDB.open('bypass-account',1);request.onupgradeneeded=()=>request.result.createObjectStore('private');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Could not open secure account storage.'));});return opening;}
  async function stored(){if(memory)return memory;if(!loading)loading=(async()=>{const database=await db();return new Promise((resolve,reject)=>{const request=database.transaction('private').objectStore('private').get('account');request.onsuccess=()=>{memory=request.result||{deviceId:crypto.randomUUID(),lastSeen:0};resolve(memory);};request.onerror=()=>reject(Error('Account storage unavailable.'));});})();return loading;}
  function save(patch){const operation=storageWork.then(async()=>{const previous=await stored(),value={...previous,...patch},database=await db();await new Promise((resolve,reject)=>{const tx=database.transaction('private','readwrite');tx.objectStore('private').put(value,'account');tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Could not save account.'));tx.onabort=()=>reject(Error('Account save interrupted.'));});memory=value;validated=null;});storageWork=operation.catch(()=>{});return operation;}
  const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  async function claims(token,deviceId){
    try{
      if(typeof token!=='string'||token.length>8192)return null;
      if(validated?.token===token&&validated.claims.exp*1000>Date.now())return validated.claims;
      const [h,p,s,...rest]=token.split('.');if(rest.length||!s)return null;
      const head=JSON.parse(new TextDecoder().decode(bytes(h))),data=JSON.parse(new TextDecoder().decode(bytes(p)));
      const jwk=cfg.publicKeys.find(k=>k.kid===head.kid);if(!jwk||head.alg!=='ES256'||data.iss!==origin||data.aud!=='bypass-pro'||data.device!==deviceId||!['pro','trial','free'].includes(data.plan)||!Number.isSafeInteger(data.exp)||!Number.isSafeInteger(data.iat)||data.exp*1000<=Date.now()||data.iat*1000>Date.now()+60000||data.exp-data.iat>86400)return null;
      const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes(s),new TextEncoder().encode(`${h}.${p}`)))return null;
      validated={token,claims:data};return data;
    }catch{return null;}
  }
  async function api(path,body={},auth=true){
    if(!enabled)throw Error('Billing is not configured in this build.');
    const account=await stored();if(auth&&!account.session)throw Error('Sign in with your email first.');
    const response=await fetch(origin+path,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${account.session}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    let data;try{data=await response.json();}catch{throw Error('Billing service temporarily unavailable.');}
    if(!response.ok){if(response.status===401&&auth){await save({session:null,token:null,email:null,meta:null});void globalThis.BypassProRefresh?.();}throw Error(typeof data.error==='string'?data.error:'Could not complete billing action.');}
    return data;
  }
  async function accept(data){const account=await stored();if(!await claims(data.token,account.deviceId))throw Error('Access verification failed. Your Free protection is unchanged.');await save({token:data.token,email:data.email,meta:{plan:data.plan,status:data.status,trialUsed:data.trialUsed,accessUntil:data.accessUntil,cancelAtEnd:data.cancelAtEnd},lastSeen:Date.now(),refreshedAt:Date.now()});}
  async function refresh(){if(refreshing)return refreshing;refreshing=(async()=>{await accept(await api('/v1/entitlement'));})().finally(()=>{refreshing=null;});return refreshing;}
  async function status(){
    if(!enabled)return {configured:false};
    const account=await stored(),now=Date.now(),grant=await claims(account.token,account.deviceId);
    const active=!!grant&&grant.plan!=='free'&&now>=Number(account.lastSeen||0)-300000;
    if(now>Number(account.lastSeen||0)+60000)await save({lastSeen:now});
    return {configured:true,signedIn:!!account.session,active,plan:grant?.plan||'free',status:account.meta?.status||'free',expiresAt:grant?grant.exp*1000:null,accessUntil:account.meta?.accessUntil||null,trialUsed:!!account.meta?.trialUsed,cancelAtEnd:!!account.meta?.cancelAtEnd};
  }
  async function accountView(){const state=await status();const account=await stored();return {...state,email:account.email||'',onlineRequired:!state.active};}
  async function trial(){await accept(await api('/v1/trial'));}
  globalThis.BypassBilling=Object.freeze({enabled,status,trial});
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('ui/'))||!msg?.type?.startsWith('billing-'))return;
    const allowed=['billing-status','billing-start','billing-verify','billing-refresh','billing-checkout','billing-discard','billing-portal','billing-logout'];
    if(!allowed.includes(msg.type))return;
    const task=authWork.then(async()=>{
      if(!enabled)return {configured:false};
      if(msg.type==='billing-start'){
        const account=await stored();const result=await api('/v1/auth/start',{email:msg.email,deviceId:account.deviceId},false);
        await save({challengeId:result.challengeId});return {challengeSent:true};
      }
      if(msg.type==='billing-verify'){
        const account=await stored();if(!account.challengeId)throw Error('Request an email code first.');
        const result=await api('/v1/auth/verify',{challengeId:account.challengeId,code:msg.code,deviceId:account.deviceId},false);
        await save({session:result.session,challengeId:null});await refresh();
      }
      if(msg.type==='billing-refresh')await refresh();
      if(msg.type==='billing-checkout'||msg.type==='billing-portal'){
        const result=await api(msg.type==='billing-checkout'?'/v1/checkout':'/v1/portal',msg.type==='billing-checkout'?{plan:msg.plan}:{});
        const url=new URL(result.url);if(url.protocol!=='https:')throw Error('Unsafe payment URL.');
        if(msg.type==='billing-checkout'&&url.origin!==origin)throw Error('Unexpected checkout host.');
        if(msg.type==='billing-portal'&&!['customer-portal.paddle.com','sandbox-customer-portal.paddle.com'].includes(url.hostname))throw Error('Unexpected portal host.');
        await chrome.tabs.create({url:url.href});
      }
      if(msg.type==='billing-discard')await api('/v1/checkout/discard');
      if(msg.type==='billing-logout'){
        try{await api('/v1/logout');}finally{await save({session:null,token:null,email:null,meta:null,challengeId:null,lastSeen:Date.now()});void globalThis.BypassProRefresh?.();}
      }
      void globalThis.BypassProRefresh?.();return accountView();
    });
    authWork=task.catch(()=>{});task.then(state=>respond({ok:true,state}),error=>respond({ok:false,error:error.message||'Billing temporarily unavailable.'}));return true;
  });
  if(enabled){
    const ensure=async()=>{if(!await chrome.alarms.get('billing-refresh'))await chrome.alarms.create('billing-refresh',{periodInMinutes:15});};
    chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='billing-refresh')void refresh().then(()=>globalThis.BypassProRefresh?.()).catch(()=>{});});
    chrome.runtime.onStartup.addListener(()=>{void ensure().catch(()=>{});void refresh().then(()=>globalThis.BypassProRefresh?.()).catch(()=>{});});
    void ensure().catch(()=>{});
  }
})();

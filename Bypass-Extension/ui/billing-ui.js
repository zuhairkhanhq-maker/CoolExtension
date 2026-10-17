'use strict';
(() => {
  const $=id=>document.getElementById(id);
  let busy=false;
  async function request(type,extra={}){const result=await chrome.runtime.sendMessage({type,...extra});if(!result?.ok)throw Error(result?.error||'Billing service unavailable.');return result.state;}
  function render(state){
    if(!state)return;
    $('billing-account').textContent=state.signedIn?`Signed in as ${state.email}`:'Sign in to use or purchase Pro.';
    $('billing-login').hidden=!!state.signedIn;
    $('billing-actions').hidden=!state.signedIn;
    $('billing-plan-status').textContent=state.active?`${state.plan==='trial'?'Trial':'Pro'} active${state.cancelAtEnd?' · cancels at the end of the paid period':''}. Signed offline access until ${new Date(state.expiresAt).toLocaleString()}.`:'Free protection is active. Pro unlocks only after server verification.';
    $('pro-trial').textContent='Start my 7-day account trial';
    $('pro-trial').disabled=busy||!state.signedIn||state.trialUsed;
    $('pro-trial-note').textContent='One trial per verified account. No card or automatic charge. Account and billing details are online; browsing rules and activity stay on this device.';
    for(const button of $('billing-controls').querySelectorAll('button'))button.disabled=busy;
  }
  async function run(task){if(busy)return;busy=true;try{await task();$('billing-feedback').textContent='Account updated.';}catch(error){$('billing-feedback').textContent=error.message;}finally{busy=false;try{render(await request('billing-status'));}catch{}window.dispatchEvent(new Event('bypass-account-updated'));}}
  async function init(){
    let state;try{state=await request('billing-status');}catch{return;}
    if(!state.configured)return;
    document.querySelector('.privacy-pill').textContent='LOCAL CLEANUP';
    const section=document.createElement('section');section.className='site';section.id='billing-controls';
    section.innerHTML=`<h2>My Pro account</h2><p id="billing-account" class="fine"></p><form id="billing-login"><label class="pro-field">Email<input id="billing-email" type="email" autocomplete="email" required maxlength="254"></label><button class="secondary-button" type="submit">Email me a sign-in code</button></form><form id="billing-code-form" hidden><label class="pro-field">Six-digit code<input id="billing-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="secondary-button" type="submit">Sign in securely</button></form><p id="billing-plan-status" class="fine" role="status"></p><div id="billing-actions" hidden><label class="pro-field">Pro plan<select id="billing-plan"><option value="monthly">Monthly · price and tax confirmed at checkout</option><option value="annual">Annual · price and tax confirmed at checkout</option></select></label><button id="billing-buy" class="primary-button" type="button">Continue to secure checkout</button><button id="billing-refresh" class="secondary-button" type="button">Refresh access after payment</button><button id="billing-manage" class="secondary-button" type="button">Manage subscription or payment method</button><details><summary>Account help</summary><button id="billing-discard" class="secondary-button" type="button">Discard pending checkout</button><button id="billing-logout" class="secondary-button" type="button">Sign out on this device</button></details></div><p id="billing-feedback" class="fine" role="status" aria-live="polite"></p>`;
    $('autopilot-panel').querySelector('.hero').after(section);
    $('billing-login').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{await request('billing-start',{email:$('billing-email').value.trim()});$('billing-code-form').hidden=false;$('billing-code').focus();});});
    $('billing-code-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{await request('billing-verify',{code:$('billing-code').value});$('billing-code').value='';$('billing-code-form').hidden=true;});});
    for(const [id,type] of [['billing-refresh','billing-refresh'],['billing-manage','billing-portal'],['billing-discard','billing-discard'],['billing-logout','billing-logout']])$(id).addEventListener('click',()=>void run(()=>request(type)));
    $('billing-buy').addEventListener('click',()=>void run(()=>request('billing-checkout',{plan:$('billing-plan').value})));
    render(state);
    addEventListener('bypass-pro-rendered',()=>{if(!busy)void request('billing-status').then(render).catch(()=>{});});
    addEventListener('focus',()=>{if(!busy)void request('billing-status').then(render).catch(()=>{});});
  }
  void init();
})();

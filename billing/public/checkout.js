(async()=>{
  const status=document.getElementById('status');
  try{
    const response=await fetch('/checkout-config',{cache:'no-store'});if(!response.ok)throw Error();const cfg=await response.json();
    const id=new URL(location.href).searchParams.get('_ptxn');if(!/^txn_[a-z0-9]{26}$/.test(id||''))throw Error();
    if(cfg.environment==='sandbox')Paddle.Environment.set('sandbox');
    Paddle.Initialize({token:cfg.token,checkout:{settings:{allowLogout:false}},eventCallback:event=>{if(event.name==='checkout.completed')status.textContent='Payment submitted. Return to Bypass and select Refresh access. Verification may take a moment.';if(event.name==='checkout.closed')status.textContent='Checkout closed. Nothing unlocks without verified payment.';}});
    status.textContent='Complete your purchase in the secure payment window.';
  }catch{status.textContent='Checkout could not load. Return to Bypass and reopen it. Do not submit payment twice.';}
})();

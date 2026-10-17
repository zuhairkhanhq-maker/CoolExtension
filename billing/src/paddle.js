export class Paddle {
  constructor(cfg, fetcher=fetch,budget=async()=>{}){this.cfg=cfg;this.fetcher=fetcher;this.budget=budget;}
  async call(path, method='GET', body) {
    if(!path.startsWith('/') || path.startsWith('//'))throw Error('Invalid API path');
    try{await this.budget();}catch(error){error.confirmedNoMutation=true;throw error;}
    const response=await this.fetcher(this.cfg.paddleBase+path,{method,headers:{Authorization:`Bearer ${this.cfg.paddleKey}`,'Content-Type':'application/json','Paddle-Version':'1'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000),redirect:'error'});
    if(!response.ok)throw Object.assign(Error('Payment provider unavailable. Try again shortly.'),{code:`paddle_${response.status}`,status:503,confirmedNoMutation:response.status>=400&&response.status<500&&response.status!==408});
    return response.json();
  }
  async get(path){return (await this.call(path)).data;}
  async list(path){const out=[];let next=path;for(let i=0;next&&i<20;i++) {const result=await this.call(next);out.push(...result.data);const paging=result.meta?.pagination,url=paging?.has_more?paging.next:null; if(url){const parsed=new URL(url);if(parsed.origin!==new URL(this.cfg.paddleBase).origin)throw Error('Unexpected pagination host');next=parsed.pathname+parsed.search;}else if(paging?.has_more)throw Error('Missing pagination cursor');else next=null;}if(next)throw Error('Pagination safety limit exceeded');return out;}
}

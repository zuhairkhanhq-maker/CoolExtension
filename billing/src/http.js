import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { webhookValid, hash } from './security.js';
import { rate } from './db.js';
import { enqueue } from './jobs.js';
export function server(billing) {
  const {cfg,pool}=billing;
  const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  return createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    const origin=req.headers.origin;
    if(origin && !cfg.extensionOrigins.includes(origin) && origin!==cfg.origin){send(res,403,{error:'Origin not allowed.'});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');}
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const pathname=new URL(req.url,'http://localhost').pathname;
    try {
      if(req.method==='GET'&&pathname==='/health'){await pool.query('SELECT 1');return send(res,200,{ok:true});}
      if(req.method==='GET'&&pathname==='/checkout-config')return send(res,200,{environment:cfg.mode,token:cfg.clientToken});
      if(req.method==='GET'&&(pathname==='/checkout'||pathname==='/checkout.js')) {
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.paddle.com; frame-src https://*.paddle.com; connect-src 'self' https://*.paddle.com https://*.paddleapi.com; img-src 'self' data: https://*.paddle.com; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action https://*.paddle.com");
        const filename=pathname==='/checkout'?'checkout.html':'checkout.js';const body=await readFile(new URL(`../public/${filename}`,import.meta.url));
        res.writeHead(200,{'Content-Type':filename.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});res.end(body);return;
      }
      if(req.method!=='POST')return send(res,404,{error:'Not found.'});
      let size=0;const chunks=[],limit=pathname==='/webhooks/paddle'?262144:16384;
      for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('Request too large.'),{status:413});chunks.push(chunk);}
      const raw=Buffer.concat(chunks);
      if(pathname==='/webhooks/paddle'){
        if(!webhookValid(raw,req.headers['paddle-signature'],cfg.webhookSecret))throw Object.assign(Error('Invalid signature.'),{status:401});
        let event;try{event=JSON.parse(raw);}catch{throw Object.assign(Error('Invalid JSON.'),{status:400});}
        await enqueue(pool,event);return send(res,200,{received:true});
      }
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Object.assign(Error('Use application/json.'),{status:415});
      let body;try{body=JSON.parse(raw);}catch{throw Object.assign(Error('Invalid JSON.'),{status:400});}
      if(!body||Array.isArray(body)||typeof body!=='object')throw Object.assign(Error('Invalid request.'),{status:400});
      const forwarded=typeof req.headers['x-forwarded-for']==='string'?req.headers['x-forwarded-for'].split(',').map(s=>s.trim()):[];
      const ip=cfg.proxyHops ? [...forwarded,req.socket.remoteAddress].at(-1-cfg.proxyHops)||req.socket.remoteAddress : req.socket.remoteAddress;
      if(pathname==='/v1/auth/start')return send(res,200,await billing.startAuth(body.email,body.deviceId,ip));
      if(pathname==='/v1/auth/verify')return send(res,200,await billing.verifyAuth(body.challengeId,body.code,body.deviceId,ip));
      const token=req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
      const session=await billing.authenticate(token);
      await rate(pool,`api:${hash(token,cfg.hmac)}`,180,60);
      if(pathname==='/v1/entitlement')return send(res,200,await billing.entitlement(session));
      if(pathname==='/v1/trial')return send(res,200,await billing.trial(session));
      if(pathname==='/v1/checkout')return send(res,200,await billing.checkout(session,body.plan));
      if(pathname==='/v1/checkout/discard')return send(res,200,await billing.discard(session));
      if(pathname==='/v1/portal')return send(res,200,await billing.portal(session));
      if(pathname==='/v1/logout'){await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token,cfg.hmac)]);return send(res,200,{ok:true});}
      return send(res,404,{error:'Not found.'});
    }catch(error){if(res.headersSent){res.destroy();return;}const status=Number.isInteger(error.status)?error.status:503;if(status>=500)console.error(JSON.stringify({event:'request_failed',path:pathname,code:typeof error.code==='string'&&/^[\w_]+$/.test(error.code)?error.code:'internal'}));send(res,status,{error:status>=500?'Service temporarily unavailable. Your existing Free features are unaffected.':error.message});}
  });
}

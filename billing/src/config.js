const required = (env, key) => { const value=env[key]; if(!value) throw Error(`Missing ${key}`); return value; };
const int = (env,key,fallback,min,max) => { const n=Number(env[key] || fallback); if(!Number.isInteger(n)||n<min||n>max)throw Error(`Invalid ${key}`);return n; };
export function config(env = process.env) {
  const origin=new URL(required(env,'PUBLIC_ORIGIN'));
  if(origin.protocol!=='https:' && !(env.NODE_ENV==='test' && origin.hostname==='localhost')) throw Error('PUBLIC_ORIGIN requires HTTPS.');
  if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw Error('PUBLIC_ORIGIN must be an origin.');
  const mode=env.PADDLE_ENV||'sandbox';if(!['sandbox','live'].includes(mode))throw Error('Invalid PADDLE_ENV');
  const ids=required(env,'EXTENSION_IDS').split(',').map(v=>v.trim());if(ids.some(v=>!(/^[a-p]{32}$/.test(v))))throw Error('Invalid EXTENSION_IDS');
  const secret=required(env,'AUTH_HMAC_SECRET');if(secret.length<32)throw Error('AUTH_HMAC_SECRET must have at least 32 random characters.');
  const prices={monthly:required(env,'PADDLE_MONTHLY_PRICE_ID'),annual:required(env,'PADDLE_ANNUAL_PRICE_ID')};
  if(Object.values(prices).some(v=>!/^pri_[a-z0-9]{26}$/.test(v))||prices.monthly===prices.annual)throw Error('Invalid or duplicate prices.');
  if(new URL(required(env,'CHECKOUT_ORIGIN')).origin!==origin.origin)throw Error('CHECKOUT_ORIGIN must match PUBLIC_ORIGIN.');
  let privateJwk;try{privateJwk=JSON.parse(required(env,'SIGNING_PRIVATE_JWK'));}catch{throw Error('Invalid SIGNING_PRIVATE_JWK JSON.');}
  return { origin:origin.origin, port:int(env,'PORT',3000,1,65535), database:required(env,'DATABASE_URL'), ssl:env.DB_SSL!=='false', poolMax:int(env,'DB_POOL_MAX',10,1,100), proxyHops:int(env,'TRUST_PROXY_HOPS',0,0,3), mode,
    paddleBase:mode==='live'?'https://api.paddle.com':'https://sandbox-api.paddle.com', paddleKey:required(env,'PADDLE_API_KEY'), webhookSecret:required(env,'PADDLE_WEBHOOK_SECRET'), prices,
    clientToken:required(env,'PADDLE_CLIENT_TOKEN'), paddleRpm:int(env,'PADDLE_RPM',180,1,10000), checkoutOrigin:new URL(required(env,'CHECKOUT_ORIGIN')).origin,
    extensionOrigins:ids.map(id=>`chrome-extension://${id}`), hmac:secret, keyId:required(env,'SIGNING_KEY_ID'), privateJwk,
    grantSeconds:int(env,'GRANT_SECONDS',3600,300,86400), graceHours:int(env,'PAYMENT_GRACE_HOURS',72,0,168), maxStateAgeHours:int(env,'MAX_STATE_AGE_HOURS',24,6,168), sessionDays:int(env,'SESSION_DAYS',30,1,90),
    smtp:{host:required(env,'SMTP_HOST'),port:int(env,'SMTP_PORT',587,1,65535),secure:env.SMTP_SECURE==='true',auth:{user:required(env,'SMTP_USER'),pass:required(env,'SMTP_PASS')},requireTLS:env.SMTP_SECURE!=='true',connectionTimeout:10000,socketTimeout:15000}, mailFrom:required(env,'MAIL_FROM') };
}

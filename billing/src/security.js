import { createHmac, timingSafeEqual, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
export const hash = (value, secret) => createHmac('sha256', secret).update(value).digest('hex');
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function webhookValid(raw, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || typeof header !== 'string' || header.length > 2048 || !secret) return false;
  const parts = header.split(';').map(p => p.trim().split('='));
  const stamps = parts.filter(([k]) => k === 'ts');
  if (stamps.length !== 1 || !/^\d{10}$/.test(stamps[0][1])) return false;
  const timestamp = stamps[0][1];
  if (Math.abs(now / 1000 - Number(timestamp)) > 5) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}:`).update(raw).digest();
  return parts.some(([key, value]) => key === 'h1' && /^[a-f0-9]{64}$/i.test(value || '') && timingSafeEqual(expected, Buffer.from(value, 'hex')));
}
export function signer(jwk, keyId, issuer) {
  const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw Error('Expected a private P-256 JWK.');
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  return {
    publicJwk: { ...publicJwk, kid: keyId, alg: 'ES256', use: 'sig' },
    issue(claims) {
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: keyId })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ iss: issuer, aud: 'bypass-pro', ...claims })).toString('base64url');
      const input = `${header}.${body}`;
      return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    }
  };
}
export function verifyGrant(token, publicJwk, issuer, device, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const [h,p,s,...extra] = token.split('.'); if (extra.length || !h || !p || !s) return null;
    const head = JSON.parse(Buffer.from(h,'base64url')), claims = JSON.parse(Buffer.from(p,'base64url'));
    if (head.alg !== 'ES256' || head.kid !== publicJwk.kid || claims.iss !== issuer || claims.aud !== 'bypass-pro' || claims.device !== device || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || claims.exp <= now/1000 || claims.iat > now/1000+60 || claims.exp-claims.iat > 86400 || !['pro','trial','free'].includes(claims.plan)) return null;
    const key = createPublicKey({key:publicJwk,format:'jwk'});
    return verify('sha256',Buffer.from(`${h}.${p}`),{key,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')) ? claims : null;
  } catch { return null; }
}

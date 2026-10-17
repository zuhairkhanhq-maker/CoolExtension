import { generateKeyPairSync, randomBytes } from 'node:crypto';
const pair=generateKeyPairSync('ec',{namedCurve:'P-256'});
console.log('PRIVATE: store only as server SIGNING_PRIVATE_JWK');console.log(JSON.stringify(pair.privateKey.export({format:'jwk'})));
console.log('PUBLIC: copy into extension billing-config.js publicKeys entry');console.log(JSON.stringify({...pair.publicKey.export({format:'jwk'}),kid:'2026-01',alg:'ES256',use:'sig'}));
console.log('AUTH_HMAC_SECRET:');console.log(randomBytes(48).toString('hex'));

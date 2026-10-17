import {config} from '../src/config.js';
import {database,rate} from '../src/db.js';
import {Paddle} from '../src/paddle.js';
import {processEntity} from '../src/jobs.js';
import {uuid} from '../src/security.js';
const [intent,txn]=process.argv.slice(2);if(!uuid(intent)||!/^txn_[a-z0-9]{26}$/.test(txn||''))throw Error('Pass an exact intent UUID and Paddle transaction ID.');
const cfg=config(),pool=database(cfg),paddle=new Paddle(cfg,fetch,()=>rate(pool,'paddle-global',cfg.paddleRpm,60));
try{const stored=(await pool.query('SELECT * FROM checkout_intents WHERE id=$1',[intent])).rows[0];if(!stored)throw Error('Unknown intent');const remote=await paddle.get(`/transactions/${txn}`);if(remote.custom_data?.checkout_intent_id!==intent||remote.custom_data?.account_id!==stored.account_id)throw Error('Transaction does not belong to this intent/account.');await processEntity(pool,cfg,paddle,{entity_id:txn});console.log('Verified checkout state recovered.');}finally{await pool.end();}

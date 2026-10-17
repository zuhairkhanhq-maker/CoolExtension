import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { database,rate } from './db.js';
import { Paddle } from './paddle.js';
import { runOne, maintenance } from './jobs.js';
const cfg=config(),pool=database(cfg),paddle=new Paddle(cfg,fetch,()=>rate(pool,'paddle-global',cfg.paddleRpm,60));
let stopping=false,nextMaintenance=0;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
while(!stopping){
  try {const results=await Promise.all(Array.from({length:4},()=>runOne(pool,cfg,paddle)));
    if(Date.now()>nextMaintenance){nextMaintenance=Date.now()+60000;await maintenance(pool,cfg,paddle);}
    if(!results.some(Boolean))await delay(1000);
  }catch{console.error(JSON.stringify({event:'worker_failure'}));await delay(5000);}
}
await pool.end();

import { readFile } from 'node:fs/promises';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='false'?false:{rejectUnauthorized:true}});
const client=await pool.connect();
try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(84751309)");await client.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));await client.query('COMMIT');console.log('Billing schema ready.');}
catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}

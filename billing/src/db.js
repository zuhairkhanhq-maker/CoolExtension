import pg from 'pg';
export function database(cfg) { const url=new URL(cfg.database);for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);return new pg.Pool({connectionString:url.href,max:cfg.poolMax,ssl:cfg.ssl?{rejectUnauthorized:true}:false,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,application_name:'bypass-billing'}); }
export async function transaction(pool, fn) {
  const client=await pool.connect();
  try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export async function rate(pool,key,max,seconds) {
  const result=await pool.query(`INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.hits+1 END,reset_at=CASE WHEN rate_limits.reset_at<=now() THEN now()+$2*interval '1 second' ELSE rate_limits.reset_at END RETURNING hits`,[key,seconds]);
  if(result.rows[0].hits>max)throw Object.assign(Error('Too many attempts. Try again later.'),{status:429});
}

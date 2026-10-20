import pg from 'pg';
let pool;
export function db(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL missing');return pool??=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});}
export async function transaction(fn){const c=await db().connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout = '15s'");const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function readState(c=db(),lock=false){const {rows}=await c.query(`SELECT data,version FROM private.studio WHERE id=1 ${lock?'FOR UPDATE':''}`);if(!rows[0])throw new Error('Run npm run migrate');return rows[0];}
export async function writeState(c,data){const {rows}=await c.query('UPDATE private.studio SET data=$1, version=version+1 WHERE id=1 RETURNING version',[data]);return rows[0].version;}

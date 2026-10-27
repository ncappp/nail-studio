// Run only against a disposable local database. CI provisions a fresh service.
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { emptyState } from '../lib/model.js';
import { runMigrations } from '../lib/migrations.js';

const connection=process.env.TEST_DATABASE_URL;
if(!connection)throw new Error('TEST_DATABASE_URL is required; production is never used');
const target=new URL(connection);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Only a disposable local database ending in _test is allowed');
Object.assign(process.env,{DATABASE_URL:connection,ADMIN_TELEGRAM_ID:'999',BOT_TOKEN:'123:test',APP_URL:'https://example.com'});
const {db,transaction}=await import('../lib/db.js');
const {createBooking,updateBooking}=await import('../lib/service.js');
const {drain,telegram}=await import('../lib/notifications.js');
const observer=new pg.Client({connectionString:connection});await observer.connect();
let ownsStudio=false;
const day=new Date(Date.now()+5*86400000).toISOString().slice(0,10);
function fixture(){const s=emptyState();s.services=[{id:1,name:'Test',price:1000,dur:60,img:0}];s.slots[day]=['10:00','12:00','14:00'];return s;}
const input=(time='10:00')=>({date:day,time,serviceId:1,name:'Test client',phone:'@test_client',requestId:randomUUID()});
async function reset(){await db().query('DELETE FROM private.outbox');await db().query('UPDATE private.studio SET data=$1 WHERE id=1',[fixture()]);}
async function waitForAdvisoryWaiters(count){
 const until=Date.now()+5000;
 while(Date.now()<until){const {rows}=await observer.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");if(rows[0].n>=count)return;await delay(10);}
 throw new Error('Expected advisory lock wait was not observed');
}
try{
 await transaction(c=>runMigrations(c));
 const inserted=await db().query('INSERT INTO private.studio(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING',[fixture()]);
 if(inserted.rowCount!==1)throw new Error('Test database is not empty. Refusing to overwrite studio data');
 ownsStudio=true;
 assert.deepEqual(await transaction(c=>runMigrations(c)),[]);
 const concurrent=await Promise.allSettled(Array.from({length:8},(_,i)=>createBooking({id:100+i},input())));
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(concurrent.filter(r=>r.status==='rejected'&&r.reason.status===409).length,7);
 console.log('PASS: real PostgreSQL, multiple connections, one reservation wins');

 // Queue a reminder and hold the booking lock. Cancellation joins the lock
 // queue before the worker, so it must commit before the worker can send.
 await reset();const b=await createBooking({id:123},input());
 await db().query("UPDATE private.outbox SET dead=true WHERE dedupe NOT LIKE '%:remind:24'");
 await db().query("UPDATE private.outbox SET due_at=now(),expires_at=now()+interval '1 hour' WHERE NOT dead");
 const sent=[];telegram().api.sendMessage=async(...args)=>{sent.push(args);return {};};
 await observer.query('BEGIN');await observer.query('SELECT pg_advisory_xact_lock($1::bigint)',[b.id]);
 const cancellation=updateBooking({id:123},{id:b.id,action:'cancel'});await waitForAdvisoryWaiters(1);
 const worker=drain(1);await waitForAdvisoryWaiters(2);
 await observer.query('COMMIT');await cancellation;await worker;
 assert.equal(sent.length,0);
 console.log('PASS: committed cancellation invalidates an already claimed reminder');

 // The opposite order: cancellation cannot report success while a send for
 // that booking is still in flight. New bookings do not take this lock.
 await reset();const active=await createBooking({id:124},input());
 await db().query("UPDATE private.outbox SET dead=true WHERE dedupe NOT LIKE '%:remind:24'");
 await db().query("UPDATE private.outbox SET due_at=now(),expires_at=now()+interval '1 hour' WHERE NOT dead");
 let enterSend,finishSend;
 const entered=new Promise(r=>enterSend=r),release=new Promise(r=>finishSend=r);
 telegram().api.sendMessage=async()=>{enterSend();await release;return {};};
 const sending=drain(1);await entered;
 const changing=updateBooking({id:124},{id:active.id,action:'cancel'});await waitForAdvisoryWaiters(1);
 await createBooking({id:125},input('12:00'));
 finishSend();await sending;await changing;
 console.log('PASS: cancellation waits for its send; unrelated reservations remain available');
}finally{
 await observer.query('ROLLBACK').catch(()=>{});await observer.end();
 if(ownsStudio){await db().query('DELETE FROM private.outbox');await db().query('DELETE FROM private.audit_log');await db().query('DELETE FROM private.worker_status');await db().query('DELETE FROM private.studio');}
 await db().end();
}

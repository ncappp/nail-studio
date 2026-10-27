import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID,createHmac} from 'node:crypto';
import pg from 'pg';import {PGlite} from '@electric-sql/pglite';
import {emptyState} from '../lib/model.js';
const engine=new PGlite();let tail=Promise.resolve();
async function acquire(){const prior=tail;let release;tail=new Promise(r=>release=r);await prior;return release;}
const query=async(sql,params=[])=>{const r=await engine.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
// PGlite executes PostgreSQL SQL in-process. A single-connection pool adapter keeps
// transaction boundaries intact; hosted multi-connection behavior is a deployment gate.
pg.Pool=class {async connect(){const release=await acquire();return {query,release};}async query(...a){const c=await this.connect();try{return await c.query(...a);}finally{c.release();}}};
process.env.DATABASE_URL='test';process.env.ADMIN_TELEGRAM_ID='999';process.env.APP_URL='https://example.com';process.env.BOT_TOKEN='123:test';process.env.SUPABASE_URL='https://example.supabase.co';
const {createBooking,getView,saveConfig,updateBooking,getAudit,diagnostics,exportData,findBookingRequest}=await import('../lib/service.js');
const {db,readState}=await import('../lib/db.js');
const {drain,telegram}=await import('../lib/notifications.js');
const {default:handler}=await import('../api/index.js');
const date=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
const input=(time='10:00')=>({date,time,name:'Аня <script>alert(1)</script>',phone:'+79001112233',serviceId:1,requestId:randomUUID()});
before(async()=>{await engine.exec(await readFile(new URL('../sql/001_init.sql',import.meta.url),'utf8'));await engine.exec(await readFile(new URL('../sql/004_operations.sql',import.meta.url),'utf8'));const s=emptyState();s.services=[{id:1,name:'Гель',price:1500,dur:150,img:0,popular:true}];s.slots[date]=['10:00','12:00','12:30'];await query('INSERT INTO private.studio(id,data) VALUES(1,$1)',[JSON.stringify(s)]);});
after(async()=>engine.close());
test('transactional booking, concurrency, privacy and outbox lifecycle',async()=>{
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>createBooking({id:100+i},input())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,7);
 const b=results.find(r=>r.status==='fulfilled').value;
 const view=await getView({id:777});assert.equal(view.data.bookings.length,0);assert.equal(JSON.stringify(view.data).includes('79001112233'),false);
 assert.equal((await query('SELECT * FROM private.outbox')).rows.length,4);
 await assert.rejects(()=>updateBooking({id:777},{id:b.id,action:'cancel'}),e=>e.status===404);
 await assert.rejects(()=>createBooking({id:777},input('12:00')),e=>e.status===409);
 const duplicate=await createBooking({id:b.tgId},{...input(),requestId:b.requestId});assert.equal(duplicate.id,b.id);
 assert.equal((await query('SELECT * FROM private.outbox')).rows.length,4);
 await updateBooking({id:b.tgId},{id:b.id,action:'reschedule',date,time:'12:30'});
 assert.equal((await query('SELECT * FROM private.outbox WHERE NOT dead')).rows.length,4);
 await updateBooking({id:b.tgId},{id:b.id,action:'cancel'});
 assert.equal((await query('SELECT * FROM private.outbox WHERE NOT dead')).rows.length,2);
 const sent=[];telegram().api.sendMessage=async(...args)=>{sent.push(args);return {};};
 assert.equal((await drain(10)).delivered,2);assert.equal((await drain(10)).delivered,0);assert.equal(sent.length,2);
 const fresh=await createBooking({id:555},input());assert.ok(fresh.id!==b.id);
});
test('admin optimistic version conflict and client write rejection',async()=>{
 const {data,version}=await getView({id:999});const {bookings,...config}=data;config.studio='Pearl';
 await assert.rejects(()=>saveConfig({id:1},{version,config}),e=>e.status===403);
 await saveConfig({id:999},{version,config});
 await assert.rejects(()=>saveConfig({id:999},{version,config}),e=>e.status===409);
 assert.equal((await readState()).data.studio,'Pearl');
});
function sign(id){const p=new URLSearchParams({user:JSON.stringify({id}),auth_date:String(Math.floor(Date.now()/1000))});const key=createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();p.set('hash',createHmac('sha256',key).update([...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));return p.toString();}
async function call(action,method='GET',headers={},body={}){const res={code:200,setHeader(){},status(c){this.code=c;return this;},json(x){this.body=x;}};await handler({url:'/api?action='+action,method,headers,body},res);return res;}
test('API denies missing auth, forged admin and cron/webhook secrets',async()=>{
 assert.equal((await call('state')).code,401);
 assert.equal((await call('upload','POST',{'x-telegram-init-data':sign(123)},{image:'x'})).code,403);
 assert.equal((await call('webhook','POST')).code,401);
 assert.equal((await call('cron')).code,401);
 const view=await call('state','GET',{'x-telegram-init-data':sign(123)});assert.equal(view.code,200);assert.equal(view.body.admin,false);assert.deepEqual(view.body.data.notes,{});
 for(const action of ['export','audit','diagnostics'])assert.equal((await call(action,'GET',{'x-telegram-init-data':sign(123)})).code,403);
});
test('manual linking queues client delivery and request lookup is scoped to its creator',async()=>{
 const original=(await readState()).data.bookings.find(b=>b.status==='new');
 const b=await createBooking({id:999},{...input('12:30'),manual:true,clientBookingId:original.id});
 assert.equal(b.tgId,original.tgId);
 const jobs=await query('SELECT * FROM private.outbox WHERE booking_id=$1 AND chat_id=$2',[b.id,b.tgId]);assert.equal(jobs.rows.length,3);
 assert.equal((await findBookingRequest({id:999},b.requestId)).id,b.id);
 await assert.rejects(()=>findBookingRequest({id:777},b.requestId),e=>e.status===404);
});
test('conflicting breaks and buffer changes roll back, audit and diagnostics remain admin-only',async()=>{
 const admin={id:999},{data,version}=await getView(admin),{bookings,...config}=data;
 config.blocks=[{id:1,date,start:'11:00',end:'11:30',note:'private'}];
 const before=(await query('SELECT * FROM private.audit_log')).rows.length;
 await assert.rejects(()=>saveConfig(admin,{version,config}),e=>e.status===409);
 assert.equal((await query('SELECT * FROM private.audit_log')).rows.length,before);
 config.blocks=[];config.settings.bufferMinutes=15;
 await assert.rejects(()=>saveConfig(admin,{version,config}),e=>e.status===409);
 assert.equal((await getAudit(admin)).items.length>0,true);
 assert.equal((await diagnostics(admin)).database,true);
 assert.ok((await exportData(admin)).bookings.length>0);
});

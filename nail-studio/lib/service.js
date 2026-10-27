import { z } from 'zod';
import { db,transaction,readState,writeState,lockBooking,audit } from './db.js';
import { reserve,changeBooking,clientView,configSchema,bookingPage,instant,publicBooking } from './model.js';
import { isAdmin,requireAdmin,HttpError } from './auth.js';
import { bookingNotifications } from './notifications.js';
export async function getView(user){const {data,version}=await readState();return {data:isAdmin(user)?data:clientView(data,user),version,admin:isAdmin(user),user:{id:user.id,first_name:user.first_name||''}};}
export async function getHistory(user,before){const {data}=await readState();return bookingPage(data,user,before);}
export async function findBookingRequest(user,requestId){
 z.string().uuid().parse(requestId);
 const {data}=await readState(),b=data.bookings.find(b=>b.createdBy===user.id&&b.requestId===requestId);
 if(!b)throw new HttpError(404,'Запись не найдена');return publicBooking(b);
}
export async function createBooking(user,input){
 return transaction(async c=>{
  const {data}=await readState(c,true),result=reserve(data,input,user,{admin:isAdmin(user)&&input.manual===true});
  if(result.created){await writeState(c,data);await bookingNotifications(c,result.booking,'created',data.settings.timezone);await audit(c,user,'booking.created',result.booking.id,null,result.booking);}
  return result.booking;
 });
}
export async function updateBooking(user,input){
 const id=z.number().int().positive().parse(input.id);
 return transaction(async c=>{
  await lockBooking(c,id);
  const {data}=await readState(c,true),before=structuredClone(data.bookings.find(b=>b.id===id));
  const b=changeBooking(data,id,input.action,input,user,{admin:isAdmin(user)});
  await writeState(c,data);await bookingNotifications(c,b,input.action,data.settings.timezone);await audit(c,user,'booking.'+input.action,id,before,b);
  return b;
 });
}
export async function deleteBooking(user,id){
 requireAdmin(user);
 return transaction(async c=>{
  await lockBooking(c,id);
  const {data}=await readState(c,true),b=data.bookings.find(x=>x.id===id);
  if(!b)throw new HttpError(404,'Запись не найдена');
  if(b.status!=='cancel')throw new HttpError(409,'Сначала отмените запись');
  data.bookings=data.bookings.filter(x=>x.id!==id);await writeState(c,data);
  await c.query("UPDATE private.outbox SET dead=true,last_error='superseded' WHERE booking_id=$1 AND sent_at IS NULL",[id]);
  await audit(c,user,'booking.deleted',id,b,null);return {ok:true};
 });
}
export async function saveConfig(user,input){
 requireAdmin(user);
 const config=configSchema.parse(input.config),allowed=process.env.SUPABASE_URL+'/storage/v1/object/public/works/';
 if(config.photos.some(p=>!p.startsWith(allowed)||/["'<>\s]/.test(p)))throw new HttpError(400,'Фото должно быть загружено в хранилище студии');
 return transaction(async c=>{
  const {data,version}=await readState(c,true);
  if(input.version!==version)throw new HttpError(409,'Данные изменились на другом устройстве. Обновлено — повтори изменение');
  const future=data.bookings.filter(b=>b.status==='new'&&b.endMs>Date.now());
  if(config.settings.timezone!==data.settings.timezone&&future.length)throw new HttpError(409,'Нельзя менять часовой пояс при будущих записях');
  for(const b of future){
   if(config.blocks.some(block=>block.date===b.date&&b.startMs<instant(block.date,block.end,config.settings.timezone)&&b.endMs>instant(block.date,block.start,config.settings.timezone)))throw new HttpError(409,'Перерыв пересекается с записью. Сначала перенеси или отмени визит');
   if(b.endMs>instant(b.date,config.settings.dayEnd,config.settings.timezone))throw new HttpError(409,'Рабочий день заканчивается раньше существующего визита');
  }
  const buffer=config.settings.bufferMinutes*60000,ordered=[...future].sort((a,b)=>a.startMs-b.startMs);
  if(ordered.some((b,i)=>i&&b.startMs<ordered[i-1].endMs+buffer))throw new HttpError(409,'Буфер пересекается с существующими записями');
  const next={...config,bookings:data.bookings},{bookings:ignored,...before}=data;
  await audit(c,user,'config.saved','studio',before,config);
  return {version:await writeState(c,next)};
 });
}
export async function getAudit(user,before=null){
 requireAdmin(user);
 const id=before===null?null:z.coerce.number().int().positive().parse(before);
 const {rows}=await db().query('SELECT id,actor_id,action,entity_id,created_at FROM private.audit_log WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT 51',[id]);
 return {items:rows.slice(0,50),next:rows.length>50?String(rows[49].id):null};
}
export async function exportData(user){requireAdmin(user);const {data,version}=await readState();return {generatedAt:new Date().toISOString(),version,studio:data.studio,bookings:data.bookings,expenses:data.expenses};}
export async function diagnostics(user){
 requireAdmin(user);await readState();
 const {rows}=await db().query(`SELECT count(*) FILTER (WHERE sent_at IS NULL AND NOT dead AND (expires_at IS NULL OR expires_at>now()))::int AS pending,
 count(*) FILTER (WHERE sent_at IS NULL AND dead AND last_error IS NOT NULL AND last_error NOT IN ('superseded','expired'))::int AS dead,
 count(*) FILTER (WHERE sent_at IS NULL AND expires_at<=now() AND (NOT dead OR last_error='expired'))::int AS expired,
 min(due_at) FILTER (WHERE sent_at IS NULL AND NOT dead AND due_at<=now() AND (expires_at IS NULL OR expires_at>now())) AS oldest_due FROM private.outbox`);
 const worker=await db().query('SELECT finished_at,delivered FROM private.worker_status WHERE id=1');
 return {database:true,queue:rows[0],worker:worker.rows[0]||null,checkedAt:new Date().toISOString()};
}

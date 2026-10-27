import { randomInt, createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { HttpError } from './auth.js';
const text=(max=200)=>z.string().trim().max(max);
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>DateTime.fromISO(v).isValid);
export const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// Keep the historical `phone` key so existing bookings/client notes remain compatible.
const contactPattern=/^(?:\+?[1-9]\d{6,14}|@[a-zA-Z0-9_]{1,32})$/;
export const phone=z.string().max(200).transform((value,ctx)=>{
 let contact=value.trim();
 const link=contact.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{1,32})\/?$/i);
 if(link)contact='@'+link[1];
 contact=contact.startsWith('@')?contact.toLowerCase():contact.replace(/[\s()-]/g,'');
 if(!contactPattern.test(contact)){ctx.addIssue({code:'custom',message:'Укажи номер телефона или Telegram в формате @username'});return z.NEVER;}
 return contact;
});
export const bookingInput=z.object({date,time,serviceId:id,name:text(100).min(1),phone,requestId:z.string().uuid(),clientBookingId:id.nullable().optional()});
const service=z.object({id,name:text(150).min(1),price:z.number().finite().min(0).max(1000000),dur:z.number().int().min(5).max(720),img:z.number().int().nonnegative().max(100000),popular:z.boolean().optional()});
export const configSchema=z.object({studio:text(100).min(1),services:z.array(service).max(100).refine(a=>new Set(a.map(x=>x.id)).size===a.length),slots:z.record(date,z.array(time).max(96)),blocks:z.array(z.object({id,date,start:time,end:time,note:text(200)}).refine(b=>b.start<b.end)).max(2000).default([]),expenses:z.array(z.object({id,cat:text(60).min(1),amount:z.number().positive().max(100000000),note:text(500),date})).max(20000),cats:z.array(text(60).min(1)).max(50),photos:z.array(z.string().url().max(1000)).max(60),reviews:z.array(z.tuple([text(100),text(1000)])).max(100),notes:z.record(z.string().regex(contactPattern),text(2000)),settings:z.object({address:text(300),hours:text(200),tpl:z.array(time).max(96),timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid),dayEnd:time,bufferMinutes:z.number().int().min(0).max(120).default(0),masterContact:text(100).refine(v=>!v||contactPattern.test(v)).default('')})});
export const emptyState=()=>({studio:'Nail Studio',services:[],slots:{},bookings:[],expenses:[],cats:['Материалы','Аренда','Реклама','Инструменты','Коммуналка','Обучение','Прочее'],photos:[],reviews:[],notes:{},settings:{address:'',hours:'',tpl:['10:00','12:00','14:00','16:00','18:00'],timezone:'Europe/Samara',dayEnd:'21:00'}});
export function instant(d,t,zone){const v=DateTime.fromISO(`${d}T${t}`,{zone});if(!v.isValid||v.toFormat('HH:mm')!==t)throw new HttpError(400,'Некорректная дата или время');return v.toMillis();}
export function fits(state,d,t,dur,ignore=null,now=Date.now()){
 const start=instant(d,t,state.settings.timezone),end=start+dur*60000;
 const buffer=(state.settings.bufferMinutes||0)*60000;
 return start>now && (state.slots[d]||[]).includes(t) && end<=instant(d,state.settings.dayEnd,state.settings.timezone)
  && !(state.blocks||[]).some(b=>b.date===d&&start<instant(d,b.end,state.settings.timezone)&&end>instant(d,b.start,state.settings.timezone))
  && !state.bookings.some(b=>b.id!==ignore&&b.status!=='cancel'&&start<b.endMs+buffer&&end+buffer>b.startMs);
}
export function reserve(state,input,user,{admin=false,now=Date.now()}={}) {
 const v=bookingInput.parse(input);
 if(!admin&&v.clientBookingId)throw new HttpError(403,'Привязать клиентку может только мастер');
 const fingerprint=value=>createHash('sha256').update(JSON.stringify([value.date,value.time,value.serviceId,value.name,value.phone,!!value.manual,value.clientBookingId??null])).digest('hex');
 const requestFingerprint=fingerprint({...v,manual:admin});
 const existing=state.bookings.find(b=>b.requestId===v.requestId&&b.createdBy===user.id);
 if(existing){if((existing.requestFingerprint||fingerprint(existing))!==requestFingerprint)throw new HttpError(409,'Этот запрос уже использован для другой записи. Проверь «Мои записи» и повтори выбор');return {booking:existing,created:false};}
 const linked=v.clientBookingId?state.bookings.find(b=>b.id===v.clientBookingId&&Number.isSafeInteger(b.tgId)&&b.tgId>0&&b.phone===v.phone):null;
 if(v.clientBookingId&&!linked)throw new HttpError(400,'Выбери существующую клиентку заново');
 const s=state.services.find(s=>s.id===v.serviceId);if(!s)throw new HttpError(400,'Услуга больше недоступна');
 if(!admin&&state.bookings.filter(b=>b.tgId===user.id&&b.status==='new'&&b.startMs>now).length>=5)throw new HttpError(429,'У тебя уже есть 5 предстоящих записей');
 if(!fits(state,v.date,v.time,s.dur,null,now))throw new HttpError(409,'Время уже занято или услуга не помещается. Выбери другое окошко');
 const startMs=instant(v.date,v.time,state.settings.timezone);
 const b={...v,requestFingerprint,id:randomInt(1,281474976710655),tgId:admin?linked?.tgId??null:user.id,tgUsername:v.phone.startsWith('@')?v.phone.slice(1):linked?.tgUsername||(!admin&&/^[a-zA-Z0-9_]{1,32}$/.test(user.username||'')?user.username:null),createdBy:user.id,service:s.name,price:s.price,dur:s.dur,startMs,endMs:startMs+s.dur*60000,status:'new',manual:admin,revision:1};
 state.bookings.push(b);return {booking:b,created:true};
}
export function changeBooking(state,id,action,input,user,{admin=false,now=Date.now()}={}){
 const b=state.bookings.find(b=>b.id===id);if(!b||(!admin&&b.tgId!==user.id))throw new HttpError(404,'Запись не найдена');
 if(!admin&&(b.status!=='new'||b.startMs-now<12*3600000))throw new HttpError(409,'Отмена и перенос доступны не позже чем за 12 часов. Свяжись с мастером');
 if(action==='reschedule'){
  if(b.status!=='new')throw new HttpError(409,'Перенести можно только ожидаемый визит');
  const d=date.parse(input.date),t=time.parse(input.time);
  if(!fits(state,d,t,b.dur,b.id,now))throw new HttpError(409,'Это время недоступно');
  b.date=d;b.time=t;b.startMs=instant(d,t,state.settings.timezone);b.endMs=b.startMs+b.dur*60000;
 } else if(action==='cancel') b.status='cancel';
 else if(action==='status'&&admin){
  const status=z.enum(['new','done','noshow','cancel']).parse(input.status);
  if(['done','noshow'].includes(status)&&b.endMs>now)throw new HttpError(400,'Отметить визит можно после окончания');
  if(b.status==='cancel'&&status!=='cancel'&&state.bookings.some(x=>x.id!==b.id&&x.status!=='cancel'&&b.startMs<x.endMs&&b.endMs>x.startMs))throw new HttpError(409,'Время уже занято другой записью');
  if(status==='new'&&b.status!=='new'&&!fits(state,b.date,b.time,b.dur,b.id,now))throw new HttpError(409,'Восстановить запись нельзя: время недоступно');
  b.status=status;
 } else throw new HttpError(400,'Неизвестное действие');
 b.revision++;return b;
}
export const publicBooking=({requestId,requestFingerprint,createdBy,clientBookingId,...b})=>b;
export function bookingPage(state,user,before=null,limit=50){
 const cursor=before?z.tuple([z.number().finite(),id]).parse(before):null;
 const all=state.bookings.filter(b=>b.tgId===user.id&&(!cursor||b.startMs<cursor[0]||(b.startMs===cursor[0]&&b.id<cursor[1]))).sort((a,b)=>b.startMs-a.startMs||b.id-a.id);
 const bookings=all.slice(0,limit).map(publicBooking),last=bookings.at(-1);
 return {bookings,next:all.length>limit?[last.startMs,last.id]:null};
}
export function clientView(state,user,{now=Date.now()}={}){
 const start=DateTime.fromMillis(now).setZone(state.settings.timezone).toISODate(),end=DateTime.fromMillis(now).setZone(state.settings.timezone).plus({days:180}).toISODate();
 const page=bookingPage(state,user);
 return {studio:state.studio,services:state.services,settings:state.settings,photos:state.photos,reviews:state.reviews,expenses:[],cats:[],notes:{},bookings:page.bookings,historyNext:page.next,
  blocks:(state.blocks||[]).filter(b=>b.date>=start&&b.date<=end).map(({date,start,end})=>({date,start,end})),
  busy:state.bookings.filter(b=>b.status!=='cancel'&&b.endMs+(state.settings.bufferMinutes||0)*60000>now&&b.date<=end).map(b=>({id:b.id,startMs:b.startMs,endMs:b.endMs})),
  slots:Object.fromEntries(Object.entries(state.slots).filter(([d])=>d>=start&&d<=end))};
}

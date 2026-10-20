import { randomInt } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { HttpError } from './auth.js';
const text=(max=200)=>z.string().trim().max(max);
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>DateTime.fromISO(v).isValid);
export const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const phone=z.string().transform(v=>v.replace(/[\s()-]/g,'')).pipe(z.string().regex(/^\+?[1-9]\d{6,14}$/));
export const bookingInput=z.object({date,time,serviceId:id,name:text(100).min(1),phone,requestId:z.string().uuid()});
const service=z.object({id,name:text(150).min(1),price:z.number().finite().min(0).max(1000000),dur:z.number().int().min(5).max(720),img:z.number().int().nonnegative().max(100000),popular:z.boolean().optional()});
export const configSchema=z.object({studio:text(100).min(1),services:z.array(service).max(100).refine(a=>new Set(a.map(x=>x.id)).size===a.length),slots:z.record(date,z.array(time).max(96)),expenses:z.array(z.object({id,cat:text(60).min(1),amount:z.number().positive().max(100000000),note:text(500),date})).max(20000),cats:z.array(text(60).min(1)).max(50),photos:z.array(z.string().url().max(1000)).max(60),reviews:z.array(z.tuple([text(100),text(1000)])).max(100),notes:z.record(z.string().regex(/^\+?[1-9]\d{6,14}$/),text(2000)),settings:z.object({address:text(300),hours:text(200),tpl:z.array(time).max(96),timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid),dayEnd:time})});
export const emptyState=()=>({studio:'Nail Studio',services:[],slots:{},bookings:[],expenses:[],cats:['Материалы','Аренда','Реклама','Инструменты','Коммуналка','Обучение','Прочее'],photos:[],reviews:[],notes:{},settings:{address:'',hours:'',tpl:['10:00','12:00','14:00','16:00','18:00'],timezone:'Europe/Samara',dayEnd:'21:00'}});
export function instant(d,t,zone){const v=DateTime.fromISO(`${d}T${t}`,{zone});if(!v.isValid||v.toFormat('HH:mm')!==t)throw new HttpError(400,'Некорректная дата или время');return v.toMillis();}
export function fits(state,d,t,dur,ignore=null,now=Date.now()){
 const start=instant(d,t,state.settings.timezone),end=start+dur*60000;
 return start>now && (state.slots[d]||[]).includes(t) && end<=instant(d,state.settings.dayEnd,state.settings.timezone) && !state.bookings.some(b=>b.id!==ignore&&b.status!=='cancel'&&start<b.endMs&&end>b.startMs);
}
export function reserve(state,input,user,{admin=false,now=Date.now()}={}) {
 const v=bookingInput.parse(input);
 const existing=state.bookings.find(b=>b.requestId===v.requestId&&b.createdBy===user.id);if(existing)return {booking:existing,created:false};
 const s=state.services.find(s=>s.id===v.serviceId);if(!s)throw new HttpError(400,'Услуга больше недоступна');
 if(!admin&&state.bookings.filter(b=>b.tgId===user.id&&b.status==='new'&&b.startMs>now).length>=5)throw new HttpError(429,'У тебя уже есть 5 предстоящих записей');
 if(!fits(state,v.date,v.time,s.dur,null,now))throw new HttpError(409,'Время уже занято или услуга не помещается. Выбери другое окошко');
 const startMs=instant(v.date,v.time,state.settings.timezone);
 const b={...v,id:randomInt(1,281474976710655),tgId:admin?null:user.id,createdBy:user.id,service:s.name,price:s.price,dur:s.dur,startMs,endMs:startMs+s.dur*60000,status:'new',manual:admin,revision:1};
 state.bookings.push(b);return {booking:b,created:true};
}
export function changeBooking(state,id,action,input,user,{admin=false,now=Date.now()}={}){
 const b=state.bookings.find(b=>b.id===id);if(!b||(!admin&&b.tgId!==user.id))throw new HttpError(404,'Запись не найдена');
 if(!admin&&(b.status!=='new'||b.startMs-now<12*3600000))throw new HttpError(409,'Отмена и перенос доступны не позже чем за 12 часов. Свяжись с мастером');
 if(action==='reschedule'){
  const d=date.parse(input.date),t=time.parse(input.time);
  if(!fits(state,d,t,b.dur,b.id,now))throw new HttpError(409,'Это время недоступно');
  b.date=d;b.time=t;b.startMs=instant(d,t,state.settings.timezone);b.endMs=b.startMs+b.dur*60000;
 } else if(action==='cancel') b.status='cancel';
 else if(action==='status'&&admin){
  const status=z.enum(['new','done','noshow','cancel']).parse(input.status);
  if(['done','noshow'].includes(status)&&b.endMs>now)throw new HttpError(400,'Отметить визит можно после окончания');
  if(b.status==='cancel'&&status!=='cancel'&&state.bookings.some(x=>x.id!==b.id&&x.status!=='cancel'&&b.startMs<x.endMs&&b.endMs>x.startMs))throw new HttpError(409,'Время уже занято другой записью');
  b.status=status;
 } else throw new HttpError(400,'Неизвестное действие');
 b.revision++;return b;
}
export function clientView(state,user){return {...state,expenses:[],cats:[],notes:{},bookings:state.bookings.filter(b=>b.tgId===user.id).map(({requestId,createdBy,...b})=>b),busy:state.bookings.filter(b=>b.status!=='cancel').map(b=>({id:b.id,startMs:b.startMs,endMs:b.endMs})),slots:Object.fromEntries(Object.entries(state.slots).filter(([d])=>d>=DateTime.now().setZone(state.settings.timezone).toISODate()))};}

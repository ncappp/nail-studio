import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {emptyState,reserve,changeBooking,clientView,instant,configSchema,bookingPage} from '../lib/model.js';
const now=Date.parse('2030-01-01T00:00:00Z'),user={id:10};
export function fixture(){const s=emptyState();s.services=[{id:1,name:'Гель',price:1500,dur:150,img:0}];s.slots={'2030-01-02':['10:00','12:00','12:30','20:00']};return s;}
const input=(time='10:00')=>({date:'2030-01-02',time,serviceId:1,name:'Аня',phone:'+7 (900) 111-22-33',requestId:randomUUID()});
test('authoritative price, duration, phone normalization and idempotency',()=>{const s=fixture(),v={...input(),price:1,tgId:999};const a=reserve(s,v,user,{now});assert.equal(a.booking.price,1500);assert.equal(a.booking.tgId,10);assert.equal(a.booking.phone,'+79001112233');assert.equal(a.booking.endMs-a.booking.startMs,150*60000);assert.equal(reserve(s,v,user,{now}).created,false);assert.equal(s.bookings.length,1);});
test('overlapping intervals blocked, adjacent permitted, closing time enforced',()=>{const s=fixture();reserve(s,input(),user,{now});assert.throws(()=>reserve(s,input('12:00'),{id:11},{now}),/Время/);assert.equal(reserve(s,input('12:30'),{id:11},{now}).created,true);assert.throws(()=>reserve(s,input('20:00'),user,{now}));});
test('missing slot, past date and invalid phone rejected',()=>{const s=fixture();assert.throws(()=>reserve(s,input('11:00'),user,{now}));assert.throws(()=>reserve(s,input(),user,{now:Date.parse('2030-02-01')}));assert.throws(()=>reserve(s,{...input(),phone:'<script>'},user,{now}));});
test('cancel ownership, 12 hour deadline, canceled interval becomes free',()=>{const s=fixture(),b=reserve(s,input(),user,{now}).booking;assert.throws(()=>changeBooking(s,b.id,'cancel',{}, {id:11},{now}));assert.throws(()=>changeBooking(s,b.id,'cancel',{},user,{now:b.startMs-11*3600000}));changeBooking(s,b.id,'cancel',{},user,{now});assert.equal(reserve(s,input(),{id:11},{now}).created,true);});
test('reschedule keeps ID/price and blocks occupied target without changing old slot',()=>{const s=fixture(),b=reserve(s,input(),user,{now}).booking;reserve(s,input('12:30'),{id:11},{now});assert.throws(()=>changeBooking(s,b.id,'reschedule',{date:'2030-01-02',time:'12:30'},user,{now}));assert.equal(b.time,'10:00');changeBooking(s,b.id,'reschedule',{date:'2030-01-02',time:'10:00'},user,{now});assert.equal(b.price,1500);});
test('client cannot see other names/phones, finances or private notes',()=>{const s=fixture();s.notes['+79001112233']='allergy';s.expenses=[{amount:50}];reserve(s,input(),{id:999},{now});const v=clientView(s,user,{now});assert.deepEqual(v.bookings,[]);assert.deepEqual(v.expenses,[]);assert.deepEqual(v.notes,{});assert.equal(v.busy.length,1);assert.equal(JSON.stringify(v).includes('allergy'),false);assert.equal(JSON.stringify(v).includes('79001112233'),false);});
test('timezone is independent from host and config rejects broken time',()=>{assert.equal(instant('2030-01-02','10:00','Europe/Samara'),Date.parse('2030-01-02T06:00:00Z'));const s=fixture();delete s.bookings;assert.equal(configSchema.safeParse(s).success,true);s.settings.tpl=['25:00'];assert.equal(configSchema.safeParse(s).success,false);});

test('Telegram username comes only from verified user, not booking payload',()=>{const s=fixture();const b=reserve(s,{...input(),tgUsername:'forged'},{id:10,username:'client_verified'},{now}).booking;assert.equal(b.tgUsername,'client_verified');const old=fixture();assert.equal(reserve(old,{...input(),tgUsername:'forged'},{id:11},{now}).booking.tgUsername,null);});

test('one contact field accepts phone, Telegram username or t.me link',()=>{
 for(const [value,expected] of [['+7 (900) 111-22-33','+79001112233'],['@Anna_Nails','@anna_nails'],['https://t.me/Anna_Nails','@anna_nails'],['t.me/Anna_Nails/','@anna_nails']]){const s=fixture();const b=reserve(s,{...input(),phone:value},user,{now}).booking;assert.equal(b.phone,expected);if(expected.startsWith('@'))assert.equal(b.tgUsername,'anna_nails');}
 for(const bad of ['','anna nails','@anna nails','https://evil.example/user','<img src=x>'])assert.throws(()=>reserve(fixture(),{...input(),phone:bad},user,{now}));
});
test('manual Telegram contact and client notes do not require a phone number',()=>{const s=fixture();const b=reserve(s,{...input(),phone:'@client_name'},{id:999},{admin:true,now}).booking;assert.equal(b.tgId,null);assert.equal(b.tgUsername,'client_name');const {bookings,...config}=s;config.notes={'@client_name':'Предпочитает короткие ногти'};assert.equal(configSchema.safeParse(config).success,true);});

test('idempotency rejects changed payload and still returns original after reschedule',()=>{
 const s=fixture(),v=input(),b=reserve(s,v,user,{now}).booking;
 for(const patch of [{time:'12:30'},{name:'Другая'},{phone:'@different'},{manual:true}]){
  if(patch.manual)assert.throws(()=>reserve(s,{...v,...patch},user,{admin:true,now}),e=>e.status===409);
  else assert.throws(()=>reserve(s,{...v,...patch},user,{now}),e=>e.status===409);
 }
 changeBooking(s,b.id,'reschedule',{date:v.date,time:'12:30'},user,{now});
 assert.equal(reserve(s,v,user,{now}).booking.time,'12:30');assert.equal(s.bookings.length,1);
});
test('manual linking uses an existing verified booking, never a supplied Telegram ID',()=>{
 const s=fixture(),existing=reserve(s,input(),{id:123,username:'verified'},{now}).booking;
 const linked=reserve(s,{...input('12:30'),clientBookingId:existing.id,tgId:987},{id:999},{admin:true,now}).booking;
 assert.equal(linked.tgId,123);assert.equal(linked.tgUsername,'verified');
 assert.throws(()=>reserve(s,{...input(),clientBookingId:existing.id},user,{now}),e=>e.status===403);
 assert.throws(()=>reserve(s,{...input(),clientBookingId:existing.id,phone:'@someone_else'},{id:999},{admin:true,now}),e=>e.status===400);
});
test('breaks cover the entire service, buffer blocks adjacency, canceled visits cannot be moved',()=>{
 const s=fixture();s.blocks=[{id:1,date:'2030-01-02',start:'11:00',end:'11:30',note:'private break'}];
 assert.throws(()=>reserve(s,input(),user,{now}),e=>e.status===409);
 s.blocks=[];s.settings.bufferMinutes=15;const b=reserve(s,input(),user,{now}).booking;
 assert.throws(()=>reserve(s,input('12:30'),{id:11},{now}),e=>e.status===409);
 changeBooking(s,b.id,'cancel',{},user,{now});
 assert.throws(()=>changeBooking(s,b.id,'reschedule',{date:b.date,time:'12:30'},{id:999},{admin:true,now}),e=>e.status===409);
});
test('client history has a stable cursor, strips internal keys and exposes no break notes',()=>{
 const s=fixture();s.blocks=[{id:1,date:'2030-01-02',start:'14:00',end:'15:00',note:'private reason'}];
 s.bookings=Array.from({length:55},(_,i)=>({id:i+1,tgId:10,date:'2030-01-02',startMs:now+86400000+i,endMs:now+86460000+i,status:'done',requestId:'secret',requestFingerprint:'secret',createdBy:10}));
 const page=bookingPage(s,user);assert.equal(page.bookings.length,50);assert.equal(bookingPage(s,user,page.next).bookings.length,5);
 assert.equal(bookingPage(s,{id:99}).bookings.length,0);
 const visible=JSON.stringify(clientView(s,user,{now}));assert.equal(visible.includes('private reason'),false);assert.equal(visible.includes('secret'),false);
});
test('master can correct attendance before, during and after a visit, clients cannot',()=>{
 for(const offset of [-3600000,1800000,4*3600000]){
  const s=fixture(),b=reserve(s,input(),user,{now}).booking,at=b.startMs+offset;
  for(const status of ['done','noshow','new'])assert.equal(changeBooking(s,b.id,'status',{status},{id:999},{admin:true,now:at}).status,status);
 }
 const s=fixture(),b=reserve(s,input(),user,{now}).booking;
 assert.throws(()=>changeBooking(s,b.id,'status',{status:'done'},user,{now}),e=>e.status>=400);
 changeBooking(s,b.id,'cancel',{},user,{now});s.slots={};
 assert.equal(changeBooking(s,b.id,'status',{status:'new'},{id:999},{admin:true,now:b.endMs+86400000}).status,'new');
});
test('master status override still cannot restore a canceled interval occupied by another visit',()=>{
 const s=fixture(),b=reserve(s,input(),user,{now}).booking;
 changeBooking(s,b.id,'cancel',{},user,{now});reserve(s,input(),{id:11},{now});
 for(const status of ['new','done','noshow'])assert.throws(()=>changeBooking(s,b.id,'status',{status},{id:999},{admin:true,now}),e=>e.status===409);
});

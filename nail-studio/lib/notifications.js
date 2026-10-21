import { Bot } from 'grammy';
import { db,transaction } from './db.js';
let bot;
export function telegram(){return bot??=new Bot(process.env.BOT_TOKEN);}
const appButton=()=>({inline_keyboard:[[{text:'Мои записи · отмена / перенос',web_app:{url:process.env.APP_URL+'/#mine'}}]]});
export async function queue(c,key,chat,payload,due=Date.now(),booking=null,expires=null){if(!chat)return;await c.query('INSERT INTO private.outbox(dedupe,chat_id,booking_id,revision,payload,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[key,chat,booking?.id??null,booking?.revision??null,payload,new Date(due),expires?new Date(expires):null]);}
export async function bookingNotifications(c,b,kind,zone){
 await c.query('UPDATE private.outbox SET dead=true WHERE booking_id=$1 AND sent_at IS NULL',[b.id]);
 const label={created:'Новая запись',cancel:'Запись отменена',reschedule:'Запись перенесена',status:'Статус записи изменён'}[kind];
 const details=`${b.date}, ${b.time} (${zone})\n${b.service} · ${b.price} ₽`;
 await queue(c,`${b.id}:${b.revision}:admin`,process.env.ADMIN_TELEGRAM_ID,{text:`${label}\n${b.name} · ${b.phone}\n${details}\nСтатус: ${{new:'ожидается',done:'пришла',noshow:'не пришла',cancel:'отмена'}[b.status]}`,reply_markup:{inline_keyboard:[[{text:'Кабинет мастера',web_app:{url:process.env.APP_URL+'/#admin'}}]]}},Date.now(),b);
 if(kind!=='status'||b.status==='cancel')await queue(c,`${b.id}:${b.revision}:client`,b.tgId,{text:`${kind==='created'?'Ты записана 💗':label}\n${details}\nОтмена и перенос — не позже чем за 12 часов.`,reply_markup:appButton()},Date.now(),b);
 if(b.status==='new')for(const h of [24,2]){const due=b.startMs-h*3600000;if(due>Date.now())await queue(c,`${b.id}:${b.revision}:remind:${h}`,b.tgId,{text:`Напоминание 💗 Твой визит примерно через ${h} ч.\n${details}`,reply_markup:appButton()},due,b,Math.min(due+30*60000,b.startMs));}
}
// Durable at-least-once delivery. A crash after Telegram accepts a message but before
// sent_at is saved can produce a duplicate: Telegram sendMessage has no idempotency key.
export async function drain(limit=20){
 let delivered=0;const deadline=Date.now()+35000;
 for(let i=0;i<limit&&Date.now()<deadline;i++){
  const job=await transaction(async c=>{const {rows}=await c.query(`WITH picked AS (SELECT id FROM private.outbox WHERE sent_at IS NULL AND NOT dead AND due_at<=now() AND (expires_at IS NULL OR expires_at>now()) AND (lease_until IS NULL OR lease_until<now()) ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE private.outbox o SET lease_until=now()+interval '2 minutes',attempts=attempts+1 FROM picked WHERE o.id=picked.id RETURNING o.*`);return rows[0];});
  if(!job)break;
  try{
   // Recheck after claiming: a cancellation/reschedule may have invalidated the job.
   const {rows}=await db().query('SELECT dead FROM private.outbox WHERE id=$1',[job.id]);if(rows[0]?.dead)continue;
   await telegram().api.sendMessage(job.chat_id,job.payload.text,{reply_markup:job.payload.reply_markup},AbortSignal.timeout(10000));
   await db().query('UPDATE private.outbox SET sent_at=now(),lease_until=NULL WHERE id=$1',[job.id]);delivered++;
  }catch(e){const permanent=[400,403].includes(e.error_code);const delay=e.parameters?.retry_after||Math.min(3600,30*2**Math.min(job.attempts,7));await db().query("UPDATE private.outbox SET dead=$2,last_error=$3,lease_until=NULL,due_at=now()+$4*interval '1 second' WHERE id=$1",[job.id,permanent||job.attempts>=10,String(e.error_code||'network'),delay]);}
 }
 return {delivered};
}

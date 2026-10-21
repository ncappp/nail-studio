import { authenticate,requireAdmin,checkSecret,HttpError } from '../lib/auth.js';
import { getView,createBooking,updateBooking,saveConfig,deleteBooking } from '../lib/service.js';
import { drain,queue } from '../lib/notifications.js';
import { transaction } from '../lib/db.js';
import { z } from 'zod';
export const config={maxDuration:60};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const url=new URL(req.url,'https://local'),action=url.searchParams.get('action')||req.query?.action;
  if(action==='health'){res.status(200).json({ok:true});return;}
  if(action==='cron'){if(req.method!=='POST'&&req.method!=='GET')throw new HttpError(405,'Метод не поддерживается');checkSecret(req.headers.authorization,`Bearer ${process.env.CRON_SECRET||''}`);if(!process.env.CRON_SECRET)throw new HttpError(503,'Cron не настроен');return res.status(200).json(await drain(25));}
  if(action==='webhook'){
   if(req.method!=='POST')throw new HttpError(405,'Метод не поддерживается');checkSecret(req.headers['x-telegram-bot-api-secret-token'],process.env.TELEGRAM_WEBHOOK_SECRET);
   const update=req.body,updateId=z.number().int().parse(update?.update_id);
   await transaction(async c=>{
    const {rowCount}=await c.query('INSERT INTO private.bot_updates(id) VALUES($1) ON CONFLICT DO NOTHING',[updateId]);if(!rowCount)return;
    const m=update.message;if(!m||m.chat?.type!=='private'||!m.from)return;
    const cmd=(m.text||'').split(/[ @]/)[0];
    const text=cmd==='/id'?`Твой Telegram ID: ${m.from.id}`:cmd==='/appointments'?'Твои записи, отмена и перенос — в приложении.':'Привет! Здесь можно выбрать услугу и записаться на маникюр 💗\nОтмена и перенос — не позже чем за 12 часов до визита.';
    await queue(c,`update:${updateId}`,m.chat.id,{text,reply_markup:{inline_keyboard:[[{text:cmd==='/appointments'?'Мои записи':'Открыть запись',web_app:{url:process.env.APP_URL+(cmd==='/appointments'?'/#mine':'/')}}]]}});
   });
   try{await drain(5);}catch{console.error('outbox delayed');}return res.status(200).json({ok:true});
  }
  const user=authenticate(req.headers['x-telegram-init-data'],process.env.BOT_TOKEN);
  if(action==='state'&&req.method==='GET')return res.status(200).json(await getView(user));
  if(req.method!=='POST')throw new HttpError(405,'Метод не поддерживается');
  const body=req.body||{};
  if(action==='save'){const r=await saveConfig(user,body);return res.status(200).json(r);}
  if(action==='book'){const r=await createBooking(user,body);try{await drain(4);}catch{console.error('outbox delayed');}return res.status(200).json(r);}
  if(action==='change'){const r=await updateBooking(user,body);try{await drain(4);}catch{console.error('outbox delayed');}return res.status(200).json(r);}
  if(action==='delete')return res.status(200).json(await deleteBooking(user,z.number().int().positive().parse(body.id)));
  if(action==='upload'){
   requireAdmin(user);
   const encoded=z.string().max(2800000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).parse(body.image);
   const bytes=Buffer.from(encoded.split(',')[1],'base64');if(bytes.length>2000000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new HttpError(400,'Нужен JPEG до 2 МБ');
   if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new HttpError(503,'Хранилище ещё не настроено');
   const path=`${crypto.randomUUID()}.jpg`,root=process.env.SUPABASE_URL;
   const r=await fetch(`${root}/storage/v1/object/works/${path}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'image/jpeg'},body:bytes,signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new HttpError(502,'Не удалось загрузить фото');return res.status(200).json({url:`${root}/storage/v1/object/public/works/${path}`});
  }
  throw new HttpError(404,'Не найдено');
 }catch(e){const status=e instanceof z.ZodError?400:e.status||500;if(status===500)console.error('API error',e.code||e.name);res.status(status).json({error:e instanceof z.ZodError?'Проверь поля: '+e.issues.map(i=>i.path[0]==='phone'?'номер телефона или Telegram в формате @username':i.path.join('.')).join(', '):status===500?'Сервис временно недоступен. Попробуй ещё раз':e.message});}
}

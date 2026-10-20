import { Bot } from 'grammy';
for(const k of ['BOT_TOKEN','APP_URL','TELEGRAM_WEBHOOK_SECRET'])if(!process.env[k])throw new Error(k+' is required');
const app=new URL(process.env.APP_URL);if(app.protocol!=='https:'||app.pathname!=='/')throw new Error('APP_URL must be HTTPS origin without path');
const b=new Bot(process.env.BOT_TOKEN);
await b.api.setWebhook(`${app.origin}/api/index?action=webhook`,{secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'],drop_pending_updates:false});
await b.api.setChatMenuButton({menu_button:{type:'web_app',text:'Записаться',web_app:{url:app.origin}}});
await b.api.setMyCommands([{command:'start',description:'Открыть запись'},{command:'appointments',description:'Мои записи, отмена и перенос'},{command:'id',description:'Мой Telegram ID'}]);
console.log('Webhook и меню бота настроены. Отправь боту /start.');

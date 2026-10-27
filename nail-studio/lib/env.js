export function validateEnvironment(env=process.env){
 const required=['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','BOT_TOKEN','ADMIN_TELEGRAM_ID','APP_URL','TELEGRAM_WEBHOOK_SECRET','CRON_SECRET'];
 const invalid=required.filter(k=>!env[k]);
 for(const k of ['SUPABASE_URL','APP_URL']){
  try{const u=new URL(env[k]);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)invalid.push(k);}catch{invalid.push(k);}
 }
 if(!/^[1-9]\d*$/.test(env.ADMIN_TELEGRAM_ID||''))invalid.push('ADMIN_TELEGRAM_ID');
 if(!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL||''))invalid.push('DATABASE_URL');
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(env.BOT_TOKEN||''))invalid.push('BOT_TOKEN');
 for(const k of ['TELEGRAM_WEBHOOK_SECRET','CRON_SECRET'])if(!/^[A-Za-z0-9_-]{32,256}$/.test(env[k]||''))invalid.push(k);
 if(env.TELEGRAM_WEBHOOK_SECRET===env.CRON_SECRET)invalid.push('CRON_SECRET');
 if(invalid.length)throw new Error('Проверь серверные переменные: '+[...new Set(invalid)].join(', '));
}

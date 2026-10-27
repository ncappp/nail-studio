import { readFile } from 'node:fs/promises';
import { transaction,db } from '../lib/db.js';
import { emptyState } from '../lib/model.js';
import { runMigrations } from '../lib/migrations.js';
const catalog=JSON.parse(await readFile(new URL('../sql/catalog.json',import.meta.url),'utf8'));
try{
 const applied=await transaction(async c=>{const result=await runMigrations(c,{storage:process.argv.includes('--storage'),cron:process.argv.includes('--cron')});const s=emptyState();s.services=catalog;await c.query('INSERT INTO private.studio(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING',[s]);return result;});
 console.log('Схема готова. Новые миграции:',applied.join(', ')||'нет');
}finally{await db().end();}

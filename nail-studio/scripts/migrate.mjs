import { readFile } from 'node:fs/promises';
import { transaction,db } from '../lib/db.js';
import { emptyState } from '../lib/model.js';
const catalog=JSON.parse(await readFile(new URL('../sql/catalog.json',import.meta.url),'utf8'));
await transaction(async c=>{await c.query(await readFile(new URL('../sql/001_init.sql',import.meta.url),'utf8'));const s=emptyState();s.services=catalog;await c.query('INSERT INTO private.studio(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING',[s]);});
console.log('Схема готова. Демо-записи не импортированы.');await db().end();

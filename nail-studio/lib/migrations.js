import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function runMigrations(c,{storage=false,cron=false}={}){
 await c.query('SELECT pg_advisory_xact_lock(-190001::bigint)');
 await c.query('CREATE SCHEMA IF NOT EXISTS private; REVOKE ALL ON SCHEMA private FROM PUBLIC');
 await c.query('CREATE TABLE IF NOT EXISTS private.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()); ALTER TABLE private.schema_migrations ENABLE ROW LEVEL SECURITY');
 const names=['001_init.sql','004_operations.sql',...(storage?['002_storage.sql']:[]),...(cron?['003_reminders.sql']:[])];
 const applied=[];
 for(const name of names){
  const sql=await readFile(new URL('../sql/'+name,import.meta.url),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
  const {rows}=await c.query('SELECT checksum FROM private.schema_migrations WHERE name=$1',[name]);
  if(rows[0]){if(rows[0].checksum!==checksum)throw new Error('Изменена применённая миграция '+name+'. Добавь новый файл вместо редактирования старого');continue;}
  await c.query(sql);
  await c.query('INSERT INTO private.schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
  applied.push(name);
 }
 return applied;
}

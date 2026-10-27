import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../lib/migrations.js';
test('migrations are repeatable, keep existing data and detect checksum drift',async()=>{
 const engine=new PGlite(),c={query:(sql,params)=>params?engine.query(sql,params):engine.exec(sql).then(results=>results.at(-1))};
 try{
  assert.deepEqual(await runMigrations(c),['001_init.sql','004_operations.sql']);
  await c.query('INSERT INTO private.studio(id,data) VALUES(1,$1)',[{studio:'Existing'}]);
  assert.deepEqual(await runMigrations(c),[]);
  assert.equal((await c.query('SELECT data FROM private.studio WHERE id=1')).rows[0].data.studio,'Existing');
  await c.query("UPDATE private.schema_migrations SET checksum='changed' WHERE name='001_init.sql'");
  await assert.rejects(()=>runMigrations(c),/Изменена применённая миграция/);
 }finally{await engine.close();}
});

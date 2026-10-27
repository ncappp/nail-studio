import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../lib/env.js';
import { bookingCsv,expenseCsv } from '../public/export.mjs';
test('configuration rejects incomplete secrets and invalid URLs without echoing values',()=>{
 const env={DATABASE_URL:'postgresql://localhost/pearl',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',BOT_TOKEN:'123:abc',ADMIN_TELEGRAM_ID:'999',APP_URL:'https://example.com',TELEGRAM_WEBHOOK_SECRET:'a'.repeat(32),CRON_SECRET:'b'.repeat(32)};
 assert.doesNotThrow(()=>validateEnvironment(env));
 for(const patch of [{APP_URL:'https://example.com/path'},{APP_URL:'https://example.com?secret=x'},{ADMIN_TELEGRAM_ID:'abc'},{CRON_SECRET:'short'},{CRON_SECRET:env.TELEGRAM_WEBHOOK_SECRET}])assert.throws(()=>validateEnvironment({...env,...patch}));
 assert.throws(()=>validateEnvironment({}),e=>!e.message.includes('server-only'));
});
test('CSV preserves quotes/newlines and neutralizes formulas in contact and name cells',()=>{
 const text=bookingCsv({bookings:[{id:1,name:' =HYPERLINK("evil")',phone:'+79001234567',service:'Ногти\n"дизайн"',price:1000}]});
 assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes("' =HYPERLINK"));assert.ok(text.includes("'+79001234567"));assert.ok(text.includes('Ногти\n""дизайн""'));
 assert.ok(expenseCsv({expenses:[{id:1,note:'@SUM(A1)'}]}).includes("'@SUM(A1)"));
});

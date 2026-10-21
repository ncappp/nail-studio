import { chromium } from 'playwright';
import bundled from '@sparticuz/chromium';
import { spawn } from 'node:child_process';
import { readFile,mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { emptyState,clientView,reserve,changeBooking,configSchema } from '../lib/model.js';
const server=spawn(process.execPath,['scripts/dev.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'3099'},stdio:'pipe'});
await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(String(d).includes('localhost:3099'))resolve();});server.on('exit',c=>reject(new Error('Dev server exited '+c)));});
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await bundled.executablePath(),args:bundled.args,headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});
 const errors=[],actions=[];let admin=false,version=1;
 let state=emptyState();state.studio='Pearl';state.services=JSON.parse(await readFile('sql/catalog.json','utf8'));state.settings.address='Тестовый адрес';
 const day=DateTime.now().setZone('Europe/Samara').plus({days:4}).toISODate();state.slots[day]=['10:00','12:00','14:00','16:00','18:00'];
 const user={id:123,first_name:'Аня'};
 await context.addInitScript(()=>{window.telegramLinks=[];window.Telegram={WebApp:{openTelegramLink(url){window.telegramLinks.push(url);},initData:'test-only-browser-fixture',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},HapticFeedback:{selectionChanged(){},notificationOccurred(){}}}};});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!=='http://localhost:3099')return route.abort();
  if(url.pathname!=='/api/index')return route.continue();
  const action=url.searchParams.get('action');actions.push(action);let result;
  try{
   const b=req.method()==='POST'?req.postDataJSON():{};
   if(action==='state')result={data:admin?state:clientView(state,user),version,admin,user};
   else if(action==='book'){result=reserve(state,b,user,{admin:!!b.manual}).booking;version++;}
   else if(action==='change'){result=changeBooking(state,b.id,b.action,b,user,{admin});version++;}
   else if(action==='save'){assert.equal(b.version,version);state={...configSchema.parse(b.config),bookings:state.bookings};result={version:++version};}
   else if(action==='upload')result={url:'https://test.supabase.co/storage/v1/object/public/works/test.jpg'};
   else throw new Error('Unexpected action '+action);
   await route.fulfill({json:result});
  }catch(e){await route.fulfill({status:e.status||400,json:{error:e.message}});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://localhost:3099');await page.locator('#loading').waitFor({state:'hidden'});
 assert.equal(await page.locator('#admBtn').isVisible(),false);
 await mkdir('test-output',{recursive:true});await page.evaluate(()=>document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')));await page.screenshot({path:'test-output/home.png',fullPage:true});
 await page.locator('#mainBtn').click();await page.locator('.tm').first().click();await page.locator('#mainBtn').click();await page.locator('.sc').first().click();await page.locator('#mainBtn').click();
 await page.locator('#cName').fill('<img src=x onerror=alert(1)>');await page.locator('#cPhone').fill('+79001112233');await page.locator('#mainBtn').click();
 await page.locator('#s-ok.on').waitFor();assert.equal(state.bookings.length,1);
 await page.locator('#mainBtn').click();await page.getByRole('button',{name:'Мои записи',exact:true}).click();
 await page.getByRole('button',{name:'Перенести',exact:true}).click();await page.locator('#moveTime').selectOption('14:00');await page.getByRole('button',{name:'Подтвердить перенос'}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings[0].time,'14:00');
 await page.getByRole('button',{name:'Отменить',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings[0].status,'cancel');
 admin=true;await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();
 for(const label of ['Сегодня','Записи','Окошки','Финансы','Клиенты']){await page.locator('.tb').filter({hasText:label}).click();await page.locator('#apanel').waitFor();}
 await page.locator('.tb').filter({hasText:'Финансы'}).click();await page.getByRole('button',{name:'+ Добавить расход'}).click();await page.locator('#eA').fill('1200');await page.locator('#eN').fill('Материалы <тест>');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.expenses.length,1);
 await page.locator('.tb').filter({hasText:'Окошки'}).click();await page.screenshot({path:'test-output/admin.png',fullPage:true});
 await page.locator('.ahb button').last().click();await page.locator('#sheetC input').first().fill('Pearl Studio');await page.locator('#sheetC input').first().press('Tab');await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.studio,'Pearl Studio');
 await page.locator('#sheetC .mrow').filter({hasText:'Фото работ'}).click();
 await page.locator('input[type=file]').setInputFiles('public/work-0.jpg');await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.photos.length,1);
 await page.locator('#sbg').click({position:{x:5,y:5}});await page.locator('.tb').filter({hasText:'Записи'}).click();await page.locator('#fab').click();
 await page.locator('#nbN').fill('Мария');await page.locator('#nbP').fill('+79002223344');await page.getByRole('button',{name:'Записать',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings.filter(b=>b.status==='new').length,1);
 assert.equal(await page.locator('img[onerror]').count(),0);assert.deepEqual(errors,[]);
 // Real button handlers: manual contact phone fallback, verified username,
 // profile contact, and self-record feedback (no broken deep-link navigation).
 await page.evaluate(()=>{closeSheet();atab='today';go('admin');});
 await page.getByRole('button',{name:'Написать',exact:true}).click();
 assert.equal((await page.evaluate(()=>window.telegramLinks)).at(-1),'https://t.me/+79002223344');
 const other=reserve(state,{date:day,time:'16:00',serviceId:1,name:'Клиентка',phone:'+79005556677',requestId:crypto.randomUUID()},{id:456,username:'client_verified'}).booking;version++;
 await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();
 await page.evaluate(id=>bookInfo(id),other.id);await page.getByRole('button',{name:'Telegram',exact:true}).click();
 assert.equal((await page.evaluate(()=>window.telegramLinks)).at(-1),'https://t.me/client_verified');
 await page.evaluate(()=>clientInfo('+79005556677'));await page.getByRole('button',{name:'Telegram',exact:true}).click();
 assert.equal((await page.evaluate(()=>window.telegramLinks)).at(-1),'https://t.me/client_verified');
 const before=(await page.evaluate(()=>window.telegramLinks)).length;
 await page.evaluate(()=>contactTelegram(DB.bookings.find(b=>b.tgId===SESSION.user.id).id));
 assert.equal((await page.evaluate(()=>window.telegramLinks)).length,before);
 assert.equal(await page.locator('a[href^="tg://"]').count(),0);assert.deepEqual(errors,[]);
 
 // The same single field supports a Telegram-only client; no phone call links.
 admin=false;await page.reload();await page.locator('#loading').waitFor({state:'hidden'});
 await page.locator('#mainBtn').click();await page.locator('.tm').filter({hasText:'18:00'}).click();await page.locator('#mainBtn').click();await page.locator('.sc').first().click();await page.locator('#mainBtn').click();
 assert.equal(await page.locator('label[for=cPhone]').innerText(),'Телефон или Telegram');
 await page.locator('#cPhone').fill('@Telegram_Only');await page.locator('#mainBtn').click();await page.locator('#s-ok.on').waitFor();
 const tgOnly=state.bookings.find(b=>b.phone==='@telegram_only');assert.ok(tgOnly);assert.equal(tgOnly.tgUsername,'telegram_only');
 admin=true;await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();await page.evaluate(id=>bookInfo(id),tgOnly.id);
 assert.equal(await page.locator('#sheetC a[href^="tel:"]').count(),0);assert.ok((await page.locator('#sheetC').innerText()).includes('@telegram_only'));
 await page.evaluate(()=>clientInfo('@telegram_only'));await page.locator('#sheetC textarea').fill('Заметка для Telegram-клиентки');await page.locator('#sheetC textarea').press('Tab');await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.notes['@telegram_only'],'Заметка для Telegram-клиентки');assert.deepEqual(errors,[]);
 console.log('UI PASS: booking, move, cancel, admin tabs, expense, settings, photo upload, manual booking; Telegram contacts (phone, username, self), no JS errors or injected elements');
 console.log('Actions:',actions.join(', '));
}finally{await browser?.close();server.kill();}

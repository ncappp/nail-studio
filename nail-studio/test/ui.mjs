import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile,mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { emptyState,clientView,reserve,changeBooking,configSchema } from '../lib/model.js';
const server=spawn(process.execPath,['scripts/dev.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'3099',NODE_ENV:'test'},stdio:'pipe'});
await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(String(d).includes('localhost:3099'))resolve();});server.on('exit',c=>reject(new Error('Dev server exited '+c)));});
let browser;
try{
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),...(process.platform==='darwin'?{args:['--in-process-gpu']}:{}),headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});
 const errors=[],actions=[];let admin=false,version=1,loseNextBookingReply=false;
 let state=emptyState();state.studio='Pearl';state.services=JSON.parse(await readFile('sql/catalog.json','utf8'));state.settings.address='Тестовый адрес';
 const day=DateTime.now().setZone('Europe/Samara').plus({days:4}).toISODate();state.slots[day]=['10:00','12:00','14:00','16:00','18:00'];
 const user={id:123,first_name:'Аня'};
 await context.addInitScript(()=>{window.prompt=()=>{throw new Error('Native prompt must not be used for time editing');};window.telegramLinks=[];window.Telegram={WebApp:{openTelegramLink(url){window.telegramLinks.push(url);},initData:'test-only-browser-fixture',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},HapticFeedback:{selectionChanged(){},notificationOccurred(){}}}};});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!=='http://localhost:3099')return route.abort();
  if(url.pathname!=='/api/index')return route.continue();
  const action=url.searchParams.get('action');actions.push(action);let result;
  try{
   const b=req.method()==='POST'?req.postDataJSON():{};
   if(action==='state')result={data:admin?state:clientView(state,user),version,admin,user};
   else if(action==='book'){result=reserve(state,b,user,{admin:!!b.manual}).booking;version++;if(loseNextBookingReply){loseNextBookingReply=false;return route.abort('failed');}}
   else if(action==='booking-request'){result=state.bookings.find(b=>b.createdBy===user.id&&b.requestId===url.searchParams.get('requestId'));if(!result)return route.fulfill({status:404,json:{error:'Not found'}});}
   else if(action==='change'){result=changeBooking(state,b.id,b.action,b,user,{admin});version++;}
   else if(action==='save'){assert.equal(b.version,version);state={...configSchema.parse(b.config),bookings:state.bookings};result={version:++version};}
   else if(action==='upload')result={url:'https://test.supabase.co/storage/v1/object/public/works/test.jpg'};
   else if(action==='export')result={bookings:state.bookings,expenses:state.expenses};
   else if(action==='audit')result={items:[{id:1,actor_id:999,action:'booking.created',entity_id:'1',created_at:new Date().toISOString()}],next:null};
   else if(action==='diagnostics')result={queue:{pending:0,dead:0,expired:0},worker:{finished_at:new Date().toISOString()}};
   else throw new Error('Unexpected action '+action);
   await route.fulfill({json:result});
  }catch(e){await route.fulfill({status:e.status||400,json:{error:e.message}});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://localhost:3099');await page.locator('#loading').waitFor({state:'hidden'});
 assert.equal(await page.locator('#admBtn').isVisible(),false);
 await mkdir('test-output',{recursive:true});await page.evaluate(()=>document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')));await page.screenshot({path:'test-output/home.png',fullPage:true,animations:'disabled'});
 await page.locator('#mainBtn').click();await page.locator('.tm').first().click();await page.locator('#mainBtn').click();await page.locator('.sc').first().click();await page.locator('#mainBtn').click();
 assert.equal(await page.locator('#cName').inputValue(),'');assert.equal(await page.locator('#cName').getAttribute('placeholder'),'Введите ваше имя');assert.equal(await page.locator('#cName').getAttribute('aria-required'),'true');
 await page.locator('#cPhone').fill('+79001112233');await page.locator('#mainBtn').click();assert.equal(state.bookings.length,0);
 await page.screenshot({path:'test-output/name-field.png',animations:'disabled'});
 await page.locator('#cName').fill('<img src=x onerror=alert(1)>');await page.locator('#cPhone').fill('+79001112233');await page.locator('#mainBtn').click();
 await page.locator('#s-ok.on').waitFor();assert.equal(state.bookings.length,1);
 await page.locator('#mainBtn').click();await page.getByRole('button',{name:'Мои записи',exact:true}).click();
 await page.getByRole('button',{name:'Перенести',exact:true}).click();await page.locator('#moveTime').selectOption('14:00');await page.getByRole('button',{name:'Подтвердить перенос'}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings[0].time,'14:00');
 await page.getByRole('button',{name:'Отменить',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings[0].status,'cancel');
 admin=true;await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();
 for(const label of ['Сегодня','Записи','Окошки','Финансы','Клиенты']){await page.locator('.tb').filter({hasText:label}).click();await page.locator('#apanel').waitFor();}
 await page.locator('.tb').filter({hasText:'Финансы'}).click();await page.getByRole('button',{name:'+ Добавить расход'}).click();await page.locator('#eA').fill('1200');await page.locator('#eN').fill('Материалы <тест>');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.expenses.length,1);
 await page.locator('.tb').filter({hasText:'Окошки'}).click();await page.screenshot({path:'test-output/admin.png',fullPage:true});
 await page.locator('.ahb button').last().click();await page.locator('#sheetC input').first().fill('Pearl Studio');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.studio,'Pearl Studio');await page.locator('.ahb button').last().click();
 const slotsBeforeTemplate=structuredClone(state.slots);
 await page.getByRole('button',{name:'Изменить шаблон',exact:true}).click();
 await page.locator('#timeHour').selectOption('09');await page.locator('#timeMinute').selectOption('15');assert.equal(await page.locator('#timeEntry').inputValue(),'09:15');await page.getByRole('button',{name:'Добавить время',exact:true}).click();
 await page.getByRole('button',{name:'Изменить 12:00',exact:true}).click();await page.locator('#timeEntry').fill('1235');await page.getByRole('button',{name:'Заменить время',exact:true}).click();
 await page.getByRole('button',{name:'Убрать 10:00',exact:true}).click();
 await page.locator('#timeEntry').fill('25:99');await page.getByRole('button',{name:'Добавить время',exact:true}).click();assert.equal(await page.locator('#timeError').isVisible(),true);
 await page.locator('#timeEntry').fill('17:40');await page.getByRole('button',{name:'Добавить время',exact:true}).click();await page.getByRole('button',{name:'Добавить время',exact:true}).click();assert.ok((await page.locator('#timeError').innerText()).includes('уже есть'));
 await page.locator('#timeEntry').fill('19:10');await page.getByRole('button',{name:'Добавить время',exact:true}).click();await page.screenshot({path:'test-output/time-template.png',animations:'disabled'});
 await page.getByRole('button',{name:'Сохранить шаблон',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});
 assert.ok(state.settings.tpl.includes('09:15'));assert.ok(state.settings.tpl.includes('12:35'));assert.ok(state.settings.tpl.includes('17:40'));assert.equal(state.settings.tpl.includes('10:00'),false);assert.equal(state.settings.tpl.includes('12:00'),false);assert.deepEqual(state.slots,slotsBeforeTemplate);
 await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();await page.getByRole('button',{name:'Настройки',exact:true}).click();assert.ok((await page.locator('.template-preview').innerText()).includes('12:35'));
 await page.keyboard.press('Escape');await page.locator('.tb').filter({hasText:'Окошки'}).click();await page.evaluate(d=>{calM=d.slice(0,7);render();},day);await page.locator(`[data-date="${day}"]`).click();
 await page.getByRole('button',{name:'+ своё время',exact:true}).click();await page.locator('#timeHour').selectOption('11');await page.locator('#timeMinute').selectOption('35');await page.screenshot({path:'test-output/custom-time.png',animations:'disabled'});await page.getByRole('button',{name:'Открыть окошко',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.ok(state.slots[day].includes('11:35'));
 await page.getByRole('button',{name:'+ своё время',exact:true}).click();await page.locator('#timeEntry').fill('1545');await page.getByRole('button',{name:'Открыть окошко',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.ok(state.slots[day].includes('15:45'));
 const beforeDuplicate=version;await page.getByRole('button',{name:'+ своё время',exact:true}).click();await page.locator('#timeEntry').fill('15:45');await page.getByRole('button',{name:'Открыть окошко',exact:true}).click();assert.ok((await page.locator('#timeError').innerText()).includes('уже открыто'));assert.equal(version,beforeDuplicate);
 await page.locator('#timeEntry').fill('24:00');await page.getByRole('button',{name:'Открыть окошко',exact:true}).click();assert.equal(await page.locator('#timeError').isVisible(),true);assert.equal(version,beforeDuplicate);
 await page.getByRole('button',{name:'Назад',exact:true}).click();await page.reload();await page.locator('#loading').waitFor({state:'hidden'});assert.ok((await page.evaluate(()=>DB.slots))[day].includes('15:45'));await page.locator('#admBtn').click();await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.locator('#sheetC .mrow').filter({hasText:'Фото работ'}).click();
 await page.locator('input[type=file]').setInputFiles('public/work-0.jpg');await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.photos.length,1);
 await page.locator('#sbg').click({position:{x:5,y:5}});await page.locator('.tb').filter({hasText:'Записи'}).click();await page.locator('#fab').click();
 await page.locator('#nbN').fill('Мария');await page.locator('#nbP').fill('+79002223344');await page.getByRole('button',{name:'Записать',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings.filter(b=>b.status==='new').length,1);
 await page.locator('.bk').filter({hasText:'Мария'}).click();
 for(const [name,status] of [['Пришла','done'],['Не пришла','noshow'],['Ожидается','new']]){await page.locator('.stb').getByRole('button',{name,exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings.find(b=>b.manual).status,status);assert.equal(await page.locator('#apanel .bk').filter({hasText:'Мария'}).count(),status==='new'?1:0);}
 await page.locator('.stb').getByRole('button',{name:'Пришла',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.locator('.chip').filter({hasText:'Прошедшие'}).click();await page.locator('.bk').filter({hasText:'Мария'}).click();await page.locator('.stb').getByRole('button',{name:'Ожидается',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.locator('.chip').filter({hasText:'Предстоящие'}).click();assert.equal(await page.locator('#apanel .bk').filter({hasText:'Мария'}).count(),1);
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
 await page.locator('#cName').fill('Анна');await page.locator('#cPhone').fill('@Telegram_Only');await page.locator('#mainBtn').click();await page.locator('#s-ok.on').waitFor();
 const tgOnly=state.bookings.find(b=>b.phone==='@telegram_only');assert.ok(tgOnly);assert.equal(tgOnly.tgUsername,'telegram_only');
 admin=true;await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();await page.evaluate(id=>bookInfo(id),tgOnly.id);
 assert.equal(await page.locator('#sheetC a[href^="tel:"]').count(),0);assert.ok((await page.locator('#sheetC').innerText()).includes('@telegram_only'));
 await page.evaluate(()=>clientInfo('@telegram_only'));await page.locator('#sheetC textarea').fill('Заметка для Telegram-клиентки');await page.locator('#sheetC textarea').press('Tab');await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.notes['@telegram_only'],'Заметка для Telegram-клиентки');assert.deepEqual(errors,[]);

 // Master rescheduling keeps the original client and authoritative price.
 await page.evaluate(id=>bookInfo(id),other.id);await page.getByRole('button',{name:'Перенести визит',exact:true}).click();
 await page.locator('#moveTime').selectOption('14:00');await page.getByRole('button',{name:'Подтвердить перенос'}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});
 assert.equal(state.bookings.find(b=>b.id===other.id).time,'14:00');assert.ok((await page.locator('#sheetC').innerText()).includes('Клиентка'));

 const extraDay=DateTime.fromISO(day).plus({days:1}).toISODate();state.slots[extraDay]=['10:00','12:00','14:00','16:00','18:00'];version++;
 await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#admBtn').click();
 await page.evaluate(()=>bookSheet());await page.locator('#nbClient').selectOption(String(other.id));await page.locator('#nbD').selectOption(extraDay);await page.locator('#nbT').selectOption('16:00');
 await page.getByRole('button',{name:'Записать',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});
 assert.equal(state.bookings.find(b=>b.date===extraDay&&b.time==='16:00').tgId,456);

 await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Перерывы и отпуск →',exact:true}).click();
 await page.locator('#blockFrom').fill(extraDay);await page.locator('#blockTo').fill(extraDay);await page.locator('#blockStart').fill('13:00');await page.locator('#blockEnd').fill('15:00');await page.locator('#blockNote').fill('Обед');
 await page.getByRole('button',{name:'Добавить перерыв',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.blocks.length,1);
 await page.screenshot({path:'test-output/breaks.png',animations:'disabled'});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.locator('#bufferMinutes').fill('15');await page.locator('#masterContact').fill('@studio_master');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.settings.bufferMinutes,15);assert.equal(state.settings.masterContact,'@studio_master');await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('button',{name:'Экспорт данных →',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Записи — CSV',exact:true}).click();const downloaded=await downloading;assert.ok(downloaded.suggestedFilename().endsWith('.csv'));
 await page.locator('#networkBusy').waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Журнал изменений →',exact:true}).click();await page.getByText('Создана запись',{exact:true}).waitFor();
 await page.locator('#networkBusy').waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Состояние уведомлений →',exact:true}).click();await page.getByText('Планировщик работает.',{exact:true}).waitFor();

 // Recover a committed booking whose HTTP response was lost. Choosing a new
 // time first must show the saved booking, not create a second reservation.
 admin=false;await page.reload();await page.locator('#loading').waitFor({state:'hidden'});const countBefore=state.bookings.length;
 await page.locator('#mainBtn').click();await page.locator('.d').last().click();await page.locator('.tm').filter({hasText:'10:00'}).click();await page.locator('#mainBtn').click();await page.locator('.sc').first().click();await page.locator('#mainBtn').click();await page.locator('#cName').fill('Анна');await page.locator('#cPhone').fill('@recover_me');
 loseNextBookingReply=true;await page.locator('#mainBtn').click();await page.locator('#networkBusy').waitFor({state:'hidden'});assert.equal(state.bookings.length,countBefore+1);
 await page.locator('.d').last().click();await page.locator('.tm').filter({hasText:'12:00'}).click();await page.locator('#mainBtn').click();await page.locator('.sc').first().click();await page.locator('#mainBtn').click();await page.locator('#mainBtn').click();await page.locator('#s-ok.on').waitFor();
 assert.equal(state.bookings.length,countBefore+1);assert.ok((await page.locator('#okText').innerText()).includes('10:00'));assert.deepEqual(errors,[]);
 console.log('UI PASS: booking recovery, client/master move, cancel, linked manual booking, breaks, buffer, export, audit, diagnostics, contacts, accessibility; no JS errors');
 console.log('Actions:',actions.join(', '));
}finally{await browser?.close();server.kill();}

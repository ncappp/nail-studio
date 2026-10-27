function blocksSheet(){
 const day=calD||today();
 openSheet(`<h2>Перерывы и отпуск</h2><p class="mut">Блокируется весь интервал услуги. Существующие визиты сначала перенеси или отмени.</p>
 <label for="blockFrom">С даты</label><input id="blockFrom" type="date" value="${day}"><label for="blockTo">По дату включительно</label><input id="blockTo" type="date" value="${day}">
 <label for="blockStart">Начало перерыва</label><input id="blockStart" type="time" value="13:00"><label for="blockEnd">Конец перерыва</label><input id="blockEnd" type="time" value="14:00">
 <label for="blockNote">Название</label><input id="blockNote" maxlength="200" placeholder="Обед, отпуск…"><button class="btn pk" onclick="addBlock(false)">Добавить перерыв</button><button class="btn light" style="margin-top:8px" onclick="addBlock(true)">Закрыть дни целиком</button>
 <h3>Закрытые интервалы</h3>${DB.blocks.map(b=>`<div class="card"><b>${b.date} · ${b.start}–${b.end}</b><p>${escapeHtml(b.note)}</p><button class="btn light" onclick="removeBlock(${b.id})">Убрать перерыв</button></div>`).join('')||'<p class="mut">Перерывов нет</p>'}`);
}
async function addBlock(fullDay){
 const from=$('blockFrom').value,to=$('blockTo').value,start=fullDay?'00:00':$('blockStart').value,end=fullDay?'23:59':$('blockEnd').value,note=$('blockNote').value.trim();
 if(!from||!to||from>to||!start||!end||start>=end)return alert('Проверь даты и время перерыва');
 const days=DT.fromISO(to).diff(DT.fromISO(from),'days').days+1;
 if(days>180)return alert('Выбери не больше 180 дней за один раз');
 const next=structuredClone(DB),stamp=Date.now();
 for(let i=0;i<days;i++)next.blocks.push({id:stamp+i,date:addDays(from,i),start,end,note});
 const ok=await mutation(async()=>{const {bookings,busy,historyNext,...config}=next;const r=await api('save',{version:VERSION,config});DB=next;VERSION=r.version;render();});
 if(ok)blocksSheet();
}
async function removeBlock(id){const next=structuredClone(DB);next.blocks=next.blocks.filter(b=>b.id!==id);const ok=await mutation(async()=>{const {bookings,busy,historyNext,...config}=next;const r=await api('save',{version:VERSION,config});DB=next;VERSION=r.version;render();});if(ok)blocksSheet();}
function exportSheet(){openSheet('<h2>Экспорт данных</h2><p class="mut">Файл содержит контакты клиенток. Сохраняй его в своём защищённом хранилище.</p><button class="btn pk" onclick="downloadExport(\'bookings\')">Записи — CSV</button><button class="btn light" style="margin-top:8px" onclick="downloadExport(\'expenses\')">Расходы — CSV</button><button class="btn light" style="margin-top:8px" onclick="downloadExport(\'json\')">Все записи и расходы — JSON</button>');}
async function downloadExport(kind){await mutation(async()=>{
 const data=await api('export'),tools=await import('/export.mjs');
 const content=kind==='json'?JSON.stringify(data,null,2):kind==='bookings'?tools.bookingCsv(data):tools.expenseCsv(data);
 const url=URL.createObjectURL(new Blob([content],{type:kind==='json'?'application/json':'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`pearl-${kind}-${today()}.${kind==='json'?'json':'csv'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});}
async function diagnosticsSheet(){await mutation(async()=>{
 const r=await api('diagnostics'),last=r.worker?.finished_at,age=last?Date.now()-new Date(last).getTime():Infinity;
 openSheet(`<h2>Состояние уведомлений</h2><p>База данных доступна.</p><p>${age<180000?'Планировщик работает.':'Давно не было успешного запуска планировщика. Проверь cron.'}</p><div class="kv"><span>Последний запуск</span><b>${last?escapeHtml(new Date(last).toLocaleString('ru-RU')):'Нет данных'}</b></div><div class="kv"><span>Ожидают отправки</span><b>${r.queue.pending}</b></div><div class="kv"><span>Не доставлены</span><b>${r.queue.dead}</b></div><div class="kv"><span>Просрочены</span><b>${r.queue.expired}</b></div><p class="mut">Проверка не отправляет сообщения и не подтверждает исправность Storage.</p>`);
});}
async function auditSheet(before=null,previous=[]){await mutation(async()=>{
 const r=await api('audit',null,before?{before}:{}),items=[...previous,...r.items];window.auditItems=items;window.auditNext=r.next;
 const names={'booking.created':'Создана запись','booking.reschedule':'Перенесён визит','booking.cancel':'Отменена запись','booking.status':'Изменён статус','booking.deleted':'Удалена запись','config.saved':'Изменены настройки / расходы'};
 openSheet(`<h2>Журнал изменений</h2>${items.map(i=>`<div class="card"><b>${escapeHtml(names[i.action]||i.action)}</b><p>${escapeHtml(new Date(i.created_at).toLocaleString('ru-RU'))}</p><small>Telegram ID: ${escapeHtml(i.actor_id)} · ${escapeHtml(i.entity_id)}</small></div>`).join('')||'<p>Изменений пока нет</p>'}${r.next?'<button class="btn light" onclick="auditSheet(window.auditNext,window.auditItems)">Показать ещё</button>':''}`);
});}
function masterContactButton(){const contact=DB.settings.masterContact||'';if(!contact)return '<p class="mut">Контакт мастера указан в чате студии.</p>';if(contact.startsWith('@'))return `<a class="btn light" href="https://t.me/${escapeHtml(contact.slice(1))}" target="_blank" rel="noopener noreferrer">Написать мастеру</a>`;return `<a class="btn light" href="tel:${escapeHtml(contact)}">Позвонить мастеру</a>`;}
async function loadHistory(){await mutation(async()=>{const cursor=DB.historyNext;if(!cursor)return;const page=await api('history',null,{beforeMs:cursor[0],beforeId:cursor[1]});DB.bookings=[...new Map([...DB.bookings,...page.bookings].map(b=>[b.id,b])).values()];DB.historyNext=page.next;showMine();});}
let telegramBackBound=false;
function syncTelegramNavigation(){try{
 if(!telegramBackBound&&tg?.BackButton){tg.BackButton.onClick(()=>{if($('sheet').classList.contains('on'))closeSheet();else go(({form:'svc',svc:'date',date:'home',admin:'home',ok:'home'})[screen]||'home');});telegramBackBound=true;}
 if(screen==='home'&&!$('sheet').classList.contains('on'))tg?.BackButton?.hide();else tg?.BackButton?.show();
 if(screen==='form'||working||($('sheet').classList.contains('on')&&$('sheetC').querySelector('input,textarea')))tg?.enableClosingConfirmation?.();else tg?.disableClosingConfirmation?.();
}catch{}}

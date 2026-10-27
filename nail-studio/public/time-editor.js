let timeEditor=null;

function normalizeTime(value){
 const raw=String(value||'').trim().replace('.',':');
 const match=raw.match(/^(\d{1,2}):(\d{1,2})$/)||raw.match(/^(\d{1,2})(\d{2})$/)||raw.match(/^(\d{1,2})$/);
 if(!match||+match[1]>23||+(match[2]||0)>59)return null;
 return match[1].padStart(2,'0')+':'+String(match[2]||'00').padStart(2,'0');
}
function openTimeEditor(mode,date=null){
 if(!SESSION?.admin)return;
 timeEditor={mode,date,times:[...new Set(DB.settings.tpl)].sort(),editing:null};
 const existing=mode==='slot'?(DB.slots[date]||[]):timeEditor.times;
 const initial=['09:00','09:30','10:30','11:00'].find(t=>!existing.includes(t))||'09:00';
 const options=(max,selected)=>Array.from({length:max},(_,i)=>{const v=String(i).padStart(2,'0');return `<option value="${v}" ${v===selected?'selected':''}>${v}</option>`;}).join('');
 openSheet(`<h2>${mode==='template'?'Шаблон рабочего дня':'Своё время'}</h2>
 <p class="mut">${mode==='template'?'Добавь удобные начала визитов. Даты с уже открытыми окошками сохранятся.':escapeHtml(dfmt(date,{weekday:'long',day:'numeric',month:'long'}))}</p>
 ${mode==='template'?'<div id="templateTimes" class="time-chips"></div>':''}
 <div class="time-picker-row"><div><label for="timeHour">Часы</label><select id="timeHour" onchange="timeFromPicker()">${options(24,initial.slice(0,2))}</select></div><div><label for="timeMinute">Минуты</label><select id="timeMinute" onchange="timeFromPicker()">${options(60,initial.slice(3))}</select></div></div>
 <label for="timeEntry">Или введи время вручную</label><input id="timeEntry" type="text" inputmode="decimal" maxlength="8" placeholder="Например, 09:30" value="${initial}" oninput="syncTimePicker()" onblur="formatTimeEntry()" aria-describedby="timeHint timeError" autocomplete="off">
 <p id="timeHint" class="mut">Можно написать 9:30 или 0930.</p><p id="timeError" class="time-error" role="alert" hidden></p>
 <button type="button" id="timeApply" class="btn pk" onclick="${mode==='template'?'addTemplateTime()':'saveCustomTime()'}">${mode==='template'?'Добавить время':'Открыть окошко'}</button>
 ${mode==='template'?'<button type="button" class="btn" style="margin-top:10px" onclick="saveTimeTemplate()">Сохранить шаблон</button>':''}
 <button type="button" class="btn light" style="margin-top:8px" onclick="leaveTimeEditor()">Назад</button>`);
 if(mode==='template')drawTemplateTimes();
}
function timeError(message=''){const el=$('timeError');el.textContent=message;el.hidden=!message;$('timeEntry').setAttribute('aria-invalid',String(!!message));return !message;}
function timeFromPicker(){$('timeEntry').value=$('timeHour').value+':'+$('timeMinute').value;timeError();}
function syncTimePicker(){const input=$('timeEntry');if(/^\d{4}$/.test(input.value))input.value=input.value.slice(0,2)+':'+input.value.slice(2);const value=normalizeTime(input.value);if(value){$('timeHour').value=value.slice(0,2);$('timeMinute').value=value.slice(3);}timeError();}
function formatTimeEntry(){const value=normalizeTime($('timeEntry').value);if(value)$('timeEntry').value=value;}
function drawTemplateTimes(){
 $('templateTimes').innerHTML=timeEditor.times.map(t=>`<div class="time-chip"><button type="button" class="time-chip-edit" aria-label="Изменить ${t}" onclick="editTemplateTime('${t}')">${t}</button><button type="button" class="time-chip-remove" aria-label="Убрать ${t}" onclick="removeTemplateTime('${t}')">×</button></div>`).join('')||'<p class="mut">Добавь время для кнопки «Весь день».</p>';
}
function editTemplateTime(value){timeEditor.editing=value;$('timeEntry').value=value;syncTimePicker();$('timeApply').textContent='Заменить время';$('timeEntry').focus();}
function removeTemplateTime(value){timeEditor.times=timeEditor.times.filter(t=>t!==value);if(timeEditor.editing===value){timeEditor.editing=null;$('timeApply').textContent='Добавить время';}drawTemplateTimes();timeError();}
function addTemplateTime(){
 const value=normalizeTime($('timeEntry').value);
 if(!value)return timeError('Введи время от 00:00 до 23:59. Например, 09:30.');
 if(timeEditor.times.includes(value)&&value!==timeEditor.editing)return timeError('Это время уже есть в шаблоне.');
 if(timeEditor.times.length>=96&&!timeEditor.editing)return timeError('В шаблоне можно сохранить до 96 времён.');
 timeEditor.times=[...new Set([...timeEditor.times.filter(t=>t!==timeEditor.editing),value])].sort();timeEditor.editing=null;
 $('timeEntry').value=value;$('timeApply').textContent='Добавить время';drawTemplateTimes();timeError();return true;
}
async function saveTimeTemplate(){
 if(timeEditor.editing&&!addTemplateTime())return;
 const next=structuredClone(DB);next.settings.tpl=[...timeEditor.times];
 const ok=await persistTimeConfig(next);if(ok){render();openSettings();haptic('success');}
}
async function saveCustomTime(){
 const value=normalizeTime($('timeEntry').value),date=timeEditor.date;
 if(!value)return timeError('Введи время от 00:00 до 23:59. Например, 09:30.');
 if((DB.slots[date]||[]).includes(value))return timeError('Это окошко уже открыто на выбранную дату.');
 if((DB.slots[date]||[]).length>=96)return timeError('На одну дату можно открыть до 96 времён.');
 const next=structuredClone(DB);next.slots[date]=[...new Set([...(next.slots[date]||[]),value])].sort();
 const ok=await persistTimeConfig(next);if(ok){calD=date;closeSheet();render();haptic('success');}
}
async function persistTimeConfig(next){return mutation(async()=>{const {bookings,busy,historyNext,...config}=next;const result=await api('save',{version:VERSION,config});DB=next;VERSION=result.version;});}
function leaveTimeEditor(){if(timeEditor?.mode==='template')openSettings();else closeSheet();}

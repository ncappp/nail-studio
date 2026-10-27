
const IMGS=["/work-0.jpg", "/work-1.jpg", "/work-2.jpg", "/work-3.jpg", "/work-4.jpg", "/work-5.jpg"];
const tg=window.Telegram?.WebApp;try{tg.ready();tg.expand();tg.setHeaderColor('#FFF4F6');tg.setBackgroundColor('#FFF4F6')}catch(e){}
const fmt=n=>Math.round(n).toLocaleString('ru-RU')+' ₽';
const iso=d=>DT.fromJSDate(new Date(d),{zone:DB.settings.timezone}).toISODate(),today=()=>DT.now().setZone(DB.settings.timezone).toISODate();
const addDays=(s,n)=>DT.fromISO(s,{zone:DB.settings.timezone}).plus({days:n}).toISODate();
const $=id=>document.getElementById(id);
const haptic=(t='selection')=>{try{t==='selection'?tg.HapticFeedback.selectionChanged():tg.HapticFeedback.notificationOccurred(t)}catch(e){}};
const nowT=()=>DT.now().setZone(DB.settings.timezone).toFormat('HH:mm');
// Telegram contact navigation: IDs identify bookings, usernames/phones open chats.
const isPhoneContact=value=>/^\+?[1-9]\d{6,14}$/.test(String(value||'').replace(/[\s()-]/g,''));
function telegramContactUrl(contact){
 const username=String(String(contact.phone||'').startsWith('@')?contact.phone:contact.tgUsername||'').replace(/^@/,'');
 if(/^[a-zA-Z0-9_]{1,32}$/.test(username))return 'https://t.me/'+username;
 const raw=String(contact.phone||'').replace(/[\s()-]/g,'');
 if(/^\+?[1-9]\d{6,14}$/.test(raw))return 'https://t.me/+'+raw.replace(/^\+/,'');
 return null;
}
function contactTelegram(id){
 const b=DB.bookings.find(x=>x.id===id);if(!b)return;
 if(b.tgId&&b.tgId===SESSION?.user.id)return alert('Это запись с твоего Telegram-аккаунта. Проверь кнопку на записи с другого аккаунта.');
 const link=telegramContactUrl(b);if(!link)return alert('Нет Telegram username или корректного телефона клиентки.');
 if(!b.tgUsername&&!confirm('Открыть Telegram по номеру телефона? Поиск сработает, если этот номер привязан к Telegram и клиентка разрешает находить её по номеру.'))return;
 haptic();try{if(tg?.openTelegramLink)tg.openTelegramLink(link);else window.open(link,'_blank','noopener,noreferrer');}catch{alert('Не удалось открыть Telegram. Попробуй найти клиентку по username или телефону.');}
}
function clientTelegram(phone){
 const records=DB.bookings.filter(b=>b.phone===phone).sort((a,b)=>(b.startMs||0)-(a.startMs||0));
 const contact=records.find(b=>b.tgUsername)||records.find(b=>b.tgId)||records[0];if(contact)contactTelegram(contact.id);
}

let DB={studio:'Nail Studio',services:[],slots:{},bookings:[],expenses:[],cats:[],photos:[],reviews:[],notes:{},settings:{address:'',hours:'',tpl:[],timezone:'Europe/Samara',dayEnd:'21:00'}};
let SESSION=null,VERSION=0,working=false;
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DT=luxon.DateTime;
async function api(action,body,query={}){
 const r=await fetch('/api/index?'+new URLSearchParams({action,...query}),{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':tg?.initData||''},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
 const result=await r.json();if(!r.ok){const e=new Error(result.error||'Не удалось выполнить действие');e.status=r.status;if(r.status===401){$('loadingText').textContent='Сессия истекла. Закрой и заново открой приложение через Telegram.';$('loading').hidden=false;$('retry').hidden=true;}throw e;}return result;
}
async function refresh(){const r=await api('state');DB=r.data;DB.blocks??=[];VERSION=r.version;SESSION=r;return r;}
function lock(on){working=on;$('networkBusy').hidden=!on;}
async function mutation(fn){if(working)return false;lock(true);try{await fn();return true;}catch(e){alert(e.message);try{await refresh();closeSheet();if(screen==='form')screen='date';go(screen);}catch{}return false;}finally{lock(false);}}
function save(){
 const {bookings,busy,historyNext,...config}=structuredClone(DB);
 return mutation(async()=>{const result=await api('save',{version:VERSION,config});VERSION=result.version;});
}
const photos=()=>DB.photos.length?DB.photos:IMGS;
const pimg=s=>photos()[s.img%photos().length];
let B={},screen='home';
function go(s){if(s==='admin'&&!SESSION?.admin)return;screen=s;document.body.classList.toggle('adm-on',s==='admin');if(window.closeSheet)closeSheet();document.querySelectorAll('.screen').forEach(e=>e.classList.toggle('on',e.id==='s-'+s));render();syncTelegramNavigation();scrollTo({top:0});haptic()}
function cta(text,fn,{show=true,sub='',disabled=false}={}){$('sticky').style.display=show?'block':'none';$('mainBtn').innerHTML=text+(sub?`<span class="sub">${sub}</span>`:'');$('mainBtn').onclick=fn;$('mainBtn').disabled=disabled}
function available(d,t,dur,ignore=null){
 const start=DT.fromISO(d+'T'+t,{zone:DB.settings.timezone}).toMillis(),end=start+dur*60000;
 const busy=SESSION?.admin?DB.bookings.filter(b=>b.status!=='cancel'):DB.busy||[];
 const buffer=(DB.settings.bufferMinutes||0)*60000;
 return (DB.slots[d]||[]).includes(t)&&start>Date.now()&&end<=DT.fromISO(d+'T'+DB.settings.dayEnd,{zone:DB.settings.timezone}).toMillis()
  &&!DB.blocks.some(b=>b.date===d&&start<DT.fromISO(d+'T'+b.end,{zone:DB.settings.timezone}).toMillis()&&end>DT.fromISO(d+'T'+b.start,{zone:DB.settings.timezone}).toMillis())
  &&!busy.some(b=>b.id!==ignore&&start<b.endMs+buffer&&end+buffer>b.startMs);
}
function freeTimes(d,dur=null,ignore=null){const lengths=dur?[dur]:DB.services.map(s=>s.dur);return (DB.slots[d]||[]).filter(t=>lengths.some(n=>available(d,t,n,ignore)));}
const rel=d=>d===today()?'Сегодня':d===addDays(today(),1)?'Завтра':new Date(d+'T12:00:00').toLocaleDateString('ru',{day:'numeric',month:'short'});
function nearest(){const d=Object.keys(DB.slots).filter(d=>d>=today()).sort().find(d=>freeTimes(d).length);return d?{d,t:freeTimes(d)[0]}:null}
function reveal(){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.1});document.querySelectorAll('.reveal:not(.in)').forEach(x=>io.observe(x))}
function renderHome(){
  const P=photos();$('heroImg').src=DB.photos.length?P[0]:P[3%P.length];$('brand').textContent=DB.studio;$('addr').textContent=DB.settings.address;$('hours').textContent=DB.settings.hours;
  $('stories').innerHTML=P.map((p,i)=>`<div class="st" onclick="openStory(${i})"><img src="${p}"></div>`).join('');
  $('grid').innerHTML=P.slice(0,6).map((p,i)=>`<img src="${p}" onclick="openStory(${i})" loading="lazy">`).join('');
  $('prices').innerHTML=(DB.services.some(s=>s.popular)?DB.services.filter(s=>s.popular):DB.services).slice(0,6).map(s=>`<div class="pr" onclick="B.svc=${s.id};go('date')"><span>${escapeHtml(s.name)}</span><b>${fmt(s.price)}</b></div>`).join('');
  $('revs').innerHTML=DB.reviews.map(r=>`<div class="rv glass"><div class="stars">★★★★★</div><p>${escapeHtml(r[1])}</p><div class="who"><div class="av">${escapeHtml(r[0][0])}</div>${escapeHtml(r[0])}</div></div>`).join('');
  const n=nearest();$('near').innerHTML=n?`${rel(n.d)}<br>${n.t}`:'Нет мест';
  $('sampleNote').hidden=!!DB.photos.length;$('revs').parentElement.hidden=!DB.reviews.length;reveal();cta('Записаться',()=>go('date'),{sub:n?`ближайшее окошко — ${rel(n.d).toLowerCase()}, ${n.t}`:''});
}
/* 3D tilt hero */
const hero=$('hero');hero.addEventListener('pointermove',e=>{const r=hero.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;hero.style.transform=`perspective(900px) rotateY(${x*8}deg) rotateX(${-y*8}deg)`});hero.addEventListener('pointerleave',()=>hero.style.transform='');
window.addEventListener('deviceorientation',e=>{if(screen==='home'&&e.gamma!=null)hero.style.transform=`perspective(900px) rotateY(${Math.max(-8,Math.min(8,e.gamma/4))}deg) rotateX(${Math.max(-6,Math.min(6,(e.beta-45)/6))}deg)`});
/* stories */
let si=0,stT;
function openStory(i){si=i;$('sv').classList.add('on');showStory();haptic()}
function showStory(){const P=photos();$('svImg').src=P[si];$('svBars').innerHTML=P.map((_,k)=>`<i class="${k<si?'done':k===si?'go':''}"><b></b></i>`).join('');clearTimeout(stT);stT=setTimeout(()=>stStep(1),4000)}
function stStep(d){const P=photos();si+=d;if(si<0)si=0;if(si>=P.length)return closeStory();showStory();haptic()}
function closeStory(){clearTimeout(stT);$('sv').classList.remove('on')}
function renderDate(){
  const days=Object.keys(DB.slots).filter(d=>d>=today()&&freeTimes(d).length).sort();
  if(!days.includes(B.date)){B.date=days[0]||null;B.time=null;}if(B.time&&!freeTimes(B.date).includes(B.time))B.time=null;
  $('monthLbl').textContent=B.date?new Date(B.date+'T12:00:00').toLocaleString('ru',{month:'long'}):'';
  $('dates').innerHTML=days.length?days.map(d=>{const x=new Date(d+'T12:00:00');return `<div class="d ${B.date===d?'on':''}" onclick="B.date='${d}';B.time=null;haptic();render()"><small>${x.toLocaleString('ru',{weekday:'short'})}</small><b>${x.getDate()}</b></div>`}).join(''):'<p class="mut">Свободных окошек пока нет</p>';
  const ft=B.date?freeTimes(B.date):[];$('freeCnt').textContent=B.date?ft.length+' своб.':'';
  const grp=[['Утро',t=>t<'12:00'],['День',t=>t>='12:00'&&t<'17:00'],['Вечер',t=>t>='17:00']];let k=0;
  $('times').innerHTML=grp.map(([n,f])=>{const ts=ft.filter(f);return ts.length?`<h4>${n}</h4><div class="tl">${ts.map(t=>`<div class="tm ${B.time===t?'on':''}" style="animation-delay:${(k++)*40}ms" onclick="B.time='${t}';haptic();render()">${t}</div>`).join('')}</div>`:''}).join('');
  cta('Продолжить',()=>B.time&&go('svc'),{disabled:!B.time,sub:B.time?`${rel(B.date).toLowerCase()}, ${B.time}`:'выберите время'});
}
function renderSvc(){
  const dur=m=>m>=60?Math.floor(m/60)+' ч'+(m%60?' '+m%60+' мин':''):m+' мин';
  $('svcs').innerHTML=DB.services.filter(s=>available(B.date,B.time,s.dur)).map((s,i)=>`<div class="sc ${B.svc===s.id?'on':''}" style="animation-delay:${i*40}ms" onclick="B.svc=${s.id};haptic();render()"><img src="${pimg(s)}"><div class="ck">✓</div><div class="i"><b>${escapeHtml(s.name)}</b><span>${fmt(s.price)}<em>${dur(s.dur)}</em></span></div></div>`).join('');
  const s=DB.services.find(x=>x.id===B.svc&&available(B.date,B.time,x.dur));cta('Продолжить',()=>s&&go('form'),{disabled:!s,sub:s?`${escapeHtml(s.name)} · ${fmt(s.price)}`:'выберите услугу'});
}
function renderForm(){
 const s=DB.services.find(x=>x.id===B.svc);if(!s)return go('svc');
 $('summary').innerHTML=`<div class="top"><img src="${pimg(s)}"><div><b>${escapeHtml(s.name)}</b><span>${B.date}, ${B.time}</span></div></div><div class="rw"><span>Длительность</span><b>${s.dur} мин</b></div><div class="rw"><span>Адрес</span><b>${escapeHtml(DB.settings.address)}</b></div><div class="rw tot"><span>К оплате</span><b>${fmt(s.price)}</b></div>`;
 cta('Подтвердить запись',async()=>{
  const name=$('cName').value.trim(),phone=$('cPhone').value.trim();if(!name){$('cName').focus();return alert('Введи своё имя — это обязательное поле');}if(!phone){$('cPhone').focus();return alert('Укажи номер телефона или Telegram');}
  const payload={date:B.date,time:B.time,serviceId:s.id,name,phone},key=JSON.stringify(payload);
  await mutation(async()=>{
   if(B.pending&&B.pending!==key){
    try{const previous=await api('booking-request',null,{requestId:B.requestId});await bookingSuccess(previous);return;}catch(e){if(e.status!==404)throw e;}
    B.requestId=null;
   }
   B.requestId??=crypto.randomUUID();B.pending=key;
   try{await bookingSuccess(await api('book',{...payload,requestId:B.requestId}));}catch(e){if([400,403,409,429].includes(e.status)){B.requestId=null;B.pending=null;}throw e;}
  });
 },{sub:'Оплата на месте · отмена и перенос за 12 часов'});
}
async function bookingSuccess(b){$('okText').textContent=`${b.date}, ${b.time} · ${b.service}. ${b.status==='cancel'?'Запись отменена.':'Запись сохранена. Уведомление придёт в Telegram в течение минуты, если сообщения бота разрешены.'}`;await refresh().catch(()=>{});B={};go('ok');confetti();haptic('success');}
function confetti(){const c=['#EE6F93','#FFD3DF','#FFB8A6','#fff','#F7C6D9'];for(let i=0;i<40;i++){const p=document.createElement('div');p.className='conf';p.style.left=Math.random()*100+'vw';p.style.background=c[i%5];p.style.width=p.style.height=(6+Math.random()*8)+'px';p.style.setProperty('--dx',(Math.random()*160-80)+'px');p.style.animationDuration=(2.5+Math.random()*2.5)+'s';p.style.animationDelay=Math.random()*.8+'s';document.body.appendChild(p);setTimeout(()=>p.remove(),7000)}}
/* ===================== ADMIN ===================== */
const SVG=p=>`<svg viewBox="0 0 24 24">${p}</svg>`;
const IC={
 today:SVG('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
 book:SVG('<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
 slots:SVG('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
 fin:SVG('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
 clients:SVG('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
 plus:SVG('<path d="M12 5v14M5 12h14"/>'),
 money:SVG('<rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/>'),
 clock:SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
 srch:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
 brush:SVG('<path d="M14 4l6 6-9 9H5v-6z"/>'),img:SVG('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
 home:SVG('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),tag:SVG('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>'),
};
const ATABS=[['today','Сегодня'],['book','Записи'],['slots','Окошки'],['fin','Финансы'],['clients','Клиенты']];
const ST={new:['Ожидается','#EE6F93','rgba(238,111,147,.13)'],done:['Пришла','#2F9C5E','#E4F6EC'],noshow:['Не пришла','#B07A1E','#FFF0D6'],cancel:['Отмена','#7D6A71','#EEE8EA']};
const CCOL=['#EE6F93','#FFB8A6','#231A1E','#B9A3F0','#7FCBA4','#F2C46D','#A8949B','#8EC5F0'];
let atab='today',period='all',bf='up',cseg='all',cq='',calM=null,calD=null;
const svcBy=id=>DB.services.find(s=>s.id===id)||{name:'—',price:0,dur:60,img:0};
const ini=n=>escapeHtml((n||'?').trim()[0].toUpperCase());
const dfmt=(d,o={day:'numeric',month:'long'})=>new Date(d+'T12:00:00').toLocaleDateString('ru',o);
function pill(st){const s=ST[st]||ST.new;return `<span class="pill" style="color:${s[1]};background:${s[2]}">${s[0]}</span>`}
function range(p,shift=0){if(p==='all')return shift?['','',0]:['0001-01-01','9999-12-31',0];const len=p==='day'?1:p==='week'?7:30,end=addDays(today(),-len*shift),start=addDays(end,-(len-1));return [start,end,len]}
const inR=(d,[s,e])=>d>=s&&d<=e;
function delta(a,b){if(!b)return '';const v=Math.round((a-b)/Math.abs(b)*100);return `<span class="dl ${v>=0?'up':'dn'}">${v>=0?'↑':'↓'} ${Math.abs(v)}%</span>`}
function stats(r){const bs=DB.bookings.filter(b=>inR(b.date,r)),done=bs.filter(b=>b.status==='done'),rev=done.reduce((a,b)=>a+b.price,0),ex=DB.expenses.filter(e=>inR(e.date,r)),exp=ex.reduce((a,e)=>a+e.amount,0);return {bs,done,rev,exp,ex,profit:rev-exp,clients:new Set(done.map(b=>b.phone)).size,noshow:bs.filter(b=>b.status==='noshow').length}}
function firstVisit(){const f={};[...DB.bookings].filter(b=>b.status==='done').sort((a,b)=>a.date<b.date?-1:1).forEach(b=>{if(!f[b.phone])f[b.phone]=b.date});return f}
function clients(){const m={};DB.bookings.forEach(b=>{const c=(m[b.phone]=m[b.phone]||{name:b.name,phone:b.phone,tgId:b.tgId,visits:0,sum:0,last:'',next:'',hist:[],svc:{}});c.hist.push(b);if(b.status==='done'){c.visits++;c.sum+=b.price;c.svc[b.service]=(c.svc[b.service]||0)+1;if(b.date>c.last)c.last=b.date}if(b.status==='new'&&b.date>=today()&&(!c.next||b.date<c.next))c.next=b.date});return Object.values(m)}
const daysSince=d=>d?Math.round((new Date(today())-new Date(d))/864e5):999;
function ctag(c){if(daysSince(c.last)>40&&!c.next&&c.visits)return ['Давно не была','t-sl'];if(c.visits>=5)return ['VIP','t-vip'];if(c.visits>=3)return ['Постоянная','t-reg'];if(c.visits<=1)return ['Новая','t-new'];return ['Повторная','t-rep']}
function hello(){const h=DT.now().setZone(DB.settings.timezone).hour;return h<5?'Доброй ночи':h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер'}

function renderAdmin(){
  document.body.classList.add('adm-on');$('sticky').style.display='none';
  $('tabbar').innerHTML=ATABS.map(([k,v])=>`<div class="tb ${atab===k?'on':''}" onclick="atab='${k}';haptic();render()">${IC[k]}${v}</div>`).join('');
  const T={today:[hello()+' ✿','Сегодня'],book:['Все визиты','Записи'],slots:['Когда вы работаете','Окошки'],fin:['Деньги','Финансы'],clients:['Ваша база','Клиенты']}[atab];
  $('ahSub').textContent=T[0];$('ahTitle').textContent=T[1];
  const fab=$('fab');fab.classList.toggle('show',['book','fin'].includes(atab));fab.onclick=atab==='fin'?()=>expSheet():()=>bookSheet();
  ({today:aToday,book:aBook,slots:aSlots,fin:aFin,clients:aClients})[atab]($('apanel'));
}
/* ---- Сегодня ---- */
function aToday(P){
  const t=today(),tb=DB.bookings.filter(b=>b.date===t&&b.status!=='cancel').sort((a,b)=>a.time.localeCompare(b.time));
  const exp=tb.filter(b=>b.status!=='noshow').reduce((a,b)=>a+b.price,0),free=freeTimes(t).length;
  const nx=DB.bookings.filter(b=>b.status==='new'&&(b.date>t||(b.date===t&&b.time>=nowT()))).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
  const week=[...Array(7)].map((_,i)=>{const d=addDays(t,i),sl=(DB.slots[d]||[]).length,bk=DB.bookings.filter(b=>b.date===d&&b.status!=='cancel').length;return {d,sl,bk}});
  const mxw=Math.max(1,...week.map(w=>w.sl));
  const pend=DB.bookings.filter(b=>b.status==='new'&&(b.date<t||(b.date===t&&b.time<nowT()))).length;
  P.innerHTML=`<div class="kpis"><div class="kpi pk">Записей сегодня<b>${tb.length}</b></div><div class="kpi">Ожидаемо за день<b>${fmt(exp)}</b></div></div>
  ${nx?`<div class="h3">Следующая</div><div class="next"><small>${rel(nx.date)}, ${dfmt(nx.date,{weekday:'long'})}</small><div class="tm2">${nx.time}</div><div class="who">${escapeHtml(nx.name)}</div><div class="what">${escapeHtml(nx.service)} · ${fmt(nx.price)}</div>
   <div class="acts">${isPhoneContact(nx.phone)?`<a class="b-ok" href="tel:${nx.phone}">Позвонить</a>`:''}${telegramContactUrl(nx)?`<button class="b-ghost" onclick="contactTelegram(${nx.id})">Написать</button>`:''}<button class="b-ghost" onclick="bookInfo(${nx.id})">Подробнее</button></div></div>`:''}
  ${pend?`<div class="card" style="display:flex;align-items:center;gap:12px;cursor:pointer" onclick="atab='book';bf='pend';render()"><div class="av" style="width:40px;height:40px">!</div><div style="flex:1"><b style="font-size:14px">Отметьте визиты</b><div class="mut">${pend} ${pend===1?'запись ждёт':pend<5?'записи ждут':'записей ждут'} статуса «пришла / не пришла»</div></div>→</div>`:''}
  <div class="h3">План на сегодня <a onclick="atab='slots';calD='${t}';render()">${free} своб.</a></div>
  ${tb.length?`<div class="tl2">${tb.map(b=>`<div class="it" style="--sc:${ST[b.status][1]}"><div class="t">${b.time}</div><div class="bk" onclick="bookInfo(${b.id})"><div class="av">${ini(b.name)}</div><div class="m"><b>${escapeHtml(b.name)}</b><span>${escapeHtml(b.service)}</span></div><div class="r"><b>${fmt(b.price)}</b>${pill(b.status)}</div></div></div>`).join('')}</div>`:`<div class="card empty">Сегодня записей нет.<br>Можно отдохнуть ☕</div>`}
  <div class="h3">Загрузка недели</div><div class="card"><div class="load">${week.map(w=>`<div><span style="color:var(--ink);font-weight:700">${w.sl?w.bk+'/'+w.sl:'—'}</span><em style="display:flex;align-items:flex-end;width:100%;height:70px;border-radius:12px;background:${w.sl?'rgba(35,26,30,.07)':'repeating-linear-gradient(45deg,rgba(35,26,30,.05) 0 4px,transparent 4px 8px)'};overflow:hidden"><i style="height:${w.sl?Math.min(100,w.bk/w.sl*100):0}%;border-radius:12px"></i></em>${new Date(w.d).toLocaleDateString('ru',{weekday:'short'})}</div>`).join('')}</div><div class="mut" style="margin-top:8px">Сколько окошек занято из открытых · штриховка — выходной</div></div>
  <div class="h3">Быстро</div><div class="qa"><div onclick="bookSheet()"><div class="ic2">${IC.plus}</div>Запись</div><div onclick="atab='slots';render()"><div class="ic2">${IC.clock}</div>Окошки</div><div onclick="expSheet()"><div class="ic2">${IC.money}</div>Расход</div></div>`;
}
/* ---- Записи ---- */
function aBook(P){
  const t=today(),n=nowT(),isPast=b=>b.date<t||(b.date===t&&b.time<n);
  const F={up:['Предстоящие',b=>!isPast(b)&&b.status==='new'],pend:['Отметить',b=>isPast(b)&&b.status==='new'],past:['Прошедшие',b=>isPast(b)||b.status==='done'||b.status==='noshow'],cancel:['Отмены',b=>b.status==='cancel'||b.status==='noshow'],all:['Все',()=>true]};
  let list=DB.bookings.filter(F[bf][1]).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));if(bf!=='up')list.reverse();list=list.slice(0,80);
  const g={};list.forEach(b=>(g[b.date]=g[b.date]||[]).push(b));
  P.innerHTML=`<div class="chips">${Object.entries(F).map(([k,[v,f]])=>`<div class="chip ${bf===k?'on':''}" onclick="bf='${k}';render()">${v}<i>${DB.bookings.filter(f).length}</i></div>`).join('')}</div>`+
  (list.length?Object.entries(g).map(([d,bs])=>`<div class="dh">${rel(d)==='Сегодня'||rel(d)==='Завтра'?rel(d)+' · ':''}${dfmt(d,{weekday:'long',day:'numeric',month:'long'})}</div>${bs.map(b=>`<div class="bk" style="margin-bottom:8px" onclick="bookInfo(${b.id})"><div style="font:500 14px Unbounded,Manrope,sans-serif;width:48px">${b.time}</div><div class="m"><b>${escapeHtml(b.name)}</b><span>${escapeHtml(b.service)}</span></div><div class="r"><b>${fmt(b.price)}</b>${pill(b.status)}</div></div>`).join('')}`).join(''):`<div class="card empty">Здесь пока пусто</div>`);
}
function bookInfo(id){
  const b=DB.bookings.find(x=>x.id===id),c=clients().find(x=>x.phone===b.phone);
  openSheet(`<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px"><div class="av" style="width:52px;height:52px;font-size:18px">${ini(b.name)}</div><div><h2 style="margin:0">${escapeHtml(b.name)}</h2><span class="ctag ${ctag(c)[1]}" style="margin:0">${ctag(c)[0]}</span> <span class="mut">визитов: ${c.visits}</span></div></div>
  <div class="kv"><span>Дата</span><b>${dfmt(b.date,{weekday:'short',day:'numeric',month:'long'})}, ${b.time}</b></div><div class="kv"><span>Услуга</span><b>${escapeHtml(b.service)}</b></div><div class="kv"><span>Стоимость</span><b>${fmt(b.price)}</b></div><div class="kv"><span>Контакт</span><b>${b.phone}</b></div>
  <label style="margin-top:16px">Статус</label><div class="stb">${Object.entries(ST).map(([k,v])=>`<button class="${b.status===k?'on':''}" style="color:${v[1]};background:${v[2]}" onclick="setSt(${b.id},'${k}')">${v[0]}</button>`).join('')}</div>
  <p class="mut status-help">Мастер может менять статус в любое время. «Пришла» учитывается в доходах по дате визита. Все отмеченные визиты видны в финансах за всё время.</p>
  <div class="btns">${isPhoneContact(b.phone)?`<a class="btn light" href="tel:${b.phone}">Позвонить</a>`:''}${telegramContactUrl(b)?`<button class="btn light" onclick="contactTelegram(${b.id})">Telegram</button>`:''}<button class="btn light" onclick="clientInfo('${b.phone}')">Карточка</button></div>
  ${b.status==='new'?`<button class="btn pk" style="margin-top:8px" onclick="moveSheet(${b.id},true)">Перенести визит</button>`:''}
  <button class="btn red" style="margin-top:8px" onclick="confirmDeleteBooking(${b.id})">Удалить запись</button>`);
}
async function setSt(id,status){await mutation(async()=>{await api('change',{id,action:'status',status});await refresh();render();bookInfo(id);haptic('success');});}
function confirmDeleteBooking(id){const b=DB.bookings.find(x=>x.id===id);if(!b)return;openSheet(`<h2>Удалить запись?</h2><p>Запись исчезнет из истории. Клиентка не получит уведомление об удалении.</p><button class="btn red" onclick="removeBooking(${id})">Удалить запись</button><button class="btn light" onclick="bookInfo(${id})">Назад</button>`)}
async function removeBooking(id){await mutation(async()=>{const b=DB.bookings.find(x=>x.id===id);if(b&&b.status!=='cancel')await api('change',{id,action:'status',status:'cancel'});await api('delete',{id});await refresh();closeSheet();render();});}
let manualRequestId=null;
function bookSheet(){manualRequestId=crypto.randomUUID();
  const days=Object.keys(DB.slots).filter(d=>d>=today()&&freeTimes(d).length).sort();
  const linked=[...new Map(DB.bookings.filter(b=>b.tgId).map(b=>[b.tgId,b])).values()];
  openSheet(`<h2>Новая запись</h2><label for="nbClient">Клиентка из приложения</label><select id="nbClient" onchange="selectManualClient()"><option value="">Новая клиентка / только контакт</option>${linked.map(b=>`<option value="${b.id}">${escapeHtml(b.name)} · ${escapeHtml(b.phone)}</option>`).join('')}</select><button type="button" id="nbReset" class="time-link manual-reset" hidden onclick="resetManualClient()">Сбросить выбор клиентки</button><p class="mut" id="nbNotice">Без привязки к аккаунту уведомления клиентке не отправятся.</p><label for="nbN">Имя</label><input id="nbN" placeholder="Имя" oninput="detachManualClient('name')"><label for="nbP">Телефон или Telegram</label><input id="nbP" placeholder="Номер телефона или @username" type="text" autocapitalize="off" spellcheck="false" maxlength="200" oninput="detachManualClient('contact')">
  <label>Услуга</label><select id="nbS" onchange="nbTimes()">${DB.services.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} — ${fmt(s.price)}</option>`).join('')}</select>
  <label>Когда</label><div class="flex"><select id="nbD" onchange="nbTimes()">${days.map(d=>`<option value="${d}">${dfmt(d,{weekday:'short',day:'numeric',month:'short'})}</option>`).join('')}</select><select id="nbT"></select></div>
  ${days.length?'':'<p class="mut">Нет свободных окошек — сначала добавьте их во вкладке «Окошки»</p>'}
  <button class="btn pk" style="margin-top:8px" onclick="addBook()">Записать</button>`);
  nbTimes();
}
function nbTimes(){const d=$('nbD')?.value,s=svcBy(+$('nbS').value);$('nbT').innerHTML=d?freeTimes(d,s.dur).map(t=>`<option>${t}</option>`).join(''):'';}
function manualClientNotice(linked){$('nbReset').hidden=!linked;$('nbNotice').textContent=linked?'Визит появится у клиентки, уведомления придут в её Telegram.':'Без привязки к аккаунту уведомления клиентке не отправятся.';}
function selectManualClient(){const b=DB.bookings.find(b=>b.id===+$('nbClient').value);$('nbN').value=b?.name||'';$('nbP').value=b?.phone||'';manualClientNotice(!!b);}
function resetManualClient(){$('nbClient').value='';selectManualClient();$('nbN').focus();}
function detachManualClient(field){if($('nbClient').value){$('nbClient').value='';$(field==='name'?'nbP':'nbN').value='';}manualClientNotice(false);}
async function addBook(){const name=$('nbN').value.trim(),phone=$('nbP').value.trim(),date=$('nbD').value,time=$('nbT').value,serviceId=+$('nbS').value,clientBookingId=+$('nbClient').value||null;await mutation(async()=>{await api('book',{name,phone,date,time,serviceId,clientBookingId,manual:true,requestId:manualRequestId});await refresh().catch(()=>{});closeSheet();atab='book';bf='up';render();haptic('success');});}
/* ---- Окошки ---- */
function aSlots(P){
  const t=today();if(!calM)calM=t.slice(0,7);if(!calD)calD=t;
  const [y,m]=calM.split('-').map(Number),first=new Date(y,m-1,1),off=(first.getDay()+6)%7,dim=new Date(y,m,0).getDate();
  let cells='';for(let i=0;i<off;i++)cells+='<div></div>';
  for(let d=1;d<=dim;d++){const ds=`${calM}-${String(d).padStart(2,'0')}`,sl=DB.slots[ds]||[],bk=DB.bookings.filter(b=>b.date===ds&&b.status!=='cancel').length;
    cells+=`<div data-date="${ds}" class="c ${ds<t?'past':''} ${sl.length?'has':''} ${ds===calD?'sel':''} ${ds===t?'today':''}" onclick="calD='${ds}';haptic();render()">${d}<em>${sl.length?[...Array(Math.min(3,bk))].map(()=>'<s class="b"></s>').join('')+(sl.length>bk?'<s></s>':''):''}</em></div>`}
  const sl=DB.slots[calD]||[],booked=DB.bookings.filter(b=>b.date===calD&&b.status!=='cancel'),bt=booked.map(b=>b.time);
  const all=[...new Set([...DB.settings.tpl,...sl,...bt])].sort();
  P.innerHTML=`<div class="card" style="margin-top:0"><div class="calh2"><button onclick="calShift(-1)">‹</button><span>${first.toLocaleString('ru',{month:'long',year:'numeric'})}</span><button onclick="calShift(1)">›</button></div>
  <div class="calg">${['пн','вт','ср','чт','пт','сб','вс'].map(w=>`<div class="wd">${w}</div>`).join('')}${cells}</div></div>
  <div class="h3">${dfmt(calD,{weekday:'long',day:'numeric',month:'long'})}<button type="button" class="time-link" onclick="addCustomTime()">+ своё время</button></div>
  <div class="slots">${all.map(x=>{const point=DT.fromISO(calD+'T'+x,{zone:DB.settings.timezone}).toMillis(),match=booked.find(q=>point>=q.startMs&&point<q.endMs),b=!!match;return `<div class="sl ${b?'bk2':sl.includes(x)?'on':''}" onclick="${b?`bookInfo(${match.id})`:`toggleSlot('${x}')`}">${x}</div>`}).join('')}</div>
  <div class="legend"><span>Открыто для записи</span><span class="b">Занято</span><span class="o">Закрыто</span></div>
  <div class="btns"><button class="btn light" onclick="fillDay()">Весь день</button><button class="btn light" onclick="clearDay()">Выходной</button></div>
  <button class="btn" style="margin-top:8px" onclick="repeatWeeks()">Повторить этот день на неделю</button>
  <button class="btn light" style="margin-top:8px" onclick="blocksSheet()">Перерывы и отпуск</button>
  <p class="mut" style="margin:10px 4px">Нажмите на время, чтобы открыть или закрыть окошко. Клиентки видят только открытые.</p>`;
}
function calShift(n){const [y,m]=calM.split('-').map(Number),d=new Date(y,m-1+n,1);calM=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');render()}
function toggleSlot(x){const s=new Set(DB.slots[calD]||[]);s.has(x)?s.delete(x):s.add(x);DB.slots[calD]=[...s].sort();if(!DB.slots[calD].length)delete DB.slots[calD];save();haptic();render()}
function fillDay(){DB.slots[calD]=[...new Set([...(DB.slots[calD]||[]),...DB.settings.tpl])].sort();save();render()}
function clearDay(){const bt=DB.bookings.filter(b=>b.date===calD&&b.status!=='cancel').map(b=>b.time);if(bt.length){DB.slots[calD]=bt}else delete DB.slots[calD];save();render();if(bt.length)alert('Занятые окошки оставлены — сначала отмените записи')}
function repeatWeeks(){const s=DB.slots[calD]||[];for(let i=1;i<=7;i++){const d=addDays(calD,i);DB.slots[d]=[...new Set([...(DB.slots[d]||[]),...s])].sort();if(!DB.slots[d].length)delete DB.slots[d]}save();haptic('success');render()}
function addCustomTime(){openTimeEditor('slot',calD||today());}
/* ---- Финансы ---- */
function aFin(P){
  const r=range(period),pr=range(period,1),S=stats(r),Sp=stats(pr);
  const outside=DB.bookings.filter(b=>b.status==='done'&&!inR(b.date,r));
  const days=[...Array(r[2])].map((_,i)=>addDays(r[0],i)),per=days.map(d=>S.done.filter(b=>b.date===d).reduce((a,b)=>a+b.price,0)),mx=Math.max(1,...per);
  const byC={};S.ex.forEach(e=>byC[e.cat]=(byC[e.cat]||0)+e.amount);const cs=Object.entries(byC).sort((a,b)=>b[1]-a[1]);let acc=0;
  const grad=cs.length?cs.map(([k,v],i)=>{const a=acc;acc+=v/S.exp*100;return `${CCOL[Math.max(0,DB.cats.indexOf(k))%CCOL.length]} ${a}% ${acc}%`}).join(','):'rgba(35,26,30,.08) 0 100%';
  const top={};S.done.forEach(b=>top[b.service]=(top[b.service]||0)+b.price);const tm=Math.max(1,...Object.values(top));
  const fv=firstVisit(),uniq=[...new Set(S.done.map(b=>b.phone))],nw=uniq.filter(p=>inR(fv[p],r)).length;
  P.innerHTML=`<div class="seg finance-periods">${[['all','Всё время'],['day','День'],['week','Неделя'],['month','Месяц']].map(([k,v])=>`<div class="${period===k?'on':''}" onclick="period='${k}';render()">${v}</div>`).join('')}</div>
  <div class="kpis"><div class="kpi dk span">Чистая прибыль<b style="font-size:32px">${fmt(S.profit)}${delta(S.profit,Sp.profit)}</b><div style="margin-top:4px;font-size:11.5px;opacity:.7">${period==='all'?'Все отмеченные визиты и расходы':dfmt(r[0],{day:'numeric',month:'short'})+(r[2]>1?' — '+dfmt(r[1],{day:'numeric',month:'short'}):'')+' · к прошлому периоду'}</div></div>
  <div class="kpi pk">Доход<b id="financeRevenue">${fmt(S.rev)}</b></div><div class="kpi">Расходы<b>${fmt(S.exp)}</b></div></div>
  <p class="mut finance-help">Доход учитывается по дате визита для записей со статусом «Пришла». ${period==='all'?'Здесь видны и уже отмеченные визиты на будущие даты.':''}</p>
  ${outside.length?`<div class="card finance-outside"><p>За выбранный период показана часть дохода. Отмеченных визитов вне периода: ${outside.length}.</p><button type="button" class="btn light" onclick="period='all';render()">Показать весь доход</button></div>`:''}
  ${r[2]>1?`<div class="card"><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600"><span>Доход по дням</span><span class="mut">макс. ${fmt(mx)}</span></div><div class="bars">${per.map((v,i)=>`<i class="${v?'':'z'}" style="height:${v?Math.max(4,v/mx*100):3}%;animation-delay:${i*15}ms" title="${fmt(v)}"></i>`).join('')}</div><div class="bx-l"><span>${dfmt(r[0],{day:'numeric',month:'short'})}</span><span>${dfmt(r[1],{day:'numeric',month:'short'})}</span></div></div>`:''}
  <div class="h3">Клиенты</div><div class="kpis"><div class="kpi">Клиенток<b>${uniq.length}${delta(uniq.length,new Set(Sp.done.map(b=>b.phone)).size)}</b></div><div class="kpi">Визитов<b>${S.done.length}</b></div><div class="kpi">Новые<b>${nw}</b></div><div class="kpi">Вернулись<b>${uniq.length-nw}</b></div><div class="kpi">Средний чек<b>${fmt(S.done.length?S.rev/S.done.length:0)}</b></div><div class="kpi">Не пришли<b>${S.bs.length?Math.round(S.noshow/S.bs.length*100):0}%</b></div></div>
  <div class="h3">Что приносит деньги</div><div class="card">${Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`<div class="hb"><div class="l"><span>${escapeHtml(k)}</span><b>${fmt(v)}</b></div><div class="bar"><i style="width:${v/tm*100}%"></i></div></div>`).join('')||'<div class="empty">Нет визитов за период</div>'}</div>
  <div class="h3">Расходы <a onclick="catSheet()">Категории</a></div><div class="card"><div class="donut"><div class="d0" style="background:conic-gradient(${grad})"><span>${fmt(S.exp)}</span></div><div class="lg">${cs.map(([k,v])=>`<div><i style="background:${CCOL[Math.max(0,DB.cats.indexOf(k))%CCOL.length]}"></i>${escapeHtml(k)}<b>${Math.round(v/S.exp*100)}%</b></div>`).join('')||'<span class="mut">Расходов нет</span>'}</div></div></div>
  <button class="btn pk" style="margin-top:10px" onclick="expSheet()">+ Добавить расход</button>
  <div class="h3">История расходов</div><p class="mut">Нажмите на расход, чтобы изменить или удалить его.</p>${[...DB.expenses].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30).map(e=>`<div class="bk" style="margin-bottom:8px" onclick="expSheet(${e.id})"><div class="av" style="background:${CCOL[Math.max(0,DB.cats.indexOf(e.cat))%CCOL.length]}22;color:${CCOL[Math.max(0,DB.cats.indexOf(e.cat))%CCOL.length]}">${ini(e.cat)}</div><div class="m"><b>${escapeHtml(e.note||e.cat)}</b><span>${escapeHtml(e.cat)} · ${dfmt(e.date,{day:'numeric',month:'short'})}</span></div><div class="r"><b>−${fmt(e.amount)}</b></div></div>`).join('')}`;
}
let expCat=null;
function expSheet(id){
  const e=id?DB.expenses.find(x=>x.id===id):null;expCat=e?e.cat:DB.cats[0];
  openSheet(`<h2>${e?'Расход':'Новый расход'}</h2><input id="eA" class="amt" type="number" inputmode="numeric" placeholder="0 ₽" value="${e?e.amount:''}">
  <label>Категория</label><div class="catg" id="catg"></div>
  <div class="flex"><input id="eD" type="date" value="${e?e.date:today()}"><input id="eN" placeholder="Комментарий" value="${escapeHtml(e?.note||'')}"></div>
  <button class="btn pk" onclick="saveExp(${id||0})">Сохранить</button>${e?`<button class="btn red" style="margin-top:8px" onclick="confirmDeleteExpense(${id})">Удалить расход</button>`:''}`);
  drawCats();if(!e)setTimeout(()=>$('eA').focus(),350);
}
function confirmDeleteExpense(id){const e=DB.expenses.find(x=>x.id===id);if(!e)return;openSheet(`<h2>Удалить расход?</h2><p>${escapeHtml(e.note||e.cat)} · ${fmt(e.amount)}</p><p class="mut">Расход исчезнет из истории и расчёта прибыли.</p><button class="btn red" onclick="deleteExpense(${id})">Удалить расход</button><button class="btn light" style="margin-top:8px" onclick="expSheet(${id})">Назад</button>`)}
async function deleteExpense(id){DB.expenses=DB.expenses.filter(x=>x.id!==id);if(await save()){closeSheet();render();haptic('success')}}
function drawCats(){$('catg').innerHTML=DB.cats.map((c,i)=>`<div class="chip ${expCat===c?'on':''}" onclick="expCat=DB.cats[${i}];drawCats()">${escapeHtml(c)}</div>`).join('')+`<div class="chip" onclick="const n=prompt('Новая категория');if(n){DB.cats.push(n);expCat=n;save();drawCats()}">+</div>`;}
function saveExp(id){const a=+$('eA').value;if(!a)return alert('Введите сумму');const o={cat:expCat,amount:a,date:$('eD').value,note:$('eN').value};if(id)Object.assign(DB.expenses.find(x=>x.id===id),o);else DB.expenses.push({id:Date.now(),...o});save();haptic('success');closeSheet();render()}
function catSheet(){openSheet(`<h2>Категории расходов</h2>${DB.cats.map((c,i)=>`<div class="svr"><div class="av" style="background:${CCOL[i%CCOL.length]}22;color:${CCOL[i%CCOL.length]}">${ini(c)}</div><div class="f" style="grid-template-columns:1fr"><input value="${escapeHtml(c)}" onchange="renCat(${i},this.value)"></div><div class="x"><button onclick="removeCategory(${i})">×</button></div></div>`).join('')}<button class="btn light" onclick="DB.cats.push('Новая категория');save();catSheet()">+ Добавить категорию</button>`)}
function renCat(i,v){const o=DB.cats[i];DB.cats[i]=v;DB.expenses.forEach(e=>{if(e.cat===o)e.cat=v});save();render()}
/* ---- Клиенты ---- */
function aClients(P){
  const all=clients().filter(c=>c.visits||c.next);
  const SEG={all:['Все',()=>true],new:['Новые',c=>c.visits<=1],reg:['Постоянные',c=>c.visits>=3],vip:['VIP',c=>c.visits>=5],sleep:['Давно не были',c=>ctag(c)[0]==='Давно не была']};
  const q=cq.toLowerCase(),list=all.filter(SEG[cseg][1]).filter(c=>!q||c.name.toLowerCase().includes(q)||c.phone.includes(q)).sort((a,b)=>b.sum-a.sum);
  const ret=all.length?Math.round(all.filter(c=>c.visits>=2).length/all.length*100):0;
  P.innerHTML=`<div class="kpis" style="margin-bottom:12px"><div class="kpi pk">Всего клиенток<b>${all.length}</b></div><div class="kpi">Возвращаются<b>${ret}%</b></div></div>
  <div class="srch">${IC.srch}<input placeholder="Имя, телефон или Telegram" value="${escapeHtml(cq)}" oninput="cq=this.value;aClients($('apanel'));const i=$('apanel').querySelector('input');i.focus();i.setSelectionRange(99,99)"></div>
  <div class="chips">${Object.entries(SEG).map(([k,[v,f]])=>`<div class="chip ${cseg===k?'on':''}" onclick="cseg='${k}';render()">${v}<i>${all.filter(f).length}</i></div>`).join('')}</div>
  ${cseg==='sleep'&&list.length?`<div class="card" style="margin:0 0 10px;font-size:13px;color:var(--ink2)">💌 Напишите им с персональной скидкой — это самый дешёвый способ вернуть клиентку</div>`:''}
  ${list.map(c=>{const t=ctag(c);return `<div class="bk" style="margin-bottom:8px" onclick="clientInfo('${c.phone}')"><div class="av">${ini(c.name)}</div><div class="m"><b>${escapeHtml(c.name)}<span class="ctag ${t[1]}">${t[0]}</span></b><span>${c.visits} ${c.visits%10===1&&c.visits!==11?'визит':c.visits%10>=2&&c.visits%10<=4&&(c.visits<10||c.visits>20)?'визита':'визитов'} · ${c.last?'был'+'а '+(daysSince(c.last)===0?'сегодня':daysSince(c.last)+' дн. назад'):'ещё не была'}</span></div><div class="r"><b>${fmt(c.sum)}</b></div></div>`}).join('')||'<div class="card empty">Никого не нашли</div>'}`;
}
function clientInfo(ph){
  const c=clients().find(x=>x.phone===ph),t=ctag(c),fav=Object.entries(c.svc).sort((a,b)=>b[1]-a[1])[0];
  openSheet(`<div style="text-align:center"><div class="av" style="width:68px;height:68px;font-size:24px;margin:0 auto 10px">${ini(c.name)}</div><h2 style="margin-bottom:6px">${escapeHtml(c.name)}</h2><span class="ctag ${t[1]}" style="margin:0">${t[0]}</span><div class="mut" style="margin-top:6px">${c.phone}</div></div>
  <div class="kpis" style="margin-top:16px"><div class="kpi">Визитов<b>${c.visits}</b></div><div class="kpi">Потратила<b>${fmt(c.sum)}</b></div><div class="kpi">Средний чек<b>${fmt(c.visits?c.sum/c.visits:0)}</b></div><div class="kpi">Любит<b style="font-size:14px;line-height:1.3">${escapeHtml(fav?fav[0]:'—')}</b></div></div>
  <div class="btns">${isPhoneContact(c.phone)?`<a class="btn" href="tel:${c.phone}">Позвонить</a>`:''}${c.phone?`<button class="btn light" onclick="clientTelegram('${c.phone}')">Telegram</button>`:''}</div>
  <label style="margin-top:16px">Заметка</label><textarea placeholder="Аллергии, предпочтения, форма ногтей…" onchange="DB.notes[\`${c.phone}\`]=this.value;save()">${escapeHtml(DB.notes[c.phone]||'')}</textarea>
  <label style="margin-top:12px">История</label>${c.hist.sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(b=>`<div class="kv"><span>${dfmt(b.date,{day:'numeric',month:'short',year:'2-digit'})} · ${escapeHtml(b.service)}</span><b>${fmt(b.price)} ${b.status!=='done'?pill(b.status):''}</b></div>`).join('')}`);
}
/* ---- Настройки ---- */
function openSettings(){openSheet(`<h2>Настройки</h2>
  <div class="mrow" onclick="svcSheet()"><div class="ic2">${IC.tag}</div>Услуги и цены<span>${DB.services.length} →</span></div>
  <div class="mrow" onclick="photoSheet()"><div class="ic2">${IC.img}</div>Фото работ<span>${DB.photos.length||'демо'} →</span></div>
  <div class="mrow" onclick="catSheet()"><div class="ic2">${IC.money}</div>Категории расходов<span>${DB.cats.length} →</span></div>
  <div class="mrow" onclick="blocksSheet()">Перерывы и отпуск<span>→</span></div>
  <div class="mrow" onclick="exportSheet()">Экспорт данных<span>→</span></div>
  <div class="mrow" onclick="auditSheet()">Журнал изменений<span>→</span></div>
  <div class="mrow" onclick="diagnosticsSheet()">Состояние уведомлений<span>→</span></div>
  <label style="margin-top:16px">Студия</label><input id="settingsStudio" value="${escapeHtml(DB.studio)}" placeholder="Название"><input id="settingsAddress" value="${escapeHtml(DB.settings.address)}" placeholder="Адрес"><input id="settingsHours" value="${escapeHtml(DB.settings.hours)}" placeholder="Часы работы">
  <div class="template-preview"><label>Шаблон рабочего дня</label><div class="time-chips">${DB.settings.tpl.map(t=>`<span class="time-chip">${t}</span>`).join('')||'<span class="mut">Время ещё не добавлено</span>'}</div><button type="button" class="btn light" onclick="openTimeEditor('template')">Изменить шаблон</button><p class="mut">Выбирай часы и минуты или вводи время вручную. Шаблон подставляется кнопкой «Весь день».</p></div>
  <label>Часовой пояс</label><input id="settingsTimezone" value="${escapeHtml(DB.settings.timezone)}"><label>Конец рабочего дня</label><input id="settingsDayEnd" type="time" value="${DB.settings.dayEnd}">
  <label for="bufferMinutes">Буфер между визитами, мин</label><input id="bufferMinutes" type="number" min="0" max="120" value="${DB.settings.bufferMinutes||0}">
  <label for="masterContact">Контакт мастера</label><input id="masterContact" placeholder="@username или +79001234567" value="${escapeHtml(DB.settings.masterContact||'')}"><p class="mut">Клиентка сможет связаться с тобой, если отмена через приложение уже закрыта.</p><button class="btn pk" onclick="saveSettings()">Сохранить</button>`)}
async function saveSettings(){DB.studio=$('settingsStudio').value.trim();Object.assign(DB.settings,{address:$('settingsAddress').value.trim(),hours:$('settingsHours').value.trim(),timezone:$('settingsTimezone').value.trim(),dayEnd:$('settingsDayEnd').value,bufferMinutes:+$('bufferMinutes').value,masterContact:$('masterContact').value.trim()});if(await save()){haptic('success');closeSheet();render()}}
function svcSheet(){openSheet(`<button type="button" class="btn light" onclick="openSettings()">← В настройки</button><h2>Услуги и цены</h2>${DB.services.map(s=>`<div class="svr"><img src="${pimg(s)}" onclick="upd(${s.id},'img',${s.img+1});svcSheet()" title="Сменить фото"><div class="f"><input value="${escapeHtml(s.name)}" onchange="upd(${s.id},'name',this.value)"><input type="number" value="${s.price}" onchange="upd(${s.id},'price',+this.value)" placeholder="Цена"><input type="number" value="${s.dur}" onchange="upd(${s.id},'dur',+this.value)" placeholder="Мин"></div><div class="x"><button onclick="upd(${s.id},'popular',${!s.popular});svcSheet()" style="color:${s.popular?'#F2A33A':''}">★</button><button onclick="if(confirm('Удалить услугу?')){DB.services=DB.services.filter(x=>x.id!==${s.id});save();svcSheet()}">×</button></div></div>`).join('')}
  <p class="mut" style="margin:4px 4px 10px">Цена · длительность в минутах · ★ показывать на главной · нажмите на фото, чтобы сменить</p><button class="btn pk" onclick="DB.services.push({id:Date.now(),name:'Новая услуга',price:1000,dur:60,img:0});save();svcSheet()">+ Добавить услугу</button>`)}
function photoSheet(){openSheet(`<h2>Фото работ</h2><p class="mut" style="margin-bottom:10px">${DB.photos.length?'Первое фото — главное на экране клиента':'Сейчас показаны демо-фото. Загрузите свои — они заменят демо.'}</p><div class="ph">${DB.photos.map((p,i)=>`<div><img src="${p}"><button onclick="DB.photos.splice(${i},1);save();photoSheet()">×</button></div>`).join('')}</div>
  <label class="btn pk" style="margin-top:12px;text-transform:none;letter-spacing:0;font-size:14px;color:#fff">+ Загрузить фото<input type="file" accept="image/*" multiple style="display:none" onchange="upPhotos(this.files)"></label>`)}
async function upPhotos(files){
 await mutation(async()=>{
  for(const f of files){
   if(!/^image\/(jpeg|png|webp)$/.test(f.type)||f.size>15000000)throw new Error('Выбери JPEG, PNG или WebP до 15 МБ');
   const bitmap=await createImageBitmap(f),ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*ratio));c.height=Math.max(1,Math.round(bitmap.height*ratio));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();
   const result=await api('upload',{image:c.toDataURL('image/jpeg',.82)});DB.photos.push(result.url);
  }
  const {bookings,busy,...config}=structuredClone(DB);const r=await api('save',{version:VERSION,config});VERSION=r.version;photoSheet();
 });
}
function upd(id,k,v){DB.services.find(s=>s.id===id)[k]=v;save()}
function openSheet(h){$('sheetC').innerHTML=h;$('sheet').scrollTop=0;$('sheet').classList.add('on');$('sheet').setAttribute('aria-hidden','false');$('sheet').inert=false;$('sbg').classList.add('on');syncTelegramNavigation();haptic()}
function closeSheet(){$('sheet').classList.remove('on');$('sheet').setAttribute('aria-hidden','true');$('sheet').inert=true;$('sbg').classList.remove('on');syncTelegramNavigation()}
function toggleAdmin(){go(screen==='admin'?'home':'admin');$('admBtn').textContent=screen==='admin'?'клиент':'admin'}
function render(){({home:renderHome,date:renderDate,svc:renderSvc,form:renderForm,ok:()=>cta('На главную',()=>go('home')),admin:renderAdmin})[screen]()}

function showMine(){
 if(!SESSION)return;
 const list=DB.bookings.filter(b=>b.tgId===SESSION.user.id).sort((a,b)=>b.startMs-a.startMs);
 openSheet(`<h2>Мои записи</h2><p class="mut">Время студии: ${escapeHtml(DB.settings.timezone)}. Отмена и перенос — за 12 часов до визита.</p>${list.map(b=>`<div class="card"><b>${b.date}, ${b.time}</b><p>${escapeHtml(b.service)} · ${fmt(b.price)}</p>${pill(b.status)}${b.status==='new'&&b.startMs-Date.now()>=43200000?`<div class="btns"><button class="btn light" onclick="moveSheet(${b.id})">Перенести</button><button class="btn red" onclick="cancelMine(${b.id})">Отменить</button></div>`:b.status==='new'?`<p class="mut">Для изменения визита свяжись с мастером.</p>${masterContactButton()}`:''}</div>`).join('')||'<p>Пока нет записей</p>'}${DB.historyNext?'<button class="btn light" onclick="loadHistory()">Показать ещё</button>':''}`);
}
async function cancelMine(id){if(!confirm('Отменить запись?'))return;await mutation(async()=>{await api('change',{id,action:'cancel'});await refresh();showMine();});}
let movingAsAdmin=false;
function moveSheet(id,admin=false){movingAsAdmin=admin;const b=DB.bookings.find(b=>b.id===id);const days=Object.keys(DB.slots).filter(d=>freeTimes(d,b.dur,b.id).length).sort();openSheet(`<h2>Перенести запись</h2><label for="moveDay">Дата</label><select id="moveDay" onchange="moveTimes(${id})">${days.map(d=>`<option>${d}</option>`).join('')}</select><label for="moveTime">Время</label><select id="moveTime"></select><button class="btn pk" ${days.length?'':'disabled'} onclick="submitMove(${id})">Подтвердить перенос</button>${days.length?'':'<p>Свободных окошек нет</p>'}`);moveTimes(id);}
function moveTimes(id){const b=DB.bookings.find(b=>b.id===id),day=$('moveDay').value;$('moveTime').innerHTML=day?freeTimes(day,b.dur,b.id).map(t=>`<option>${t}</option>`).join(''):'';}
async function submitMove(id){const date=$('moveDay').value,time=$('moveTime').value,admin=movingAsAdmin;await mutation(async()=>{await api('change',{id,action:'reschedule',date,time});await refresh();if(admin){render();bookInfo(id);}else showMine();});}
async function boot(){
 try{await refresh();$('admBtn').hidden=!SESSION.admin;$('loading').hidden=true;
 const h=location.hash.slice(1);go(h.startsWith('admin')&&SESSION.admin?'admin':'home');if(h==='mine')showMine();
 }catch(e){$('loadingText').textContent=e.message;$('retry').hidden=false;}
}
boot();

setInterval(async()=>{if(!SESSION||working||document.hidden||$('sheet').classList.contains('on')||!['home','date','admin'].includes(screen))return;try{await refresh();render();}catch{}},30000);

function removeCategory(i){const c=DB.cats[i];if(DB.expenses.some(e=>e.cat===c))return alert('Категория используется в расходах. Сначала измени категории этих расходов.');DB.cats.splice(i,1);save();catSheet();render();}

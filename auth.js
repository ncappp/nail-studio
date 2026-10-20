import { createHmac, timingSafeEqual } from 'node:crypto';
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function authenticate(raw,token,now=Math.floor(Date.now()/1000)) {
 if(!token) throw new HttpError(503,'Бот ещё не подключён');
 if(typeof raw!=='string'||raw.length>12000) throw new HttpError(401,'Открой приложение через Telegram');
 const p=new URLSearchParams(raw),keys=[...p.keys()];
 if(new Set(keys).size!==keys.length) throw new HttpError(401,'Некорректная подпись');
 const hash=p.get('hash');p.delete('hash');
 if(!/^[a-f0-9]{64}$/i.test(hash||'')) throw new HttpError(401,'Открой приложение через Telegram');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const expected=createHmac('sha256',secret).update([...p.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>`${k}=${v}`).join('\n')).digest();
 if(!timingSafeEqual(expected,Buffer.from(hash,'hex'))) throw new HttpError(401,'Подпись Telegram не прошла проверку');
 const date=Number(p.get('auth_date'));
 if(!Number.isInteger(date)||date>now+30||now-date>3600) throw new HttpError(401,'Сессия истекла. Закрой и заново открой приложение');
 let u;try{u=JSON.parse(p.get('user'));}catch{throw new HttpError(401,'Не удалось определить пользователя');}
 if(!u||!Number.isSafeInteger(u.id)||u.id<=0) throw new HttpError(401,'Нет пользователя Telegram');
 return u;
}
export const isAdmin=u=>String(u?.id)===process.env.ADMIN_TELEGRAM_ID && /^[1-9]\d*$/.test(process.env.ADMIN_TELEGRAM_ID||'');
export function requireAdmin(u){if(!isAdmin(u))throw new HttpError(403,'Доступ только для мастера');}
export function checkSecret(actual,expected){if(!expected||typeof actual!=='string'||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new HttpError(401,'Нет доступа');}

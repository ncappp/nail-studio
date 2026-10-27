// Guard user-controlled cells against spreadsheet formula execution.
export function csv(rows){
 const cell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
export function bookingCsv(data){return csv([['ID','Дата','Время','Клиентка','Контакт','Услуга','Цена','Минуты','Статус'],...data.bookings.map(b=>[b.id,b.date,b.time,b.name,b.phone,b.service,b.price,b.dur,b.status])]);}
export function expenseCsv(data){return csv([['ID','Дата','Категория','Сумма','Комментарий'],...data.expenses.map(e=>[e.id,e.date,e.cat,e.amount,e.note])]);}

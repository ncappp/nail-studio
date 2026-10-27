// Preserve the existing visual controls while exposing keyboard and screen-reader actions.
function enhanceControls(){
 document.querySelectorAll('div[onclick],img[onclick],a[onclick]:not([href])').forEach(e=>{e.setAttribute('role','button');e.tabIndex=0;});
 document.querySelectorAll('img:not([alt])').forEach(e=>e.alt='Работа мастера');
 document.querySelectorAll('input:not([type=file]),select,textarea').forEach(e=>{
  if(e.labels?.length||e.hasAttribute('aria-label'))return;
  const label=e.previousElementSibling;
  if(label?.tagName==='LABEL'){if(!e.id)e.id='field-'+crypto.randomUUID();label.htmlFor=e.id;}
  else e.setAttribute('aria-label',e.placeholder||'Значение');
 });
}
new MutationObserver(enhanceControls).observe(document.body,{childList:true,subtree:true});
enhanceControls();
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){if(document.getElementById('sv')?.classList.contains('on'))closeStory();else closeSheet();return;}
 const sheet=document.getElementById('sheet');
 if(e.key==='Tab'&&sheet?.classList.contains('on')){
  const items=[...sheet.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex="0"]')].filter(x=>x.getClientRects().length);
  const first=items[0],last=items.at(-1);
  if(e.shiftKey&&(!sheet.contains(document.activeElement)||document.activeElement===first)){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&(!sheet.contains(document.activeElement)||document.activeElement===last)){e.preventDefault();first?.focus();}
 }
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button]:not(button)')){e.preventDefault();e.target.click();}
});

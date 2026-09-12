// M4 y M5 - la rutina guiada y el reporte de molestias.
import crypto from 'node:crypto';
const BASE='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8788';
const LLAVE = process.env.WEBHOOK_LLAVE || 'llave-local';
const ADMIN='local-admin', SECRET='local-app-secret', TEL='573005554433';

const post = (path, body) => fetch(BASE+'/admin'+path, {
  method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${ADMIN}` },
  body: JSON.stringify(body),
});
function webhook(mensaje){
  const payload = { object:'whatsapp_business_account', entry:[{ id:'1', changes:[{ field:'messages', value:{
    messaging_product:'whatsapp', metadata:{ phone_number_id:'123456' },
    contacts:[{ profile:{ name:'Luis' }, wa_id:TEL }], messages:[mensaje] }}]}]};
  const raw = JSON.stringify(payload);
  const sig = 'sha256='+crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  return fetch(BASE+'/webhook/kapso?k='+LLAVE, { method:'POST', headers:{'content-type':'application/json','x-hub-signature-256':sig}, body:raw });
}
const texto = (id, body) => ({ id, from:TEL, timestamp:'1', type:'text', text:{ body } });
const boton = (id, btnId) => ({ id, from:TEL, timestamp:'1', type:'interactive',
  interactive:{ type:'button_reply', button_reply:{ id:btnId, title:'x' } } });
const enviados = async () => (await (await fetch(MOCK+'/__enviados')).json());
const estado = async () => (await (await fetch(`${BASE}/admin/estado?telefono=%2B${TEL}`, { headers:{authorization:`Bearer ${ADMIN}`}})).json());
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const check = (n, ok, extra='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${extra?' — '+extra:''}`); if(!ok) process.exitCode = 1; };

await fetch(BASE+'/admin/reset', { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${ADMIN}` }, body:'{"confirmar":"si"}' });

await post('/empresa', { nombre:'Rutina SAS' });
await webhook(texto('p.1','Hola')); await espera(500);
await webhook(boton('p.2','optin_si')); await espera(500);
const rec = await (await post('/recordatorio', { telefono:'+'+TEL })).json();
check('recordatorio enviado', rec.canal==='libre', JSON.stringify(rec));

const botones = (await enviados()).at(-1).payload.interactive.action.buttons;
await webhook(boton('p.3', botones[0].reply.id)); await espera(500);
const url = (await enviados()).at(-1).payload.interactive.action.parameters.url;
check('llega el link de la rutina', !!url && url.includes('/p/'));

// --- la pagina ---
const r = await fetch(url);
const pagina = await r.text();
check('la pagina responde 200', r.status===200);
check('no se cachea', (r.headers.get('cache-control')||'').includes('no-store'));
for (const zona of ['Cuello','Hombros','Muñecas','Espalda alta','Ojos','Piernas'])
  check(`incluye el ejercicio de ${zona.toLowerCase()}`, pagina.includes(zona));
// Los SVG del personaje y del cronometro tambien cuentan, asi que se buscan
// solo los del viewBox de los ejercicios.
check('trae 6 ilustraciones de ejercicio',
  (pagina.match(/viewBox=\\"0 0 200 170\\"/g)||[]).length === 6,
  String((pagina.match(/viewBox=\\"0 0 200 170\\"/g)||[]).length));
check('ninguna instruccion pasa de 12 palabras',
  [...pagina.matchAll(/"instruccion":"([^"]+)"/g)].every(m => m[1].split(/\s+/).length <= 12));
check('la rutina dura 180 s', [...pagina.matchAll(/"segundos":(\d+)/g)].reduce((t,m)=>t+ +m[1],0) === 180);
check('abrir la pagina marca iniciada', (await estado()).pausas[0]?.estado === 'iniciada');

// --- avance por sendBeacon ---
await fetch(url+'/avance', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ejercicio:3}) });
const ev = (await estado()).eventos.find(e=>e.tipo==='avance_pausa');
check('el beacon registra hasta donde llego', !!ev && JSON.parse(ev.payload).ejercicio===3);
check('...y la pausa sigue sin completarse', (await estado()).pausas[0]?.estado === 'iniciada');

// --- completar ---
// El servidor no acepta una pausa despachada en segundos: saltar los seis
// ejercicios a toques no puede valer como evidencia.
const rapido = await (await fetch(url+'/done',{method:'POST'})).json();
check('rechaza completarla demasiado rapido', rapido.ok===false && rapido.motivo==='muy_rapido',
  JSON.stringify(rapido));
check('y la deja en iniciada', (await estado()).pausas[0]?.estado === 'iniciada');
const evRapido = (await estado()).eventos.find(e=>e.tipo==='pausa_demasiado_rapida');
check('deja constancia del intento', !!evRapido);

// Pasado el minimo (3 s en local, 120 s en produccion) si cuenta.
await espera(3200);
const lento = await fetch(url+'/done',{method:'POST'});
check('POST /done responde ok pasado el minimo', lento.status===200);
check('la pausa queda completada', (await estado()).pausas[0]?.estado === 'completada');

// --- molestia ---
let m = await fetch(url+'/molestia', { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ zona:'Pie izquierdo' }) });
check('rechaza una zona que no esta en la lista', m.status===400);

const antesMsj = (await enviados()).length;
m = await fetch(url+'/molestia', { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ zona:'Cuello', comentario:'Me duele al final del dia' }) });
check('acepta la molestia', m.status===200);
let st = await estado();
check('queda guardada con zona y comentario',
  st.molestias?.[0]?.zona==='Cuello' && st.molestias[0].comentario==='Me duele al final del dia',
  JSON.stringify(st.molestias?.[0]));
check('confirma por WhatsApp', (await enviados()).length === antesMsj + 1,
  (await enviados()).at(-1)?.payload?.text?.body?.slice(0,40));

// comentario largo: se recorta a 200
await fetch(url+'/molestia', { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ zona:'Ojos', comentario:'x'.repeat(500) }) });
st = await estado();
check('recorta el comentario a 200 caracteres', st.molestias[0].comentario.length === 200,
  String(st.molestias[0].comentario.length));

// token vencido
check('molestia con token invalido -> 410',
  (await fetch(BASE+'/p/abc.def/molestia',{method:'POST',headers:{'content-type':'application/json'},body:'{"zona":"Ojos"}'})).status===410);

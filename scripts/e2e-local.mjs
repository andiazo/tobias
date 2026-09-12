import crypto from 'node:crypto';
const BASE='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8788';
const ADMIN='local-admin', SECRET='local-app-secret', TEL='573001112233';
const j = async (r) => ({ status: r.status, body: await r.text() });

const post = (path, body, auth=true) => fetch(BASE+'/admin'+path, {
  method:'POST',
  headers:{ 'content-type':'application/json', ...(auth?{authorization:`Bearer ${ADMIN}`}:{}) },
  body: JSON.stringify(body),
});

function webhook(mensaje){
  const payload = { object:'whatsapp_business_account', entry:[{ id:'1', changes:[{ field:'messages', value:{
    messaging_product:'whatsapp', metadata:{ display_phone_number:'1', phone_number_id:'123456' },
    contacts:[{ profile:{ name:'Prueba' }, wa_id:TEL }], messages:[mensaje] }}]}]};
  const raw = JSON.stringify(payload);
  const sig = 'sha256='+crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  return fetch(BASE+'/webhook/kapso', { method:'POST', headers:{'content-type':'application/json','x-hub-signature-256':sig}, body:raw });
}
const texto = (id, body) => ({ id, from:TEL, timestamp:'1', type:'text', text:{ body } });
const boton = (id, btnId, title) => ({ id, from:TEL, timestamp:'1', type:'interactive',
  interactive:{ type:'button_reply', button_reply:{ id:btnId, title } } });

const estado = async () => (await (await fetch(`${BASE}/admin/estado?telefono=%2B${TEL}`, { headers:{authorization:`Bearer ${ADMIN}`}})).json());
const enviados = async () => (await (await fetch(MOCK+'/__enviados')).json());
const pausa = (ms) => new Promise(r => setTimeout(r, ms));
const check = (nombre, ok, extra='') => console.log(`${ok?'PASS':'FAIL'}  ${nombre}${extra?' — '+extra:''}`);

// Base limpia: el suite se puede correr las veces que haga falta.
await fetch(BASE+'/admin/reset', { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${ADMIN}` }, body:'{"confirmar":"si"}' });

// 0. firma invalida se rechaza
const mala = await fetch(BASE+'/webhook/kapso', { method:'POST', headers:{'content-type':'application/json','x-hub-signature-256':'sha256=deadbeef'}, body:'{}' });
check('webhook rechaza firma invalida', mala.status===401, 'status '+mala.status);

// 0b. admin sin token
check('admin exige token', (await fetch(BASE+'/admin/estado?telefono=x')).status===401);

// 1. empresa
const emp = await (await post('/empresa', { nombre:'Empresa Piloto SAS', nit:'900123456' })).json();
check('crea empresa', !!emp.id, emp.id);
check('rechaza horario no multiplo de 15', (await post('/empresa', { nombre:'X', horarios:['10:07'] })).status===400);

// 2. el empleado escribe primero -> se registra, abre ventana, recibe opt-in
await webhook(texto('wamid.1','Hola'));
await pausa(600);
let st = await estado();
check('registra empleado desde mensaje entrante', !!st.empleado, st.empleado?.id);
check('abre ventana de 24h', st.empleado?.ventana_abierta === true);
let out = await enviados();
check('envia opt-in como mensaje libre interactivo', out.at(-1)?.payload?.type === 'interactive',
  out.at(-1)?.payload?.interactive?.action?.buttons?.map(b=>b.reply.title).join(' / '));

// 3. reintento del mismo wamid no duplica
const antes = (await enviados()).length;
await webhook(texto('wamid.1','Hola'));
await pausa(600);
check('idempotencia por wamid', (await enviados()).length === antes, `${antes} envios antes y despues`);

// 4. acepta el opt-in
await webhook(boton('wamid.2','optin_si','Si, participo'));
await pausa(600);
st = await estado();
check('registra consentimiento', !!st.empleado?.consentimiento_at, st.empleado?.consentimiento_at);

// 5. recordatorio manual
const rec = await (await post('/recordatorio', { telefono:'+'+TEL })).json();
check('envia recordatorio por canal libre', rec.canal === 'libre', JSON.stringify(rec));
out = await enviados();
const botones = out.at(-1)?.payload?.interactive?.action?.buttons ?? [];
check('recordatorio trae los 2 botones', botones.length === 2, botones.map(b=>b.reply.title).join(' / '));

// 6. "Hacer pausa" devuelve el link con token
await webhook(boton('wamid.3', botones[0].reply.id, 'Hacer pausa'));
await pausa(600);
out = await enviados();
const url = out.at(-1)?.payload?.interactive?.action?.parameters?.url;
check('responde con el link de la rutina', !!url && url.includes('/p/'), url);

// 7. el link abre, marca iniciada, y /done marca completada
const pagina = await fetch(url);
check('la pagina de la pausa abre', pagina.status === 200);
st = await estado();
check('pausa queda iniciada', st.pausas?.[0]?.estado === 'iniciada', st.pausas?.[0]?.estado);
const done = await fetch(url + '/done', { method:'POST' });
check('POST /done responde ok', done.status === 200);
st = await estado();
check('pausa queda completada', st.pausas?.[0]?.estado === 'completada', st.pausas?.[0]?.estado);

// 8. token invalido
check('token invalido -> 410', (await fetch(BASE+'/p/abc.def')).status === 410);

// 9. SALIR
await webhook(texto('wamid.4','SALIR'));
await pausa(600);
st = await estado();
check('SALIR da de baja', !!st.empleado?.baja_at, st.empleado?.baja_at);
check('recordatorio a un empleado de baja se rechaza', (await post('/recordatorio', { telefono:'+'+TEL, bloque:1 })).status === 409);

// M3 - el cron: horarios, dias habiles, idempotencia, canal y barrido.
import crypto from 'node:crypto';
const BASE='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8788';
const LLAVE = process.env.WEBHOOK_LLAVE || 'llave-local';
const ADMIN='local-admin', SECRET='local-app-secret';
const TEL='573009998877';

const post = (path, body) => fetch(BASE+'/admin'+path, {
  method:'POST',
  headers:{ 'content-type':'application/json', authorization:`Bearer ${ADMIN}` },
  body: JSON.stringify(body),
});
function webhook(mensaje){
  const payload = { object:'whatsapp_business_account', entry:[{ id:'1', changes:[{ field:'messages', value:{
    messaging_product:'whatsapp', metadata:{ phone_number_id:'123456' },
    contacts:[{ profile:{ name:'Ana' }, wa_id:TEL }], messages:[mensaje] }}]}]};
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
const tick = async (ahora) => (await (await post('/tick', { ahora })).json());

// Base limpia: el suite se puede correr las veces que haga falta.
await fetch(BASE+'/admin/reset', { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${ADMIN}` }, body:'{"confirmar":"si"}' });

// Bogota es UTC-5 todo el año. Fechas en el pasado, para poder probar el barrido.
const MIE_10 = '2026-09-09T15:00:00Z';  // miercoles 10:00
const MIE_1007 = '2026-09-09T15:07:00Z';
const MIE_11 = '2026-09-09T16:00:00Z';
const MIE_1430 = '2026-09-09T19:30:00Z';
const JUE_10 = '2026-09-10T15:00:00Z';
const SAB_10 = '2026-09-12T15:00:00Z';
const DOM_10 = '2026-09-13T15:00:00Z';

const emp = await (await post('/empresa', { nombre:'Cron SAS', horarios:['10:00','14:30'] })).json();
check('empresa con 2 horarios', !!emp.id);

await post('/empleado', { telefono:'+'+TEL, nombre:'Ana', empresaId:emp.id, enviarOptin:false });
await post('/consentimiento', { telefono:'+'+TEL });

// Sin ventana abierta y sin plantillas, el envio debe fallar de forma explicita.
let r = await tick(MIE_10);
check('sin ventana ni plantilla, el envio falla explicito', r.programadas===1 && r.fallidas===1, JSON.stringify(r));
// Nunca salio: sin enviada_at ni canal. (El barrido del mismo tick ya la
// cerro porque la fecha simulada esta en el pasado.)
const sinEnviar = (await estado()).pausas[0];
check('la pausa nunca se envio', !sinEnviar?.enviada_at && !sinEnviar?.canal_envio,
  `estado=${sinEnviar?.estado} canal=${sinEnviar?.canal_envio}`);

// Ana escribe primero: abre la ventana y acepta el opt-in.
await webhook(texto('cron.1','Hola')); await espera(500);
await webhook(boton('cron.2','optin_si')); await espera(500);
let st = await estado();
check('la ventana queda abierta', st.empleado?.ventana_abierta === true);
check('y el consentimiento registrado', !!st.empleado?.consentimiento_at);

// Jueves 10:00, ya con ventana abierta.
const antes = (await enviados()).length;
r = await tick(JUE_10);
check('el tick de las 10:00 programa y envia', r.programadas===1 && r.enviadas===1, JSON.stringify(r));
check('sale por WhatsApp', (await enviados()).length === antes + 1);
const ultimo = (await enviados()).at(-1);
check('con los 2 botones del recordatorio',
  ultimo?.payload?.interactive?.action?.buttons?.length === 2,
  ultimo?.payload?.interactive?.action?.buttons?.map(b=>b.reply.title).join(' / '));

r = await tick(JUE_10);
check('correr dos veces el mismo tick no duplica', r.programadas===0, JSON.stringify(r));
r = await tick('2026-09-10T15:07:00Z');
check('un cron que llega tarde cae en el mismo bloque', r.programadas===0);
r = await tick('2026-09-10T16:00:00Z');
check('un tick sin horario configurado no programa nada', r.programadas===0);
r = await tick('2026-09-10T19:30:00Z');
check('el tick de las 14:30 programa el bloque 1', r.programadas===1, JSON.stringify(r));

st = await estado();
const delJueves = st.pausas.filter(p=>p.fecha==='2026-09-10');
check('quedan 2 pausas ese dia, bloques 0 y 1',
  delJueves.length===2 && new Set(delJueves.map(p=>p.bloque)).size===2,
  delJueves.map(p=>`b${p.bloque}`).join(' '));

check('sabado no programa nada', (await tick(SAB_10)).programadas===0);
check('domingo no programa nada', (await tick(DOM_10)).programadas===0);

// Barrido: todas esas pausas quedaron con mas de 30 min sin tocar.
st = await estado();
check('el barrido cierra las vencidas como no_realizada',
  st.pausas.filter(p=>p.estado==='no_realizada').length === 3,
  st.pausas.map(p=>p.estado).join(' '));

// Un empleado sin consentimiento no entra al cron.
await post('/empleado', { telefono:'+573001234567', nombre:'Sin consentir', empresaId:emp.id, enviarOptin:false });
r = await tick('2026-09-11T15:00:00Z');
check('solo programa a quien dio consentimiento', r.programadas===1, JSON.stringify(r));

// Y quien se da de baja deja de recibir.
await webhook(texto('cron.3','SALIR')); await espera(500);
r = await tick('2026-09-11T19:30:00Z');
check('quien escribio SALIR ya no recibe', r.programadas===0, JSON.stringify(r));

// M7 - Envio por plantilla, cuando la ventana de 24 h esta cerrada.
// Necesita el worker con PLANTILLA_OPTIN y PLANTILLA_RECORDATORIO configuradas.
const BASE='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8788';
const ADMIN='local-admin';
const TEL='573002220001';

const post=(p,b)=>fetch(BASE+'/admin'+p,{method:'POST',
  headers:{'content-type':'application/json',authorization:`Bearer ${ADMIN}`},body:JSON.stringify(b)});
const enviados=async()=>(await(await fetch(MOCK+'/__enviados')).json());
const check=(n,ok,x='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);if(!ok)process.exitCode=1;};

// Sin las plantillas configuradas este suite no aplica: el worker manda por
// mensaje libre o falla explicito, que es lo que cubren los otros suites.
//   npx wrangler dev ... --var PLANTILLA_OPTIN:optin_programa_pausas \
//                        --var PLANTILLA_RECORDATORIO:recordatorio_pausa
await fetch(BASE+'/admin/reset',{method:'POST',headers:{'content-type':'application/json',
  authorization:`Bearer ${ADMIN}`},body:'{"confirmar":"si"}'});
await post('/empresa',{nombre:'Plantillas SAS',horarios:['10:00']});

// Empleado cargado por CSV: nunca escribio, asi que su ventana esta cerrada.
const alta = await (await post('/empleado',{telefono:'+'+TEL,nombre:'Diana Soto',area:'Cartera'})).json();
if (alta.optin?.canal !== 'plantilla') {
  console.error('Este suite necesita el worker con PLANTILLA_OPTIN y '
    + 'PLANTILLA_RECORDATORIO configuradas. Ver el encabezado del archivo.');
  process.exit(1);
}
check('el opt-in sale por plantilla', alta.optin?.canal === 'plantilla', JSON.stringify(alta.optin));

const optin = (await enviados()).at(-1).payload;
check('va como type=template', optin.type === 'template', optin.type);
check('con el nombre y el idioma correctos',
  optin.template?.name === 'optin_programa_pausas' && optin.template?.language?.code === 'es_CO',
  `${optin.template?.name} / ${optin.template?.language?.code}`);

const cuerpo = optin.template.components.find(c=>c.type==='body');
check('el cuerpo lleva nombre y empresa como variables',
  cuerpo?.parameters?.map(p=>p.text).join(' | ') === 'Diana Soto | Plantillas SAS',
  cuerpo?.parameters?.map(p=>p.text).join(' | '));

const bots = optin.template.components.filter(c=>c.type==='button');
check('manda un componente por boton', bots.length === 2, String(bots.length));
check('cada uno con su indice', bots.map(b=>b.index).join(',') === '0,1', bots.map(b=>b.index).join(','));
check('cada uno como quick_reply', bots.every(b=>b.sub_type==='quick_reply'),
  bots.map(b=>b.sub_type).join(','));
check('y con el payload que enruta la respuesta',
  bots.map(b=>b.parameters[0].payload).join(',') === 'optin_si,optin_no',
  bots.map(b=>b.parameters[0].payload).join(','));

// Recordatorio: el payload tiene que atar el boton a una pausa concreta.
await post('/consentimiento',{telefono:'+'+TEL});
const rec = await (await post('/recordatorio',{telefono:'+'+TEL})).json();
check('el recordatorio tambien sale por plantilla', rec.canal === 'plantilla', JSON.stringify(rec));

const recP = (await enviados()).at(-1).payload;
const bodyR = recP.template.components.find(c=>c.type==='body');
check('el cuerpo lleva nombre, hora y empresa',
  bodyR?.parameters?.length === 3, String(bodyR?.parameters?.length));
const botsR = recP.template.components.filter(c=>c.type==='button');
check('el payload ata el boton a la pausa',
  botsR[0].parameters[0].payload === 'pausa_hacer:'+rec.pausa,
  botsR[0].parameters[0].payload);
check('el payload cabe en el limite de Meta (128)',
  botsR[0].parameters[0].payload.length <= 128,
  botsR[0].parameters[0].payload.length + ' caracteres');

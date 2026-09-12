// M4 y M5 en un navegador real: pantalla de inicio, cronometro, celebracion,
// regla de duracion minima y flujo de molestia, a 390 px de ancho.
//   npm i -D playwright
//   CHROMIUM=<ruta> CAPTURAS=./capturas node scripts/e2e-navegador.mjs
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const BASE='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8788';
const LLAVE = process.env.WEBHOOK_LLAVE || 'llave-local';
const ADMIN='local-admin', SECRET='local-app-secret', TEL='573007778899';
const CAPT = process.env.CAPTURAS || null;
const captura = (page, n) => (CAPT ? page.screenshot({ path: `${CAPT}/${n}.png` }) : Promise.resolve());

const post=(p,b)=>fetch(BASE+'/admin'+p,{method:'POST',
  headers:{'content-type':'application/json',authorization:`Bearer ${ADMIN}`},body:JSON.stringify(b)});
function wh(m){const pl={object:'x',entry:[{id:'1',changes:[{field:'messages',value:{
  messaging_product:'whatsapp',metadata:{phone_number_id:'123456'},contacts:[{wa_id:TEL}],messages:[m]}}]}]};
 const raw=JSON.stringify(pl);
 return fetch(BASE+'/webhook/kapso?k='+LLAVE,{method:'POST',headers:{'content-type':'application/json',
   'x-hub-signature-256':'sha256='+crypto.createHmac('sha256',SECRET).update(raw).digest('hex')},body:raw});}
const t=(id,b)=>({id,from:TEL,timestamp:'1',type:'text',text:{body:b}});
const btn=(id,b)=>({id,from:TEL,timestamp:'1',type:'interactive',
  interactive:{type:'button_reply',button_reply:{id:b,title:'x'}}});
const env=async()=>(await(await fetch(MOCK+'/__enviados')).json());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(n,ok,x='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);if(!ok)process.exitCode=1;};
const estado=async()=>(await(await fetch(`${BASE}/admin/estado?telefono=%2B${TEL}`,
  {headers:{authorization:`Bearer ${ADMIN}`}})).json());

/** Manda un recordatorio y devuelve el link de la rutina. */
async function nuevaRutina(bloque){
  await post('/recordatorio',{telefono:'+'+TEL,bloque}); await sleep(250);
  const bs=(await env()).at(-1).payload.interactive.action.buttons;
  await wh(btn('nr.'+bloque, bs[0].reply.id)); await sleep(450);
  return (await env()).at(-1).payload.interactive.action.parameters.url;
}

await fetch(BASE+'/admin/reset',{method:'POST',headers:{'content-type':'application/json',
  authorization:`Bearer ${ADMIN}`},body:'{"confirmar":"si"}'});
await post('/empresa',{nombre:'Browser SAS'});
await wh(t('b.1','Hola')); await sleep(400);
await wh(btn('b.2','optin_si')); await sleep(400);

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
// Tamaño de un celular de gama media, que es donde se va a abrir de verdad.
const page = await (await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2})).newPage();
const errores=[]; page.on('pageerror',e=>errores.push(String(e)));

// ---------------------------------------------------------------- 1. inicio
await page.goto(await nuevaRutina(0), { waitUntil:'domcontentloaded' });
check('sin errores de JS', errores.length===0, errores.join(' | '));
check('abre en la pantalla de inicio', await page.isVisible('#empezar'));
check('anuncia ejercicios, tiempo y XP',
  (await page.textContent('.datos')).includes('6 ejercicios'),
  (await page.textContent('.datos')).replace(/\s+/g,' ').trim());
check('el sonido arranca apagado', (await page.textContent('#sonido')).includes('apagado'));
check('la rutina no arranca sola', await page.isHidden('#rutina'));
await captura(page, 'inicio');

// ------------------------------------------- 2. el atajo: saltarlo todo ya
await page.click('#empezar');
await page.waitForSelector('#rutina:not([hidden])');
for (let i=0;i<6;i++) await page.click('#saltar');
await page.waitForSelector('#final:not([hidden])');
await sleep(800);
check('saltandolo todo avisa que fue demasiado rapido',
  (await page.textContent('#tituloFinal')).includes('Casi'),
  await page.textContent('#tituloFinal'));
check('...y la pausa NO queda completada',
  (await estado()).pausas[0]?.estado !== 'completada', (await estado()).pausas[0]?.estado);
check('...ni reparte XP', (await page.textContent('#mXp'))==='0', await page.textContent('#mXp'));
await captura(page, 'pausa-casi');

// ------------------------------------------------- 3. la rutina de verdad
await page.goto(await nuevaRutina(1), { waitUntil:'domcontentloaded' });
await page.click('#empezar');
await page.waitForSelector('#rutina:not([hidden])');
check('arranca en el ejercicio 1',
  (await page.textContent('#paso')).includes('1 de 6'), await page.textContent('#paso'));
check('muestra la ilustracion', await page.isVisible('#lamina svg'));
const reloj1 = parseInt(await page.textContent('#num'));
await captura(page, 'pausa-1');

await sleep(3300);
const reloj2 = parseInt(await page.textContent('#num'));
check('el cronometro corre solo', reloj1 - reloj2 >= 2, `${reloj1} -> ${reloj2}`);
const anillo = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.getElementById('anillo')).strokeDashoffset));
check('el anillo de progreso avanza', anillo > 0, anillo.toFixed(1));

// El cronometro se detiene si el empleado se va de la pantalla.
await page.evaluate(() => {
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
  Object.defineProperty(document,'hidden',{value:true,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
});
const pausado1 = await page.textContent('#num');
await sleep(1600);
check('el cronometro se detiene si se va de la pantalla',
  (await page.textContent('#num'))===pausado1, `${pausado1} -> ${await page.textContent('#num')}`);
await page.evaluate(() => {
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
  Object.defineProperty(document,'hidden',{value:false,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(1400);
check('y sigue al volver', parseInt(await page.textContent('#num')) < parseInt(pausado1));

const ev = (await estado()).eventos.find(e=>e.tipo==='avance_pausa');
check('irse deja registrado hasta donde llego', !!ev, ev && JSON.parse(ev.payload).ejercicio);

await page.click('#saltar');
check('saltar pasa al ejercicio 2', (await page.textContent('#paso')).includes('2 de 6'));
for (let i=0;i<4;i++) { await page.click('#saltar'); await sleep(120); }
check('llega al ejercicio 6',
  (await page.textContent('#paso')).includes('6 de 6'), await page.textContent('#paso'));
await captura(page, 'pausa-6');

await page.click('#saltar');
await page.waitForSelector('#final:not([hidden])');
await sleep(900);
// Se saltaron todos los ejercicios aunque paso el tiempo: cuenta para el
// registro, pero la pantalla no lo celebra.
check('pasado el minimo cuenta, pero sin celebrarlo si se salto todo',
  (await page.textContent('#tituloFinal')).includes('registrada'),
  await page.textContent('#tituloFinal'));
check('y queda completada en la base',
  (await estado()).pausas.some(p=>p.estado==='completada'),
  (await estado()).pausas.map(p=>p.estado).join(' '));
check('el marcador muestra el tiempo real', /^\d+:\d\d$/.test(await page.textContent('#mTiempo')),
  await page.textContent('#mTiempo'));
await captura(page, 'pausa-final');

// ------------------------------------------------------------ 4. molestia
await page.click('#molestia');
await page.waitForSelector('#formMolestia:not([hidden])');
check('el boton de enviar arranca deshabilitado', await page.isDisabled('#enviar'));
await page.click('button[data-zona="Hombros"]');
check('elegir zona habilita enviar', !(await page.isDisabled('#enviar')));
await page.fill('#comentario','Cargo cajas en la manana');
check('el contador de caracteres funciona', (await page.textContent('#cuenta'))==='24',
  await page.textContent('#cuenta'));
await captura(page, 'molestia');
await page.click('#enviar');
await page.waitForSelector('#gracias:not([hidden])');
check('confirma en pantalla', await page.isVisible('#gracias'));
await sleep(700);
check('la molestia queda en la base', (await estado()).molestias?.[0]?.zona==='Hombros',
  JSON.stringify((await estado()).molestias?.[0]));

// ------------------------------------------------------------ 5. pantalla
const desborde = await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth+1);
check('no hay scroll horizontal a 390px', !desborde);
check('sin errores de JS en toda la sesion', errores.length===0, errores.join(' | '));

await browser.close();

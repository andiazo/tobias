// M4 y M5 en un navegador real: cronometro, avance automatico y flujo de
// molestia, a 390px de ancho. Necesita playwright:  npm i -D playwright
// Capturas opcionales:  CAPTURAS=./capturas node scripts/e2e-navegador.mjs
import { chromium } from 'playwright';
import crypto from 'node:crypto';
const BASE='http://127.0.0.1:8787', MOCK='http://127.0.0.1:8788';
const ADMIN='local-admin', SECRET='local-app-secret', TEL='573007778899';
// Las capturas son opcionales: solo se escriben si se pide un directorio.
const SD = process.env.CAPTURAS || null;
const captura = (page, nombre) => (SD ? page.screenshot({ path: `${SD}/${nombre}.png` }) : Promise.resolve());
const post = (p,b)=>fetch(BASE+'/admin'+p,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${ADMIN}`},body:JSON.stringify(b)});
function wh(m){const pl={object:'x',entry:[{id:'1',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'123456'},contacts:[{wa_id:TEL}],messages:[m]}}]}]};
 const raw=JSON.stringify(pl);return fetch(BASE+'/webhook/kapso',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+crypto.createHmac('sha256',SECRET).update(raw).digest('hex')},body:raw});}
const t=(id,b)=>({id,from:TEL,timestamp:'1',type:'text',text:{body:b}});
const btn=(id,b)=>({id,from:TEL,timestamp:'1',type:'interactive',interactive:{type:'button_reply',button_reply:{id:b,title:'x'}}});
const env=async()=>(await(await fetch(MOCK+'/__enviados')).json());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(n,ok,x='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);if(!ok)process.exitCode=1;};

await fetch(BASE+'/admin/reset',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${ADMIN}`},body:'{"confirmar":"si"}'});
await post('/empresa',{nombre:'Browser SAS'});
await wh(t('b.1','Hola')); await sleep(400);
await wh(btn('b.2','optin_si')); await sleep(400);
await post('/recordatorio',{telefono:'+'+TEL}); await sleep(200);
const bs=(await env()).at(-1).payload.interactive.action.buttons;
await wh(btn('b.3',bs[0].reply.id)); await sleep(500);
const url=(await env()).at(-1).payload.interactive.action.parameters.url;

const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
// Tamaño de un celular de gama media, que es donde se va a abrir de verdad.
const page = await (await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 })).newPage();
const errores=[]; page.on('pageerror',e=>errores.push(String(e)));
await page.goto(url, { waitUntil:'domcontentloaded' });

check('sin errores de JS', errores.length===0, errores.join(' | '));
check('arranca en el ejercicio 1', (await page.textContent('#paso')).includes('1 de 6'), await page.textContent('#paso'));
check('muestra la ilustracion', await page.isVisible('#lamina svg'));
const reloj1 = await page.textContent('#num');
await captura(page, 'pausa-1');

// El cronometro avanza solo.
await sleep(3200);
const reloj2 = await page.textContent('#num');
check('el cronometro corre solo', parseInt(reloj1) - parseInt(reloj2) >= 2, `${reloj1} -> ${reloj2}`);
check('la barra de progreso avanza', parseFloat(await page.getAttribute('#pista','style').then(s=>s.match(/[\d.]+/)[0])) > 0);

// Avance automatico al terminar los 30 s: acelero saltando.
await page.click('#saltar');
check('saltar pasa al ejercicio 2', (await page.textContent('#paso')).includes('2 de 6'));

// El resto de los ejercicios.
for (let i=0;i<4;i++) await page.click('#saltar');
check('llega al ejercicio 6', (await page.textContent('#paso')).includes('6 de 6'), await page.textContent('#paso'));
await captura(page, 'pausa-6');

// Al terminar el ultimo: pantalla final y pausa completada en la base.
await page.click('#saltar');
await page.waitForSelector('#final:not([hidden])');
check('muestra la pantalla final', await page.isVisible('#listo'));
await sleep(700);
const st=await(await fetch(`${BASE}/admin/estado?telefono=%2B${TEL}`,{headers:{authorization:`Bearer ${ADMIN}`}})).json();
check('la pausa queda completada en la base', st.pausas[0].estado==='completada', st.pausas[0].estado);
await captura(page, 'pausa-final');

// Flujo de molestia, tocando la pantalla como el empleado.
await page.click('#molestia');
await page.waitForSelector('#formMolestia:not([hidden])');
check('el boton de enviar arranca deshabilitado', await page.isDisabled('#enviar'));
await page.click('button[data-zona="Hombros"]');
check('elegir zona habilita enviar', !(await page.isDisabled('#enviar')));
await page.fill('#comentario','Cargo cajas en la manana');
check('el contador de caracteres funciona', (await page.textContent('#cuenta'))==='24', await page.textContent('#cuenta'));
await captura(page, 'molestia');
await page.click('#enviar');
await page.waitForSelector('#gracias:not([hidden])');
check('confirma en pantalla', await page.isVisible('#gracias'));
await sleep(700);
const st2=await(await fetch(`${BASE}/admin/estado?telefono=%2B${TEL}`,{headers:{authorization:`Bearer ${ADMIN}`}})).json();
check('la molestia queda en la base', st2.molestias[0]?.zona==='Hombros', JSON.stringify(st2.molestias[0]));

// No hay scroll horizontal en pantalla de celular.
const desborde = await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth+1);
check('no hay scroll horizontal a 390px', !desborde);

await browser.close();

// M6 - el reporte de evidencia para SST y el CSV.
import crypto from 'node:crypto';
const BASE='http://127.0.0.1:8787';
const LLAVE = process.env.WEBHOOK_LLAVE || 'llave-local';
const ADMIN='local-admin', SECRET='local-app-secret';

const post = (p,b) => fetch(BASE+'/admin'+p,{method:'POST',
  headers:{'content-type':'application/json',authorization:`Bearer ${ADMIN}`},body:JSON.stringify(b)});
function wh(tel, mensaje){
  const pl={object:'x',entry:[{id:'1',changes:[{field:'messages',value:{messaging_product:'whatsapp',
    metadata:{phone_number_id:'123456'},contacts:[{wa_id:tel}],messages:[mensaje]}}]}]};
  const raw=JSON.stringify(pl);
  return fetch(BASE+'/webhook/kapso?k='+LLAVE,{method:'POST',headers:{'content-type':'application/json',
    'x-hub-signature-256':'sha256='+crypto.createHmac('sha256',SECRET).update(raw).digest('hex')},body:raw});
}
const txt=(tel,id,b)=>wh(tel,{id,from:tel,timestamp:'1',type:'text',text:{body:b}});
const btn=(tel,id,b)=>wh(tel,{id,from:tel,timestamp:'1',type:'interactive',
  interactive:{type:'button_reply',button_reply:{id:b,title:'x'}}});
const espera=ms=>new Promise(r=>setTimeout(r,ms));
const check=(n,ok,x='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);if(!ok)process.exitCode=1;};

await fetch(BASE+'/admin/reset',{method:'POST',headers:{'content-type':'application/json',
  authorization:`Bearer ${ADMIN}`},body:'{"confirmar":"si"}'});

const emp = await (await post('/empresa',{nombre:'Textiles del Norte SAS',nit:'900123456-7',
  horarios:['10:00','14:30']})).json();
const REP = BASE + emp.reporte;
check('crear empresa devuelve el link del reporte', !!emp.reporte, emp.reporte);

// Tres empleados con perfiles distintos de adherencia.
const A='573001110001', B='573001110002', C='573001110003';
for (const [tel,nombre,area] of [[A,'Ana Ruiz','Contabilidad'],[B,'Beto Páez','Operaciones'],[C,'Caro Lima','Contabilidad']]) {
  await post('/empleado',{telefono:'+'+tel,nombre,area,empresaId:emp.id,enviarOptin:false});
  await post('/consentimiento',{telefono:'+'+tel});
  await txt(tel,'r.'+tel,'Hola'); await espera(250);   // abre la ventana de 24 h
}
// Un cuarto cargado que nunca acepta: cuenta en el denominador de participación.
await post('/empleado',{telefono:'+573001110004',nombre:'Dani Sin Responder',empresaId:emp.id,enviarOptin:false});

// Dos días de pausas.
for (const t of ['2026-09-09T15:00:00Z','2026-09-09T19:30:00Z','2026-09-10T15:00:00Z'])
  await post('/tick',{ahora:t});

const estado = async (tel)=> (await (await fetch(`${BASE}/admin/estado?telefono=%2B${tel}`,
  {headers:{authorization:`Bearer ${ADMIN}`}})).json());

// Ana: toca el botón y completa la rutina en 2 de 3.
// Beto: toca el botón pero nunca termina (la brecha que el reporte debe mostrar).
// Caro: no toca nada.
let hechas = 0;
for (const [tel, completar] of [[A,2],[B,0]]) {
  const pausas = (await estado(tel)).pausas;
  for (let i=0;i<pausas.length;i++) {
    await btn(tel,`hz.${tel}.${i}`,`pausa_hacer:${pausas[i].id}`); await espera(250);
    if (i < completar) {
      const st = await estado(tel);
      const ev = st.eventos.find(e=>e.tipo==='entrante');
      // El link llega por WhatsApp; aquí lo reconstruimos desde el mock.
      const env = await (await fetch('http://127.0.0.1:8788/__enviados')).json();
      const url = env.at(-1)?.payload?.interactive?.action?.parameters?.url;
      if (url) {
        await fetch(url);
        // El servidor no acepta una pausa despachada en segundos.
        await espera(3200);
        const d = await (await fetch(url+'/done',{method:'POST'})).json();
        if (d.ok) hechas++;
      }
    }
  }
}
check('se completaron 2 pausas con cronómetro', hechas===2, String(hechas));

// Una pausa mas, fuera del cron, con molestia reportada al final.
await post('/recordatorio',{telefono:'+'+A,bloque:2}); await espera(250);
const bsA = (await (await fetch('http://127.0.0.1:8788/__enviados')).json())
  .at(-1).payload.interactive.action.buttons;
await btn(A,'mol.1',bsA[0].reply.id); await espera(300);
const urlMol = (await (await fetch('http://127.0.0.1:8788/__enviados')).json())
  .at(-1).payload.interactive.action.parameters.url;
await fetch(urlMol);
await espera(3200);
await fetch(urlMol+'/done',{method:'POST'});
const mol = await fetch(urlMol+'/molestia',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({zona:'Espalda baja',comentario:'Silla sin apoyo lumbar'})});
check('la molestia queda registrada', mol.status===200);
await espera(300);

// Ergonomía
await post('/ergonomia',{empresaId:emp.id,url:'https://forms.gle/ejemplo',enviados:3,respuestas:2});

// --- el reporte ---
const r = await fetch(REP);
const h = await r.text();
check('el reporte abre sin login', r.status===200);
check('se cachea 60 s', (r.headers.get('cache-control')||'').includes('max-age=60'));
check('no se indexa', (r.headers.get('x-robots-tag')||'').includes('noindex'));
check('trae el nombre y el NIT', h.includes('Textiles del Norte SAS') && h.includes('900123456-7'));
check('trae el rango de fechas', h.includes('2026-09-09') && h.includes('2026-09-10'));
check('trae la fecha de generación', h.includes('Generado el'));
check('participación: 3 de 4 inscritos', h.includes('3 de 4'), (h.match(/\d+ de \d+/g)||[]).join(' '));
check('separa confirmadas de completadas',
  h.includes('Completadas con cronómetro') && h.includes('Confirmadas por el empleado'));
check('muestra la brecha en puntos', /\d+ pts/.test(h), (h.match(/\d+ pts/)||[])[0]);
check('lista los empleados', h.includes('Ana Ruiz') && h.includes('Beto Páez') && h.includes('Caro Lima'));
check('no lista al que nunca aceptó', !h.includes('Dani Sin Responder'));
// Caro (0%) y Beto (0%) deben salir antes que Ana.
check('ordena de menor a mayor adherencia',
  Math.min(h.indexOf('Caro Lima'), h.indexOf('Beto Páez')) < h.indexOf('Ana Ruiz'),
  `Caro=${h.indexOf('Caro Lima')} Beto=${h.indexOf('Beto Páez')} Ana=${h.indexOf('Ana Ruiz')}`);
check('muestra el bloque de ergonomía con el link',
  h.includes('2 de 3') && h.includes('https://forms.gle/ejemplo'));
check('lista la molestia con zona y comentario',
  h.includes('Espalda baja') && h.includes('Silla sin apoyo lumbar') && h.includes('Ana Ruiz'));
check('ofrece la descarga del CSV', h.includes('Descargar evidencia (CSV)'));
check('tiene estilos de impresión', h.includes('@media print'));

// --- el CSV ---
const csvR = await fetch(REP+'/export.csv');
// fetch() descarta el BOM al decodificar, asi que hay que mirar los bytes.
const bytes = new Uint8Array(await csvR.clone().arrayBuffer());
const csv = await csvR.text();
check('el CSV responde 200', csvR.status===200);
check('se descarga como archivo',
  (csvR.headers.get('content-disposition')||'').includes('attachment'),
  csvR.headers.get('content-disposition'));
check('lleva BOM para Excel', bytes[0]===0xEF && bytes[1]===0xBB && bytes[2]===0xBF,
  [...bytes.slice(0,3)].map(b=>b.toString(16)).join(' '));
const lineas = csv.trim().split('\r\n');
check('la cabecera trae las columnas del PRD',
  ['empleado','cedula','fecha','hora_programada','hora_completada','duracion_segundos','estado']
    .every(c=>lineas[0].includes(c)), lineas[0]);
// 3 empleados x 3 ticks + la pausa suelta del recordatorio manual.
check('una fila por pausa programada', lineas.length-1 === 10, `${lineas.length-1} filas`);
check('registra una duración en las completadas',
  lineas.slice(1).some(l=>/,"\d+","completada"/.test(l)),
  lineas.slice(1).find(l=>l.includes('completada'))?.slice(0,90));
check('las horas van en hora local', /"0[45]:00"|"10:00"/.test(csv));

// --- seguridad del token ---
check('un token inventado da 404', (await fetch(BASE+'/r/noexiste')).status===404);
check('el CSV con token inventado da 404', (await fetch(BASE+'/r/noexiste/export.csv')).status===404);

// --- filtro de fechas ---
const soloUnDia = await (await fetch(REP+'/export.csv?desde=2026-09-10&hasta=2026-09-10')).text();
check('el rango filtra el CSV', soloUnDia.trim().split('\r\n').length-1 === 3,
  `${soloUnDia.trim().split('\r\n').length-1} filas`);

// --- frontera de zona horaria ---
// Una molestia reportada de noche en Bogota cae en el dia UTC siguiente.
// El reporte debe seguir contandola en su dia local.
const hoyBogota = new Date(Date.now() - 5*3600*1000).toISOString().slice(0,10);
const rHoy = await fetch(`${REP}?desde=${hoyBogota}&hasta=${hoyBogota}`);
const hHoy = await rHoy.text();
check('la molestia de la noche aparece en su dia local',
  hHoy.includes('Espalda baja'), `dia local ${hoyBogota}`);

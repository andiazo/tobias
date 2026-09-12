// M4 - La rutina guiada. HTML server-rendered desde el mismo Worker, sin build
// de frontend y sin framework: se abre en el navegador embebido de WhatsApp, en
// pantalla pequena y con una sola mano.
//
// El tono es de juego (progreso visible, celebracion, XP) porque el empleado no
// esta aqui por cumplimiento normativo: le duele el cuello. Lo que NO hay son
// rachas entre dias ni ranking entre companeros, que es lo que el PRD excluye
// por contaminar la medicion de adherencia del piloto.
import type { Env } from "../env";
import {
  empleadoPorId,
  marcarPausaCompletada,
  marcarPausaIniciada,
  pausaPorId,
  registrarEvento,
  registrarMolestia,
} from "../db/queries";
import { verificarToken } from "../lib/tokens";
import { EJERCICIOS, SEGUNDOS_TOTALES, ZONAS_MOLESTIA } from "../content/ejercicios";
import { enviarTexto } from "../whatsapp/mensajes";

const MINIMO_POR_DEFECTO = 120;

const segundosMinimos = (env: Env): number => {
  const n = Number(env.SEGUNDOS_MINIMOS_PAUSA);
  return Number.isFinite(n) && n >= 0 ? n : MINIMO_POR_DEFECTO;
};

export async function abrirPausa(env: Env, token: string): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) {
    return html(paginaError("Este link ya venció", "Te llega uno nuevo en tu próxima pausa."), 410);
  }

  const pausa = await pausaPorId(env, payload.p);
  if (!pausa) return html(paginaError("No encontramos esta pausa", ""), 404);

  await marcarPausaIniciada(env, pausa.id);
  return html(paginaRutina(token));
}

/**
 * Marca la pausa completada, pero solo si de verdad paso el tiempo: el cliente
 * no es confiable y saltar los seis ejercicios en tres toques no puede valer
 * como evidencia. La regla vive en el servidor a proposito.
 */
export async function completarPausa(env: Env, token: string, req: Request): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return Response.json({ ok: false, error: "token invalido" }, { status: 410 });

  const pausa = await pausaPorId(env, payload.p);
  if (!pausa) return Response.json({ ok: false, error: "pausa no encontrada" }, { status: 404 });

  type Reporte = { saltados?: number; segundos?: number };
  const reporte: Reporte = await req.json<Reporte>().catch(() => ({}) as Reporte);

  const minimo = segundosMinimos(env);
  const transcurridos = pausa.iniciada_at
    ? Math.floor((Date.now() - Date.parse(pausa.iniciada_at)) / 1000)
    : 0;

  if (transcurridos < minimo) {
    await registrarEvento(env, "pausa_demasiado_rapida", pausa.empleado_id, {
      pausa: pausa.id,
      transcurridos,
      minimo,
    });
    return Response.json({ ok: false, motivo: "muy_rapido", transcurridos, minimo });
  }

  await marcarPausaCompletada(env, pausa.id);
  // Lo reporta el cliente, asi que no decide el estado; sirve para saber
  // cuanta gente se salta ejercicios sin tener que adivinarlo.
  await registrarEvento(env, "pausa_completada", pausa.empleado_id, {
    pausa: pausa.id,
    transcurridos,
    saltados: reporte.saltados ?? null,
  });
  return Response.json({ ok: true, transcurridos });
}

/** navigator.sendBeacon al cerrar: registra hasta donde llego. */
export async function registrarAvance(env: Env, token: string, req: Request): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return new Response(null, { status: 204 });

  let ejercicio: unknown = null;
  try {
    ejercicio = (JSON.parse(await req.text()) as { ejercicio?: unknown }).ejercicio ?? null;
  } catch {
    /* el beacon puede llegar vacio */
  }
  const pausa = await pausaPorId(env, payload.p);
  if (pausa) {
    await registrarEvento(env, "avance_pausa", pausa.empleado_id, { pausa: pausa.id, ejercicio });
  }
  return new Response(null, { status: 204 });
}

/** M5 - reporte de molestia al final de la rutina. */
export async function reportarMolestia(env: Env, token: string, req: Request): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return Response.json({ ok: false, error: "token invalido" }, { status: 410 });

  const pausa = await pausaPorId(env, payload.p);
  if (!pausa) return Response.json({ ok: false, error: "pausa no encontrada" }, { status: 404 });

  type Cuerpo = { zona?: string; comentario?: string };
  const body: Cuerpo = await req.json<Cuerpo>().catch(() => ({}) as Cuerpo);
  const zona = typeof body.zona === "string" ? body.zona.trim() : "";
  if (!ZONAS_MOLESTIA.includes(zona as (typeof ZONAS_MOLESTIA)[number])) {
    return Response.json({ ok: false, error: "zona invalida" }, { status: 400 });
  }

  await registrarMolestia(env, {
    empleadoId: pausa.empleado_id,
    pausaId: pausa.id,
    zona,
    comentario: typeof body.comentario === "string" ? body.comentario : null,
  });

  // Confirmacion de vuelta por WhatsApp. Si falla, la molestia ya quedo guardada.
  const empleado = await empleadoPorId(env, pausa.empleado_id);
  if (empleado) {
    try {
      await enviarTexto(
        env,
        empleado.telefono_e164,
        `Gracias, registramos tu molestia en ${zona.toLowerCase()}. ` +
          `El área de SST la ve en el reporte. Si el dolor sigue o aumenta, consúltalo con ellos.`,
      );
    } catch (error) {
      console.error("no se pudo confirmar la molestia por WhatsApp", error);
      await registrarEvento(env, "error_confirmacion_molestia", empleado.id, {
        error: String(error),
      });
    }
  }

  return Response.json({ ok: true });
}

// --- HTML ------------------------------------------------------------------

const html = (cuerpo: string, status = 200): Response =>
  new Response(cuerpo, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** El personaje del programa. `animo` cambia la cara y los brazos. */
const mascota = (animo: "saluda" | "celebra" | "calma"): string => `
<svg class="bicho bicho--${animo}" viewBox="0 0 164 160" aria-hidden="true">
  <ellipse cx="80" cy="146" rx="40" ry="7" fill="rgba(0,0,0,.07)"/>
  <g class="bicho-brazo">
    <path d="M44 86 ${animo === "celebra" ? "Q22 70 14 46" : "Q24 98 12 110"}"
      stroke="var(--verde-oscuro)" stroke-width="13" stroke-linecap="round" fill="none"/>
    <circle cx="${animo === "celebra" ? 14 : 12}" cy="${animo === "celebra" ? 46 : 110}" r="9"
      fill="var(--verde-oscuro)"/>
  </g>
  <g class="bicho-brazo">
    <path d="M116 86 ${animo === "celebra" ? "Q138 70 146 46" : "Q136 98 148 110"}"
      stroke="var(--verde-oscuro)" stroke-width="13" stroke-linecap="round" fill="none"/>
    <circle cx="${animo === "celebra" ? 146 : 148}" cy="${animo === "celebra" ? 46 : 110}" r="9"
      fill="var(--verde-oscuro)"/>
  </g>
  <path d="M30 74 C30 40 52 22 80 22 C108 22 130 40 130 74 L130 104
           C130 128 108 142 80 142 C52 142 30 128 30 104 Z" fill="var(--verde)"/>
  <path d="M30 74 C30 40 52 22 80 22 C108 22 130 40 130 74 L130 82
           C130 96 108 104 80 104 C52 104 30 96 30 82 Z" fill="var(--verde-claro)"/>
  <circle cx="60" cy="70" r="15" fill="#fff"/>
  <circle cx="100" cy="70" r="15" fill="#fff"/>
  <circle class="bicho-ojo" cx="${animo === "celebra" ? 62 : 61}" cy="72" r="7" fill="#38414d"/>
  <circle class="bicho-ojo" cx="${animo === "celebra" ? 102 : 101}" cy="72" r="7" fill="#38414d"/>
  <circle cx="64" cy="69" r="2.5" fill="#fff"/>
  <circle cx="104" cy="69" r="2.5" fill="#fff"/>
  ${
    animo === "celebra"
      ? `<path d="M66 98 Q80 116 94 98 Z" fill="#38414d"/>
         <path d="M68 104 Q80 112 92 104" fill="#ff8fa3"/>`
      : `<path d="M68 100 Q80 110 92 100" stroke="#38414d" stroke-width="5"
           stroke-linecap="round" fill="none"/>`
  }
  <circle cx="44" cy="92" r="7" fill="#ff9db0" opacity=".55"/>
  <circle cx="116" cy="92" r="7" fill="#ff9db0" opacity=".55"/>
</svg>`;

const ESTILOS = `
:root{
  --verde:#5cc22e; --verde-claro:#78d84c; --verde-oscuro:#45991f;
  --azul:#2ba8e8; --azul-oscuro:#1d86bd;
  --amarillo:#ffc400; --morado:#c078ff; --rojo:#ff5252;
  --texto:#3b4250; --suave:#8a93a3; --linea:#e6e9ef; --fondo:#fff; --panel:#f6f8fb;
  --fuente:"Nunito","Nunito Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{margin:0;background:var(--fondo);color:var(--texto);font:600 16px/1.5 var(--fuente);
  overscroll-behavior:none;-webkit-font-smoothing:antialiased}
main{max-width:460px;margin:0 auto;min-height:100dvh;display:flex;flex-direction:column;
  padding:14px 18px calc(18px + env(safe-area-inset-bottom))}
section{flex:1;display:flex;flex-direction:column}
.centro{flex:1;display:flex;flex-direction:column;justify-content:center}
[hidden]{display:none!important}

h1{font-size:26px;font-weight:900;line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}
h2{font-size:21px;font-weight:900;margin:0 0 6px}
p{margin:0 0 16px;color:var(--suave);font-weight:600}

/* --- botones con relieve --- */
.btn{display:block;width:100%;border:0;border-radius:16px;padding:16px;cursor:pointer;
  font:900 16px/1 var(--fuente);letter-spacing:.05em;text-transform:uppercase;color:#fff;
  background:var(--verde);box-shadow:0 4px 0 var(--verde-oscuro);transition:transform .06s,box-shadow .06s}
.btn:active:not(:disabled){transform:translateY(4px);box-shadow:0 0 0 var(--verde-oscuro)}
.btn:disabled{background:var(--linea);color:#b3bac6;box-shadow:0 4px 0 #d5dae3;cursor:default}
.btn--azul{background:var(--azul);box-shadow:0 4px 0 var(--azul-oscuro)}
.btn--azul:active:not(:disabled){box-shadow:0 0 0 var(--azul-oscuro)}
.btn--hueco{background:#fff;color:var(--suave);border:2px solid var(--linea);
  box-shadow:0 4px 0 var(--linea)}
.btn--hueco:active{box-shadow:0 0 0 var(--linea)}
.enlace{display:block;width:100%;background:none;border:0;color:var(--suave);cursor:pointer;
  font:800 14px/1 var(--fuente);letter-spacing:.05em;text-transform:uppercase;padding:14px}
.acciones{margin-top:auto;padding-top:18px;display:grid;gap:10px}

/* --- personaje --- */
.bicho{width:150px;height:150px;display:block;margin:0 auto}
.bicho--saluda{animation:flotar 2.6s ease-in-out infinite}
.bicho--celebra{animation:brincar .6s cubic-bezier(.3,1.5,.5,1) 2}
@keyframes flotar{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes brincar{0%,100%{transform:translateY(0) scale(1)}
  40%{transform:translateY(-20px) scale(1.05)}}

/* --- inicio --- */
#inicio,#final,#gracias{text-align:center}
.dato{display:inline-flex;align-items:center;gap:7px;background:var(--panel);
  border-radius:999px;padding:8px 15px;font-weight:800;font-size:14px;color:var(--texto)}
.datos{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:4px 0 22px}

/* --- barra de progreso --- */
.hud{display:flex;align-items:center;gap:11px;margin-bottom:20px}
.barra{flex:1;display:flex;gap:4px}
.barra span{flex:1;height:11px;border-radius:6px;background:var(--linea);overflow:hidden;
  position:relative}
.barra span::after{content:"";position:absolute;inset:0;border-radius:6px;background:var(--verde);
  transform:scaleX(0);transform-origin:left;transition:transform .45s cubic-bezier(.3,1.3,.5,1)}
.barra span.hecho::after{transform:scaleX(1)}
.barra span.activo{background:#dbe1ea}
.icono{background:none;border:0;padding:6px;cursor:pointer;font-size:19px;line-height:1;
  color:var(--suave);border-radius:10px}
.racha{display:flex;align-items:center;gap:4px;font-weight:900;color:var(--amarillo);font-size:15px}
.racha.oculta{opacity:0;transform:scale(.7)}
.racha{transition:opacity .3s,transform .3s}

/* --- ejercicio --- */
.paso{font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;
  color:var(--verde);margin-bottom:5px}
.instruccion{font-size:17px;color:var(--suave);margin:0 0 16px;font-weight:600}
.lamina{background:var(--panel);border-radius:22px;padding:12px;display:flex;
  align-items:center;justify-content:center;margin:0 auto 16px;width:100%;
  aspect-ratio:9/7;max-height:34dvh}
.lamina svg{height:100%;width:auto;max-width:100%;color:var(--verde-oscuro)}
.tarjeta-entra{animation:entrar .32s cubic-bezier(.2,1.2,.4,1)}
@keyframes entrar{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}

/* --- cronometro --- */
.reloj{position:relative;width:118px;height:118px;margin:auto auto 4px}
.reloj svg{width:100%;height:100%;transform:rotate(-90deg)}
.reloj circle{fill:none;stroke-width:11;stroke-linecap:round}
.reloj .pista{stroke:var(--linea)}
.reloj .avance{stroke:var(--verde);transition:stroke .3s}
.reloj.poco .avance{stroke:var(--amarillo)}
.num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:34px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.num.late{animation:latir .5s ease}
@keyframes latir{0%,100%{transform:scale(1)}45%{transform:scale(1.16)}}

/* --- celebracion entre ejercicios --- */
#aplauso{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.93);z-index:20;pointer-events:none}
.grito{font-size:38px;font-weight:900;color:var(--verde);letter-spacing:-.02em;
  animation:brincar .5s cubic-bezier(.3,1.6,.5,1)}
.xp{position:absolute;font-size:19px;font-weight:900;color:var(--amarillo);
  animation:subir .9s ease-out forwards}
@keyframes subir{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-52px)}}
.papel{position:fixed;top:-14px;width:9px;height:14px;border-radius:2px;z-index:19;
  pointer-events:none;animation:caer linear forwards}
@keyframes caer{to{transform:translateY(105dvh) rotate(620deg);opacity:.15}}

/* --- final --- */
.marcadores{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:18px 0 6px}
.marcador{background:var(--panel);border-radius:16px;padding:13px 6px}
.marcador b{display:block;font-size:23px;font-weight:900;line-height:1.1}
.marcador span{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--suave)}
.marcador--xp b{color:var(--amarillo)}
.marcador--tiempo b{color:var(--azul)}
.marcador--ej b{color:var(--verde)}

/* --- molestia --- */
.zonas{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.zonas button{padding:17px 8px;border-radius:16px;background:#fff;border:2px solid var(--linea);
  box-shadow:0 4px 0 var(--linea);color:var(--texto);font:800 15px/1.2 var(--fuente);cursor:pointer;
  transition:transform .06s,box-shadow .06s}
.zonas button:active{transform:translateY(4px);box-shadow:none}
.zonas button[aria-pressed=true]{border-color:var(--azul);background:#eaf7fe;color:var(--azul-oscuro);
  box-shadow:0 4px 0 var(--azul)}
textarea{width:100%;min-height:86px;padding:14px;border-radius:16px;background:#fff;
  border:2px solid var(--linea);color:var(--texto);font:600 15px/1.45 var(--fuente);resize:vertical}
textarea:focus{outline:0;border-color:var(--azul)}
.cuenta{font-size:12px;font-weight:800;color:var(--suave);text-align:right;margin:6px 0 12px}

@media (prefers-reduced-motion:reduce){
  *{animation:none!important;transition:none!important}
}
@media (max-height:620px){
  .bicho{width:112px;height:112px}h1{font-size:22px}.reloj{width:96px;height:96px}
  .num{font-size:28px}
}
`;

const paginaError = (titulo: string, detalle: string): string =>
  `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Pausa activa</title><style>${ESTILOS}</style>
<main><section id="inicio"><div class="centro">${mascota("calma")}
<h1>${esc(titulo)}</h1><p>${esc(detalle)}</p></div></section></main>`;

function paginaRutina(token: string): string {
  const datos = EJERCICIOS.map((e) => ({
    zona: e.zona,
    nombre: e.nombre,
    instruccion: e.instruccion,
    segundos: e.segundos,
    svg: e.svg,
  }));
  const minutos = Math.round(SEGUNDOS_TOTALES / 60);

  return `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Tu pausa activa</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;800;900&display=swap">
<style>${ESTILOS}</style>
<main>

<section id="inicio">
  <div class="centro">
    ${mascota("saluda")}
    <h1>¡Hora de moverte!</h1>
    <p>Tres minutos y vuelves a lo tuyo.</p>
    <div class="datos">
      <span class="dato">🧩 ${EJERCICIOS.length} ejercicios</span>
      <span class="dato">⏱️ ${minutos} minutos</span>
      <span class="dato">⭐ ${EJERCICIOS.length * 10} XP</span>
    </div>
  </div>
  <div class="acciones">
    <button class="btn" id="empezar">¡Empezar!</button>
    <button class="enlace" id="sonido">🔇 Sonido apagado</button>
  </div>
</section>

<section id="rutina" hidden>
  <div class="hud">
    <div class="barra" id="barra">${EJERCICIOS.map(() => "<span></span>").join("")}</div>
    <div class="racha oculta" id="racha">🔥<b id="rachaN">0</b></div>
    <button class="icono" id="silenciar" aria-label="Sonido">🔇</button>
  </div>
  <div class="paso" id="paso"></div>
  <h1 id="nombre"></h1>
  <p class="instruccion" id="instruccion"></p>
  <div class="lamina" id="lamina"></div>
  <div class="reloj" id="reloj">
    <svg viewBox="0 0 120 120"><circle class="pista" cx="60" cy="60" r="52"/>
    <circle class="avance" id="anillo" cx="60" cy="60" r="52"/></svg>
    <div class="num" id="num"></div>
  </div>
  <div class="acciones">
    <button class="enlace" id="saltar">Saltar ejercicio</button>
  </div>
</section>

<section id="final" hidden>
  <div class="centro">
    <div id="bichoFiesta">${mascota("celebra")}</div>
    <div id="bichoCalma" hidden>${mascota("calma")}</div>
    <h1 id="tituloFinal">¡Pausa completada!</h1>
    <p id="textoFinal">Quedó registrada. Nos vemos en la próxima.</p>
    <div class="marcadores">
      <div class="marcador marcador--xp"><b id="mXp">0</b><span>XP</span></div>
      <div class="marcador marcador--tiempo"><b id="mTiempo">0:00</b><span>Tiempo</span></div>
      <div class="marcador marcador--ej"><b id="mEj">0/${EJERCICIOS.length}</b><span>Ejercicios</span></div>
    </div>
  </div>
  <div class="acciones">
    <button class="btn" id="listo">Listo</button>
    <button class="btn btn--hueco" id="molestia">Sentí molestia</button>
  </div>
</section>

<section id="formMolestia" hidden>
  <h1>¿Dónde sentiste la molestia?</h1>
  <p>Elige una zona. La ve el área de SST.</p>
  <div class="zonas" id="zonas">
    ${ZONAS_MOLESTIA.map(
      (z) =>
        `<button type="button" aria-pressed="false" data-zona="${esc(z)}">${esc(z)}</button>`,
    ).join("")}
  </div>
  <textarea id="comentario" maxlength="200" placeholder="Cuéntanos más (opcional)"></textarea>
  <div class="cuenta"><span id="cuenta">0</span>/200</div>
  <div class="acciones">
    <button class="btn btn--azul" id="enviar" disabled>Enviar</button>
    <button class="enlace" id="cancelar">Volver</button>
  </div>
</section>

<section id="gracias" hidden>
  <div class="centro">
    ${mascota("saluda")}
    <h1>Gracias por contarnos</h1>
    <p>SST ya lo tiene. Te lo confirmamos por WhatsApp.</p>
  </div>
</section>

</main>
<script>
const TOKEN = ${JSON.stringify(token)};
const EJ = ${JSON.stringify(datos)};
const XP_POR_EJERCICIO = 10;
const $ = (id) => document.getElementById(id);
const casillas = [...$("barra").children];
const C = 2 * Math.PI * 52;
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

let i = 0, xp = 0, racha = 0, hechos = 0, saltados = 0;
let restante = 0, t0 = 0, acumulado = 0, rafId = null;
let corriendo = false, terminada = false, arrancoEn = 0;

$("anillo").style.strokeDasharray = C;
$("anillo").style.strokeDashoffset = 0;

// --- sonido: apagado por defecto, que esto se abre en una oficina ---
let audio = null, conSonido = false;
try { conSonido = localStorage.getItem("pausa-sonido") === "1"; } catch (e) {}

function pintarSonido() {
  $("sonido").textContent = conSonido ? "🔊 Sonido encendido" : "🔇 Sonido apagado";
  $("silenciar").textContent = conSonido ? "🔊" : "🔇";
}
function alternarSonido() {
  conSonido = !conSonido;
  try { localStorage.setItem("pausa-sonido", conSonido ? "1" : "0"); } catch (e) {}
  if (conSonido) { abrirAudio(); tono([[880, 0, .12]]); }
  pintarSonido();
}
function abrirAudio() {
  if (audio) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) { try { audio = new AC(); } catch (e) {} }
}
function tono(notas, tipo) {
  if (!conSonido || !audio) return;
  for (const [hz, cuando, dur] of notas) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = tipo || "sine";
    o.frequency.value = hz;
    const t = audio.currentTime + cuando;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
}
const vibrar = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
pintarSonido();
$("sonido").onclick = alternarSonido;
$("silenciar").onclick = alternarSonido;

// --- confeti ---
const COLORES = ["#5cc22e", "#2ba8e8", "#ffc400", "#c078ff", "#ff8fa3"];
function confeti(n) {
  if (quieto) return;
  for (let k = 0; k < n; k++) {
    const p = document.createElement("i");
    p.className = "papel";
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = COLORES[k % COLORES.length];
    p.style.animationDuration = (1.1 + Math.random() * 0.9) + "s";
    p.style.animationDelay = (Math.random() * 0.25) + "s";
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 2400);
  }
}

// --- rutina ---
function pintar() {
  const e = EJ[i];
  $("paso").textContent = "Ejercicio " + (i + 1) + " de " + EJ.length + " · " + e.zona;
  $("nombre").textContent = e.nombre;
  $("instruccion").textContent = e.instruccion;
  $("lamina").innerHTML = e.svg;
  $("lamina").classList.remove("tarjeta-entra");
  void $("lamina").offsetWidth;
  $("lamina").classList.add("tarjeta-entra");
  casillas.forEach((b, n) => { b.className = n < i ? "hecho" : n === i ? "activo" : ""; });
  restante = e.segundos;
  acumulado = 0;
  $("reloj").classList.remove("poco");
  dibujar(0);
  $("num").textContent = restante;
}

function dibujar(fraccion) {
  $("anillo").style.strokeDashoffset = C * Math.min(1, fraccion);
}

function marco(ahora) {
  if (!corriendo) return;
  const e = EJ[i];
  const ms = acumulado + (ahora - t0);
  const total = e.segundos * 1000;
  dibujar(ms / total);

  const quedan = Math.max(0, Math.ceil((total - ms) / 1000));
  if (quedan !== restante) {
    restante = quedan;
    $("num").textContent = restante;
    if (restante <= 3 && restante > 0) {
      $("reloj").classList.add("poco");
      $("num").classList.remove("late"); void $("num").offsetWidth; $("num").classList.add("late");
      tono([[660, 0, .08]]);
    }
  }
  if (ms >= total) { completarEjercicio(false); return; }
  rafId = requestAnimationFrame(marco);
}

function arrancar() {
  corriendo = true;
  t0 = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(marco);
}

function completarEjercicio(saltado) {
  corriendo = false;
  cancelAnimationFrame(rafId);

  if (saltado) { saltados++; racha = 0; }
  else { hechos++; racha++; xp += XP_POR_EJERCICIO; }

  casillas[i].className = "hecho";
  $("rachaN").textContent = racha;
  $("racha").classList.toggle("oculta", racha < 2);

  if (saltado) { avanzar(); return; }

  vibrar(35);
  tono([[784, 0, .1], [1046, .09, .16]]);
  aplaudir(avanzar);
}

const GRITOS = ["¡Bien!", "¡Genial!", "¡Vamos!", "¡Eso es!", "¡Muy bien!"];

function aplaudir(despues) {
  const capa = document.createElement("div");
  capa.id = "aplauso";
  capa.innerHTML =
    '<div class="grito">' + GRITOS[Math.floor(Math.random() * GRITOS.length)] + "</div>" +
    '<div class="xp">+' + XP_POR_EJERCICIO + " XP</div>";
  document.body.appendChild(capa);
  confeti(14);
  setTimeout(() => { capa.remove(); despues(); }, quieto ? 120 : 780);
}

function avanzar() {
  if (i < EJ.length - 1) { i++; pintar(); arrancar(); return; }
  terminar();
}

async function terminar() {
  terminada = true;
  corriendo = false;
  cancelAnimationFrame(rafId);

  const seg = Math.round((Date.now() - arrancoEn) / 1000);
  const bono = saltados === 0 ? 20 : 0;
  xp += bono;

  $("mXp").textContent = xp;
  $("mTiempo").textContent = Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0");
  $("mEj").textContent = hechos + "/" + EJ.length;

  $("rutina").hidden = true;
  $("final").hidden = false;

  let contada = false;
  try {
    const r = await fetch("/p/" + TOKEN + "/done", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saltados: saltados, segundos: seg })
    });
    contada = r.ok && (await r.json()).ok === true;
  } catch (e) {}

  const desanimar = () => { $("bichoFiesta").hidden = true; $("bichoCalma").hidden = false; };

  if (contada && hechos === 0) {
    desanimar();
    // Dejo pasar el tiempo pero se salto todos los ejercicios. Cuenta para el
    // registro, pero celebrarlo seria mentirle.
    $("tituloFinal").textContent = "Pausa registrada";
    $("textoFinal").textContent =
      "Te saltaste los seis ejercicios. En la próxima, sigue el cronómetro: para eso es la pausa.";
  } else if (contada) {
    vibrar([40, 60, 90]);
    tono([[523, 0, .13], [659, .11, .13], [784, .22, .13], [1046, .33, .3]]);
    confeti(34);
    if (bono) $("textoFinal").textContent = "Sin saltarte ninguno. +" + bono + " XP de bono.";
  } else {
    // El servidor no la conto: fue demasiado rapida para ser una pausa real.
    desanimar();
    $("tituloFinal").textContent = "Casi";
    $("textoFinal").textContent =
      "Pasaste muy rápido para que cuente como pausa. En la próxima, deja correr el cronómetro.";
    $("mEj").textContent = hechos + "/" + EJ.length;
  }
}

// --- arranque ---
$("empezar").onclick = () => {
  abrirAudio();
  if (audio && audio.state === "suspended") audio.resume();
  arrancoEn = Date.now();
  $("inicio").hidden = true;
  $("rutina").hidden = false;
  pintar();
  arrancar();
};

$("saltar").onclick = () => { if (!terminada) completarEjercicio(true); };

// El cronometro se detiene si el empleado se va: no queremos premiar
// dejar la pantalla abierta en otra pestana.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (corriendo) { acumulado += performance.now() - t0; corriendo = false; cancelAnimationFrame(rafId); }
    if (!terminada && navigator.sendBeacon) {
      navigator.sendBeacon("/p/" + TOKEN + "/avance",
        new Blob([JSON.stringify({ ejercicio: i + 1 })], { type: "application/json" }));
    }
  } else if (!terminada && !$("rutina").hidden && !corriendo) {
    arrancar();
  }
});

// --- molestia ---
let zona = null;
$("molestia").onclick = () => { $("final").hidden = true; $("formMolestia").hidden = false; };
$("cancelar").onclick = () => { $("formMolestia").hidden = true; $("final").hidden = false; };
// No podemos cerrar la pestana desde aqui, asi que al menos lo decimos.
$("listo").onclick = () => {
  $("listo").disabled = true;
  $("listo").textContent = "Listo ✓";
  $("molestia").hidden = true;
  $("textoFinal").textContent = "Ya puedes volver a WhatsApp.";
};

$("zonas").onclick = (ev) => {
  const b = ev.target.closest("button[data-zona]");
  if (!b) return;
  zona = b.dataset.zona;
  [...$("zonas").children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  $("enviar").disabled = false;
  vibrar(12);
};

$("comentario").oninput = (ev) => { $("cuenta").textContent = ev.target.value.length; };

$("enviar").onclick = async () => {
  if (!zona) return;
  $("enviar").disabled = true;
  $("enviar").textContent = "Enviando…";
  try {
    const r = await fetch("/p/" + TOKEN + "/molestia", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zona: zona, comentario: $("comentario").value })
    });
    if (!r.ok) throw new Error("fallo");
    $("formMolestia").hidden = true;
    $("gracias").hidden = false;
    vibrar(30);
  } catch (e) {
    $("enviar").disabled = false;
    $("enviar").textContent = "Reintentar";
  }
};
</script>`;
}

export const SEGUNDOS_RUTINA = SEGUNDOS_TOTALES;

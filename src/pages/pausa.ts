// M4 - la rutina guiada, renderizada desde el mismo Worker.
// Sin build de frontend, sin framework: se abre en el navegador embebido de
// WhatsApp, en pantalla pequena y con una sola mano.
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

export async function abrirPausa(env: Env, token: string): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return html(paginaError("Este link ya venció.", "Te llega uno nuevo en tu próxima pausa."), 410);

  const pausa = await pausaPorId(env, payload.p);
  if (!pausa) return html(paginaError("No encontramos esta pausa.", ""), 404);

  await marcarPausaIniciada(env, pausa.id);
  return html(paginaRutina(token));
}

export async function completarPausa(env: Env, token: string): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return Response.json({ ok: false, error: "token invalido" }, { status: 410 });

  const pausa = await pausaPorId(env, payload.p);
  if (!pausa) return Response.json({ ok: false, error: "pausa no encontrada" }, { status: 404 });

  await marcarPausaCompletada(env, pausa.id);
  return Response.json({ ok: true });
}

/** navigator.sendBeacon al cerrar: registra hasta donde llego. */
export async function registrarAvance(env: Env, token: string, req: Request): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return new Response(null, { status: 204 });

  const cuerpo = await req.text();
  let ejercicio: unknown = null;
  try {
    ejercicio = (JSON.parse(cuerpo) as { ejercicio?: unknown }).ejercicio ?? null;
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
      await registrarEvento(env, "error_confirmacion_molestia", empleado.id, { error: String(error) });
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

const escapar = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ESTILOS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0e1117;color:#e9ecf1;
  font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
main{max-width:460px;margin:0 auto;padding:20px 18px 32px;min-height:100vh;
  display:flex;flex-direction:column}
.barra{display:flex;gap:5px;margin-bottom:20px}
.barra span{flex:1;height:4px;border-radius:2px;background:#272d39;transition:background .3s}
.barra span.hecho{background:#3f8cff}
.barra span.activo{background:#7fb0ff}
.paso{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7d8695;margin-bottom:6px}
h1{font-size:23px;line-height:1.25;margin:0 0 10px;font-weight:650}
.instruccion{font-size:17px;color:#b9c0cc;margin:0 0 22px}
.lamina{background:#161b24;border:1px solid #232a36;border-radius:16px;
  padding:22px;display:flex;align-items:center;justify-content:center;margin-bottom:22px}
.lamina svg{width:100%;max-width:230px;height:auto;color:#8fb8ff;display:block}
.reloj{display:flex;align-items:center;gap:14px;margin-bottom:22px}
.reloj .num{font-size:40px;font-weight:680;font-variant-numeric:tabular-nums;min-width:66px}
.pista{flex:1;height:6px;background:#272d39;border-radius:3px;overflow:hidden}
.pista i{display:block;height:100%;width:0;background:#3f8cff;border-radius:3px}
.acciones{margin-top:auto;display:flex;flex-direction:column;gap:10px}
button{width:100%;padding:15px;border:0;border-radius:12px;font-size:16px;
  font-weight:600;font-family:inherit;color:#fff;background:#3f8cff;cursor:pointer}
button.sec{background:#1b2230;color:#b9c0cc;border:1px solid #2c3441}
button:disabled{opacity:.5}
.zonas{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px}
.zonas button{padding:14px 8px;font-size:15px;background:#1b2230;border:1px solid #2c3441;color:#e9ecf1}
.zonas button[aria-pressed=true]{background:#3f8cff;border-color:#3f8cff;color:#fff}
textarea{width:100%;min-height:84px;padding:12px;border-radius:12px;background:#161b24;
  border:1px solid #2c3441;color:#e9ecf1;font:15px/1.45 inherit;resize:vertical}
.cuenta{font-size:12px;color:#7d8695;text-align:right;margin:5px 0 14px}
.ok{text-align:center;padding-top:40px}
.ok .tic{width:66px;height:66px;border-radius:50%;background:#14331f;color:#4ade80;
  display:flex;align-items:center;justify-content:center;font-size:34px;margin:0 auto 18px}
[hidden]{display:none!important}
`;

const cabecera = (titulo: string): string =>
  `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapar(titulo)}</title><style>${ESTILOS}</style>`;

const paginaError = (titulo: string, detalle: string): string =>
  `${cabecera("Pausa activa")}<main><div class="ok">
    <h1>${escapar(titulo)}</h1><p class="instruccion">${escapar(detalle)}</p>
  </div></main>`;

function paginaRutina(token: string): string {
  const datos = EJERCICIOS.map((e) => ({
    zona: e.zona,
    nombre: e.nombre,
    instruccion: e.instruccion,
    segundos: e.segundos,
    svg: e.svg,
  }));

  return `${cabecera("Tu pausa activa")}<main>
<div id="rutina">
  <div class="barra" id="barra">${EJERCICIOS.map(() => "<span></span>").join("")}</div>
  <div class="paso" id="paso"></div>
  <h1 id="nombre"></h1>
  <p class="instruccion" id="instruccion"></p>
  <div class="lamina" id="lamina"></div>
  <div class="reloj">
    <div class="num" id="num"></div>
    <div class="pista"><i id="pista"></i></div>
  </div>
  <div class="acciones">
    <button class="sec" id="saltar">Saltar ejercicio</button>
  </div>
</div>

<div id="final" hidden>
  <div class="ok">
    <div class="tic">&check;</div>
    <h1>Pausa completada</h1>
    <p class="instruccion">Quedó registrada. Nos vemos en la próxima.</p>
  </div>
  <div class="acciones">
    <button id="listo">Listo</button>
    <button class="sec" id="molestia">Sentí molestia</button>
  </div>
</div>

<div id="formMolestia" hidden>
  <h1>¿Dónde sentiste la molestia?</h1>
  <p class="instruccion">Elige una zona. La ve el área de SST.</p>
  <div class="zonas" id="zonas">
    ${ZONAS_MOLESTIA.map((z) => `<button type="button" aria-pressed="false" data-zona="${escapar(z)}">${escapar(z)}</button>`).join("")}
  </div>
  <textarea id="comentario" maxlength="200" placeholder="Cuéntanos más (opcional)"></textarea>
  <div class="cuenta"><span id="cuenta">0</span>/200</div>
  <div class="acciones">
    <button id="enviar" disabled>Enviar</button>
    <button class="sec" id="cancelar">Volver</button>
  </div>
</div>

<div id="gracias" hidden>
  <div class="ok">
    <div class="tic">&check;</div>
    <h1>Gracias por contarnos</h1>
    <p class="instruccion">SST ya lo tiene. Te lo confirmamos por WhatsApp.</p>
  </div>
</div>

<script>
const TOKEN = ${JSON.stringify(token)};
const EJ = ${JSON.stringify(datos)};
const $ = (id) => document.getElementById(id);
const barra = [...$("barra").children];

let i = 0, restante = 0, reloj = null, terminada = false;

function pintar() {
  const e = EJ[i];
  $("paso").textContent = "Ejercicio " + (i + 1) + " de " + EJ.length + " \\u00b7 " + e.zona;
  $("nombre").textContent = e.nombre;
  $("instruccion").textContent = e.instruccion;
  $("lamina").innerHTML = e.svg;
  barra.forEach((b, n) => {
    b.className = n < i ? "hecho" : n === i ? "activo" : "";
  });
  restante = e.segundos;
  tic();
}

function tic() {
  const e = EJ[i];
  $("num").textContent = restante + "s";
  $("pista").style.width = (((e.segundos - restante) / e.segundos) * 100) + "%";
}

function arrancar() {
  clearInterval(reloj);
  reloj = setInterval(() => {
    restante--;
    tic();
    if (restante <= 0) siguiente();
  }, 1000);
}

function siguiente() {
  clearInterval(reloj);
  if (i < EJ.length - 1) { i++; pintar(); arrancar(); return; }
  terminar();
}

async function terminar() {
  terminada = true;
  barra.forEach((b) => (b.className = "hecho"));
  $("rutina").hidden = true;
  $("final").hidden = false;
  try { await fetch("/p/" + TOKEN + "/done", { method: "POST" }); } catch (e) {}
}

$("saltar").onclick = siguiente;

// Si cierra a mitad, registramos hasta donde llego: no cuenta como completada.
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && !terminada && navigator.sendBeacon) {
    navigator.sendBeacon("/p/" + TOKEN + "/avance",
      new Blob([JSON.stringify({ ejercicio: i + 1 })], { type: "application/json" }));
  }
});

// --- molestia ---
let zona = null;
$("molestia").onclick = () => { $("final").hidden = true; $("formMolestia").hidden = false; };
$("cancelar").onclick = () => { $("formMolestia").hidden = true; $("final").hidden = false; };
$("listo").onclick = () => { $("listo").disabled = true; $("listo").textContent = "Listo \\u2713"; };

$("zonas").onclick = (ev) => {
  const b = ev.target.closest("button[data-zona]");
  if (!b) return;
  zona = b.dataset.zona;
  [...$("zonas").children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  $("enviar").disabled = false;
};

$("comentario").oninput = (ev) => { $("cuenta").textContent = ev.target.value.length; };

$("enviar").onclick = async () => {
  if (!zona) return;
  $("enviar").disabled = true;
  $("enviar").textContent = "Enviando...";
  try {
    const r = await fetch("/p/" + TOKEN + "/molestia", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zona, comentario: $("comentario").value })
    });
    if (!r.ok) throw new Error("fallo");
    $("formMolestia").hidden = true;
    $("gracias").hidden = false;
  } catch (e) {
    $("enviar").disabled = false;
    $("enviar").textContent = "Reintentar";
  }
};

pintar();
arrancar();
</script>
</main>`;
}

export const SEGUNDOS_RUTINA = SEGUNDOS_TOTALES;

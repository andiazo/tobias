// M6 - El reporte de evidencia para SST. HTML server-rendered, sin login,
// detras de un token largo no adivinable. Es el documento que se lleva a la
// auditoria, asi que el encabezado va fechado y la pagina imprime limpio.
import type { Env } from "../env";
import {
  adherenciaPorDia,
  adherenciaPorEmpleado,
  empresaPorTokenReporte,
  molestiasDelRango,
  participacion,
  pausasParaCsv,
  rangoConDatos,
  totalesDelRango,
  type Empresa,
  type FilaEmpleado,
  type Rango,
  type Totales,
} from "../db/queries";
import { enZona } from "../lib/tz";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function resolver(
  env: Env,
  token: string,
  url: URL,
): Promise<{ empresa: Empresa; rango: Rango } | null> {
  const empresa = await empresaPorTokenReporte(env, token);
  if (!empresa) return null;

  const conDatos = await rangoConDatos(env, empresa.id);
  const hoy = enZona(new Date(), empresa.tz).fecha;
  const pedido = { desde: url.searchParams.get("desde"), hasta: url.searchParams.get("hasta") };

  return {
    empresa,
    rango: {
      desde: pedido.desde && FECHA.test(pedido.desde) ? pedido.desde : (conDatos?.desde ?? hoy),
      hasta: pedido.hasta && FECHA.test(pedido.hasta) ? pedido.hasta : (conDatos?.hasta ?? hoy),
    },
  };
}

export async function verReporte(env: Env, token: string, url: URL): Promise<Response> {
  const ctx = await resolver(env, token, url);
  if (!ctx) return new Response("Reporte no encontrado", { status: 404 });
  const { empresa, rango } = ctx;

  const [parte, totales, porDia, porEmpleado, molestias] = await Promise.all([
    participacion(env, empresa.id),
    totalesDelRango(env, empresa.id, rango),
    adherenciaPorDia(env, empresa.id, rango),
    adherenciaPorEmpleado(env, empresa.id, rango),
    molestiasDelRango(env, empresa.id, rango, empresa.tz),
  ]);

  const html = paginaReporte({
    empresa,
    rango,
    participacion: parte ?? { total: 0, con_consentimiento: 0, bajas: 0 },
    totales: totales ?? vacio(),
    porDia,
    porEmpleado,
    molestias,
    generado: new Date(),
  });

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // El PRD pide "actualizado al minuto"; 60 s de cache evita que un F5
      // insistente barra la cuota de filas leidas de D1.
      "cache-control": "public, max-age=60",
      "x-robots-tag": "noindex",
    },
  });
}

export async function exportarCsv(env: Env, token: string, url: URL): Promise<Response> {
  const ctx = await resolver(env, token, url);
  if (!ctx) return new Response("Reporte no encontrado", { status: 404 });
  const { empresa, rango } = ctx;

  const filas = await pausasParaCsv(env, empresa.id, rango);
  const cabecera = [
    "empleado",
    "cedula",
    "area",
    "fecha",
    "bloque",
    "hora_programada",
    "hora_enviada",
    "hora_confirmada",
    "hora_completada",
    "duracion_segundos",
    "estado",
    "canal_envio",
  ];

  const lineas = filas.map((f) => {
    const dur =
      f.completada_at && f.iniciada_at
        ? Math.max(0, Math.round((Date.parse(f.completada_at) - Date.parse(f.iniciada_at)) / 1000))
        : "";
    return csv([
      f.nombre,
      f.cedula ?? "",
      f.area ?? "",
      f.fecha,
      String(f.bloque + 1),
      hora(f.programada_at, empresa.tz),
      hora(f.enviada_at, empresa.tz),
      hora(f.confirmada_at, empresa.tz),
      hora(f.completada_at, empresa.tz),
      String(dur),
      f.estado,
      f.canal_envio ?? "",
    ]);
  });

  // BOM para que Excel en Windows lea bien las tildes.
  const cuerpo = "﻿" + [csv(cabecera), ...lineas].join("\r\n") + "\r\n";
  const nombre = `pausas-activas_${archivo(empresa.nombre)}_${rango.desde}_a_${rango.hasta}.csv`;

  return new Response(cuerpo, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
      "cache-control": "no-store",
    },
  });
}

// --- helpers ---------------------------------------------------------------

const vacio = (): Totales => ({ programadas: 0, confirmadas: 0, completadas: 0 });

const csv = (campos: string[]): string =>
  campos.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");

const archivo = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const hora = (iso: string | null, tz: string): string =>
  iso ? enZona(new Date(iso), tz).hhmm : "";

const pct = (parte: number, total: number): string =>
  total === 0 ? "—" : `${Math.round((parte / total) * 100)}%`;

const num = (n: number | null | undefined): number => Number(n ?? 0);

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const diaLargo = (fecha: string): string => {
  const [a, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1));
  return `${DIAS[dt.getUTCDay()]} ${d}`;
};

// --- HTML ------------------------------------------------------------------

const ESTILOS = `
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;color:#16191f;
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.hoja{max-width:900px;margin:0 auto;padding:28px 20px 60px}
header{border-bottom:2px solid #16191f;padding-bottom:16px;margin-bottom:26px}
h1{font-size:25px;margin:0 0 4px;letter-spacing:-.01em}
.meta{color:#5b6270;font-size:14px}
h2{font-size:17px;margin:34px 0 12px;padding-bottom:7px;border-bottom:1px solid #d9dce2}
.tarjetas{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px}
.t{background:#fff;border:1px solid #e0e3e9;border-radius:10px;padding:14px 16px}
.t .n{font-size:27px;font-weight:660;letter-spacing:-.02em}
.t .e{font-size:12.5px;color:#5b6270;margin-top:2px}
.t .d{font-size:12.5px;color:#858c99;margin-top:5px}
table{width:100%;border-collapse:collapse;background:#fff;
  border:1px solid #e0e3e9;border-radius:10px;overflow:hidden;font-size:14px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #eceef2}
th{background:#fafbfc;font-weight:620;font-size:12.5px;color:#5b6270;
  text-transform:uppercase;letter-spacing:.04em}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
.baja{color:#8b929e}
.aviso{background:#fffaf0;border:1px solid #f0dfbb;border-radius:10px;
  padding:13px 15px;font-size:14px;color:#6b5a33;margin-bottom:8px}
.nota{color:#5b6270;font-size:13.5px;margin:0 0 12px}
.vacio{background:#fff;border:1px dashed #d9dce2;border-radius:10px;
  padding:18px;color:#858c99;text-align:center;font-size:14px}
.barra{display:block;height:5px;border-radius:3px;background:#e3e6ec;margin-top:5px;overflow:hidden}
.barra i{display:block;height:100%;background:#2563eb}
a.boton{display:inline-block;background:#16191f;color:#fff;text-decoration:none;
  padding:11px 18px;border-radius:9px;font-weight:600;font-size:14.5px}
a{color:#1d4ed8}
footer{margin-top:40px;padding-top:14px;border-top:1px solid #d9dce2;
  color:#858c99;font-size:12.5px}
@media print{body{background:#fff}.hoja{max-width:none;padding:0}
  a.boton{display:none}table,.t{border-color:#bbb}}
@media (max-width:620px){.hoja{padding:20px 14px 40px}table{font-size:13px}
  th,td{padding:7px 8px}}
`;

interface DatosReporte {
  empresa: Empresa;
  rango: Rango;
  participacion: { total: number; con_consentimiento: number; bajas: number };
  totales: Totales;
  porDia: { fecha: string; programadas: number; confirmadas: number; completadas: number }[];
  porEmpleado: FilaEmpleado[];
  molestias: { nombre: string; area: string | null; zona: string; comentario: string | null; created_at: string }[];
  generado: Date;
}

function paginaReporte(d: DatosReporte): string {
  const t = d.totales;
  const prog = num(t.programadas);
  const conf = num(t.confirmadas);
  const comp = num(t.completadas);
  const brecha = prog === 0 ? 0 : Math.round(((conf - comp) / prog) * 100);
  const gen = enZona(d.generado, d.empresa.tz);

  return `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Evidencia de pausas activas — ${esc(d.empresa.nombre)}</title>
<style>${ESTILOS}</style>
<div class="hoja">
<header>
  <h1>Evidencia de pausas activas</h1>
  <div class="meta">
    ${esc(d.empresa.nombre)}${d.empresa.nit ? ` · NIT ${esc(d.empresa.nit)}` : ""}<br>
    Periodo del ${esc(d.rango.desde)} al ${esc(d.rango.hasta)} ·
    Generado el ${esc(gen.fecha)} a las ${esc(gen.hhmm)} (hora de Bogotá)
  </div>
</header>

<h2>Participación</h2>
<div class="tarjetas">
  <div class="t"><div class="n">${d.participacion.con_consentimiento} de ${d.participacion.total}</div>
    <div class="e">Empleados inscritos</div>
    <div class="d">${pct(d.participacion.con_consentimiento, d.participacion.total)} de los cargados</div></div>
  <div class="t"><div class="n">${d.participacion.bajas}</div>
    <div class="e">Bajas voluntarias</div>
    <div class="d">Escribieron SALIR</div></div>
  <div class="t"><div class="n">${prog}</div>
    <div class="e">Pausas programadas</div>
    <div class="d">En el periodo</div></div>
</div>

<h2>Adherencia</h2>
<div class="tarjetas">
  <div class="t"><div class="n">${comp}</div>
    <div class="e">Completadas con cronómetro</div>
    <div class="d">${pct(comp, prog)} de las programadas</div>
    <span class="barra"><i style="width:${prog ? (comp / prog) * 100 : 0}%"></i></span></div>
  <div class="t"><div class="n">${conf}</div>
    <div class="e">Confirmadas por el empleado</div>
    <div class="d">${pct(conf, prog)} — tocó el botón</div>
    <span class="barra"><i style="width:${prog ? (conf / prog) * 100 : 0}%"></i></span></div>
  <div class="t"><div class="n">${brecha} pts</div>
    <div class="e">Brecha entre las dos</div>
    <div class="d">Tocaron el botón sin terminar la rutina</div></div>
</div>
<p class="nota">Las dos columnas se miden por separado a propósito.
<strong>Confirmadas</strong> es que el empleado tocó el botón del recordatorio;
<strong>completadas</strong> es que el cronómetro llegó al final de los seis
ejercicios. Solo la segunda demuestra ejecución.</p>
${brecha > 30 ? `<div class="aviso"><strong>Brecha de ${brecha} puntos.</strong> Por encima de 30, el botón deja de servir como evidencia por sí solo: conviene reportar únicamente la columna del cronómetro.</div>` : ""}

<h2>Adherencia por día</h2>
${
  d.porDia.length === 0
    ? `<div class="vacio">Todavía no hay pausas registradas en este periodo.</div>`
    : `<table><thead><tr><th>Día</th><th class="n">Programadas</th>
<th class="n">Confirmadas</th><th class="n">Completadas</th><th class="n">Adherencia</th></tr></thead><tbody>
${d.porDia
  .map(
    (f) => `<tr><td>${esc(f.fecha)} · ${esc(diaLargo(f.fecha))}</td>
<td class="n">${num(f.programadas)}</td><td class="n">${num(f.confirmadas)}</td>
<td class="n">${num(f.completadas)}</td><td class="n">${pct(num(f.completadas), num(f.programadas))}</td></tr>`,
  )
  .join("")}
</tbody></table>`
}

<h2>Adherencia por empleado</h2>
<p class="nota">Ordenada de menor a mayor: quienes menos participan salen arriba.</p>
${
  d.porEmpleado.length === 0
    ? `<div class="vacio">Todavía no hay empleados inscritos.</div>`
    : `<table><thead><tr><th>Empleado</th><th>Área</th><th class="n">Programadas</th>
<th class="n">Confirmadas</th><th class="n">Completadas</th><th class="n">Adherencia</th></tr></thead><tbody>
${d.porEmpleado
  .map(
    (f) => `<tr${f.baja_at ? ' class="baja"' : ""}><td>${esc(f.nombre)}${f.baja_at ? " · baja" : ""}</td>
<td>${esc(f.area ?? "—")}</td><td class="n">${num(f.programadas)}</td>
<td class="n">${num(f.confirmadas)}</td><td class="n">${num(f.completadas)}</td>
<td class="n">${pct(num(f.completadas), num(f.programadas))}</td></tr>`,
  )
  .join("")}
</tbody></table>`
}

<h2>Molestias reportadas</h2>
${
  d.molestias.length === 0
    ? `<div class="vacio">Ningún empleado reportó molestias en este periodo.</div>`
    : `<table><thead><tr><th>Fecha</th><th>Empleado</th><th>Área</th><th>Zona</th><th>Comentario</th></tr></thead><tbody>
${d.molestias
  .map((m) => {
    const f = enZona(new Date(m.created_at), d.empresa.tz);
    return `<tr><td>${esc(f.fecha)} ${esc(f.hhmm)}</td><td>${esc(m.nombre)}</td>
<td>${esc(m.area ?? "—")}</td><td>${esc(m.zona)}</td><td>${esc(m.comentario ?? "—")}</td></tr>`;
  })
  .join("")}
</tbody></table>`
}

<h2>Evaluación ergonómica</h2>
<div class="tarjetas">
  <div class="t"><div class="n">${d.empresa.form_respuestas ?? 0} de ${d.empresa.form_enviados ?? 0}</div>
    <div class="e">Respuestas recibidas</div>
    <div class="d">${pct(num(d.empresa.form_respuestas), num(d.empresa.form_enviados))} de los enviados</div></div>
</div>
<p class="nota">${
    d.empresa.form_ergonomia_url
      ? `Las fotos y respuestas están en <a href="${esc(d.empresa.form_ergonomia_url)}" rel="noopener noreferrer" target="_blank">el formulario</a>. El análisis lo hace una persona, no el sistema.`
      : `Todavía no se ha configurado el formulario de evaluación ergonómica.`
  }</p>

<h2>Descargar</h2>
<p class="nota">Una fila por pausa programada, con la hora de envío, la de
confirmación, la de completado y la duración real. Es el anexo del informe.</p>
<p><a class="boton" href="export.csv?desde=${esc(d.rango.desde)}&amp;hasta=${esc(d.rango.hasta)}">Descargar evidencia (CSV)</a></p>

<footer>
  Documento generado automáticamente el ${esc(gen.fecha)} a las ${esc(gen.hhmm)}.
  Los datos se actualizan al minuto. Programa de pausas activas — ${esc(d.empresa.nombre)}.
</footer>
</div>`;
}

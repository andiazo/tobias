// Prepared statements contra env.DB. Sin ORM.
import type { Env } from "../env";
import { ahoraIso } from "../lib/tz";

export interface Empresa {
  id: string;
  nombre: string;
  nit: string | null;
  tz: string;
  horarios: string;
  reporte_token: string;
  form_ergonomia_url: string | null;
  created_at: string;
}

export interface Empleado {
  id: string;
  empresa_id: string;
  nombre: string;
  cedula: string | null;
  telefono_e164: string;
  area: string | null;
  consentimiento_at: string | null;
  baja_at: string | null;
  ventana_abierta_hasta: string | null;
  optin_enviado_at: string | null;
  created_at: string;
}

export interface Pausa {
  id: string;
  empleado_id: string;
  empresa_id: string;
  fecha: string;
  bloque: number;
  programada_at: string;
  enviada_at: string | null;
  estado: string;
  confirmada_at: string | null;
  iniciada_at: string | null;
  completada_at: string | null;
  canal_envio: string | null;
}

export const nuevoId = (): string => crypto.randomUUID();

/** E.164 sin el "+", que es como viaja el numero en los webhooks de Meta. */
export const normalizarTelefono = (tel: string): string => `+${tel.replace(/[^\d]/g, "")}`;

export const empresaPorId = (env: Env, id: string): Promise<Empresa | null> =>
  env.DB.prepare("SELECT * FROM empresas WHERE id = ?").bind(id).first<Empresa>();

export const primeraEmpresa = (env: Env): Promise<Empresa | null> =>
  env.DB.prepare("SELECT * FROM empresas ORDER BY created_at LIMIT 1").first<Empresa>();

export const empleadoPorTelefono = (env: Env, telefono: string): Promise<Empleado | null> =>
  env.DB.prepare("SELECT * FROM empleados WHERE telefono_e164 = ?")
    .bind(normalizarTelefono(telefono))
    .first<Empleado>();

export const empleadoPorId = (env: Env, id: string): Promise<Empleado | null> =>
  env.DB.prepare("SELECT * FROM empleados WHERE id = ?").bind(id).first<Empleado>();

export async function crearEmpleado(
  env: Env,
  datos: {
    empresaId: string;
    nombre: string;
    telefono: string;
    cedula?: string | null;
    area?: string | null;
  },
): Promise<Empleado> {
  const id = nuevoId();
  await env.DB.prepare(
    `INSERT INTO empleados (id, empresa_id, nombre, cedula, telefono_e164, area, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      datos.empresaId,
      datos.nombre,
      datos.cedula ?? null,
      normalizarTelefono(datos.telefono),
      datos.area ?? null,
      ahoraIso(),
    )
    .run();
  const creado = await empleadoPorId(env, id);
  if (!creado) throw new Error("no se pudo leer el empleado recien creado");
  return creado;
}

/** Cada mensaje entrante reabre la ventana de servicio de 24 h. */
export const abrirVentana = (env: Env, empleadoId: string, hasta: string): Promise<unknown> =>
  env.DB.prepare("UPDATE empleados SET ventana_abierta_hasta = ? WHERE id = ?")
    .bind(hasta, empleadoId)
    .run();

export const marcarOptinEnviado = (env: Env, empleadoId: string): Promise<unknown> =>
  env.DB.prepare("UPDATE empleados SET optin_enviado_at = ? WHERE id = ?")
    .bind(ahoraIso(), empleadoId)
    .run();

export const registrarConsentimiento = (env: Env, empleadoId: string): Promise<unknown> =>
  env.DB.prepare(
    // Reingreso tras un SALIR: se conserva la fecha del consentimiento original.
    "UPDATE empleados SET consentimiento_at = COALESCE(consentimiento_at, ?), baja_at = NULL WHERE id = ?",
  )
    .bind(ahoraIso(), empleadoId)
    .run();

export const registrarBaja = (env: Env, empleadoId: string): Promise<unknown> =>
  env.DB.prepare("UPDATE empleados SET baja_at = ? WHERE id = ?").bind(ahoraIso(), empleadoId).run();

export async function registrarEvento(
  env: Env,
  tipo: string,
  empleadoId: string | null,
  payload: unknown,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO eventos (id, empleado_id, tipo, payload, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(nuevoId(), empleadoId, tipo, JSON.stringify(payload ?? null), ahoraIso())
    .run();
}

/**
 * Devuelve true la primera vez que se ve un wamid. Meta y Kapso reintentan
 * el webhook: sin esto, un reintento duplica respuestas.
 */
export async function marcarMensajeProcesado(env: Env, wamid: string): Promise<boolean> {
  const r = await env.DB.prepare(
    "INSERT INTO mensajes_procesados (wamid, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
  )
    .bind(wamid, ahoraIso())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export const pausaPorId = (env: Env, id: string): Promise<Pausa | null> =>
  env.DB.prepare("SELECT * FROM pausas WHERE id = ?").bind(id).first<Pausa>();

/** Idempotente por (empleado_id, fecha, bloque). El cron puede correr dos veces. */
export async function crearPausa(
  env: Env,
  datos: { empleado: Empleado; fecha: string; bloque: number; programadaAt: string },
): Promise<Pausa | null> {
  const id = nuevoId();
  const r = await env.DB.prepare(
    `INSERT INTO pausas (id, empleado_id, empresa_id, fecha, bloque, programada_at, estado)
     VALUES (?, ?, ?, ?, ?, ?, 'programada')
     ON CONFLICT (empleado_id, fecha, bloque) DO NOTHING`,
  )
    .bind(id, datos.empleado.id, datos.empleado.empresa_id, datos.fecha, datos.bloque, datos.programadaAt)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return null; // ya existia: otro tick la creo
  return pausaPorId(env, id);
}

export const marcarPausaEnviada = (env: Env, pausaId: string, canal: string): Promise<unknown> =>
  env.DB.prepare(
    "UPDATE pausas SET estado = 'enviada', enviada_at = ?, canal_envio = ? WHERE id = ?",
  )
    .bind(ahoraIso(), canal, pausaId)
    .run();

export const marcarPausaPospuesta = (env: Env, pausaId: string): Promise<unknown> =>
  env.DB.prepare("UPDATE pausas SET estado = 'pospuesta' WHERE id = ? AND estado IN ('programada','enviada')")
    .bind(pausaId)
    .run();

export const marcarPausaIniciada = (env: Env, pausaId: string): Promise<unknown> =>
  env.DB.prepare(
    `UPDATE pausas SET estado = 'iniciada', iniciada_at = COALESCE(iniciada_at, ?)
     WHERE id = ? AND estado NOT IN ('completada')`,
  )
    .bind(ahoraIso(), pausaId)
    .run();

export const marcarPausaCompletada = (env: Env, pausaId: string): Promise<unknown> =>
  env.DB.prepare("UPDATE pausas SET estado = 'completada', completada_at = ? WHERE id = ?")
    .bind(ahoraIso(), pausaId)
    .run();

/** Ultima pausa con envio vivo del empleado, para atar los botones entrantes. */
export const pausaAbiertaDelEmpleado = (env: Env, empleadoId: string): Promise<Pausa | null> =>
  env.DB.prepare(
    `SELECT * FROM pausas
     WHERE empleado_id = ? AND estado IN ('enviada','iniciada')
     ORDER BY programada_at DESC LIMIT 1`,
  )
    .bind(empleadoId)
    .first<Pausa>();

/** M3: toda pausa con mas de 30 min sin interaccion pasa a no_realizada. */
export async function barrerPausasVencidas(env: Env, minutos = 30): Promise<number> {
  const limite = new Date(Date.now() - minutos * 60_000).toISOString();
  const r = await env.DB.prepare(
    `UPDATE pausas SET estado = 'no_realizada'
     WHERE estado IN ('programada','enviada') AND programada_at < ?`,
  )
    .bind(limite)
    .run();
  return r.meta?.changes ?? 0;
}

export async function registrarMolestia(
  env: Env,
  datos: { empleadoId: string; pausaId: string | null; zona: string; comentario?: string | null },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO molestias (id, pausa_id, empleado_id, zona, comentario, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      nuevoId(),
      datos.pausaId,
      datos.empleadoId,
      datos.zona,
      datos.comentario?.slice(0, 200) ?? null,
      ahoraIso(),
    )
    .run();
}

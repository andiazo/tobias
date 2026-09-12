// Rutas de operacion del piloto. No son producto: son la consola minima para
// probar el motor sin esperar al cron ni a las plantillas aprobadas.
// Todas exigen el header Authorization: Bearer <ADMIN_TOKEN>.
import { Hono } from "hono";
import type { Env } from "./env";
import { modoPrueba } from "./env";
import {
  crearEmpleado,
  empresaPorId,
  marcarOptinEnviado,
  registrarConsentimiento,
  crearPausa,
  empleadoPorTelefono,
  marcarPausaEnviada,
  nuevoId,
  primeraEmpresa,
  registrarEvento,
} from "./db/queries";
import { enviarOptin, enviarRecordatorio, PlantillaNoDisponible } from "./whatsapp/mensajes";
import { ahoraIso, enZona, esMultiploDe15 } from "./lib/tz";
import { tokenDeReporte } from "./lib/tokens";
import { ventanaAbierta } from "./whatsapp/ventana";
import { correrTick } from "./scheduled";

export const admin = new Hono<{ Bindings: Env }>();

admin.use("*", async (c, next) => {
  const esperado = c.env.ADMIN_TOKEN;
  if (!esperado) return c.json({ error: "ADMIN_TOKEN no configurado" }, 503);
  if (c.req.header("authorization") !== `Bearer ${esperado}`) {
    return c.json({ error: "no autorizado" }, 401);
  }
  await next();
});

/** Crea la empresa del piloto (una sola fila durante el MVP). */
admin.post("/empresa", async (c) => {
  const body = await c.req.json<{
    nombre?: string;
    nit?: string;
    tz?: string;
    horarios?: string[];
    formErgonomiaUrl?: string;
  }>();
  if (!body.nombre) return c.json({ error: "falta nombre" }, 400);

  const horarios = body.horarios ?? ["10:00", "14:30", "16:30"];
  const invalido = horarios.find((h) => !esMultiploDe15(h));
  if (invalido) return c.json({ error: `horario no multiplo de 15 min: ${invalido}` }, 400);

  const id = nuevoId();
  const token = tokenDeReporte();
  await c.env.DB.prepare(
    `INSERT INTO empresas (id, nombre, nit, tz, horarios, reporte_token, form_ergonomia_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.nombre,
      body.nit ?? null,
      body.tz ?? "America/Bogota",
      JSON.stringify(horarios),
      token,
      body.formErgonomiaUrl ?? null,
      ahoraIso(),
    )
    .run();

  return c.json({ id, nombre: body.nombre, horarios, reporteToken: token, reporte: `/r/${token}` });
});

/** Carga un empleado y le manda el opt-in. */
admin.post("/empleado", async (c) => {
  const body = await c.req.json<{
    telefono?: string;
    nombre?: string;
    cedula?: string;
    area?: string;
    empresaId?: string;
    enviarOptin?: boolean;
  }>();
  if (!body.telefono || !body.nombre) return c.json({ error: "falta telefono o nombre" }, 400);

  const empresa = body.empresaId
    ? await c.env.DB.prepare("SELECT * FROM empresas WHERE id = ?")
        .bind(body.empresaId)
        .first<{ id: string; nombre: string }>()
    : await primeraEmpresa(c.env);
  if (!empresa) return c.json({ error: "no hay empresa creada" }, 400);

  const existente = await empleadoPorTelefono(c.env, body.telefono);
  const empleado =
    existente ??
    (await crearEmpleado(c.env, {
      empresaId: empresa.id,
      nombre: body.nombre,
      telefono: body.telefono,
      cedula: body.cedula ?? null,
      area: body.area ?? null,
    }));

  if (body.enviarOptin === false) return c.json({ empleado, optin: "omitido" });

  try {
    const { canal } = await enviarOptin(c.env, empleado, empresa.nombre);
    await marcarOptinEnviado(c.env, empleado.id);
    await registrarEvento(c.env, "optin_enviado", empleado.id, { canal, disparo: "admin" });
    return c.json({ empleado, optin: { enviado: true, canal } });
  } catch (error) {
    if (error instanceof PlantillaNoDisponible) {
      return c.json({ empleado, optin: { enviado: false, motivo: error.message } }, 409);
    }
    throw error;
  }
});

/** Dispara un recordatorio ya, sin esperar al cron. */
admin.post("/recordatorio", async (c) => {
  const body = await c.req.json<{ telefono?: string; bloque?: number }>();
  if (!body.telefono) return c.json({ error: "falta telefono" }, 400);

  const empleado = await empleadoPorTelefono(c.env, body.telefono);
  if (!empleado) return c.json({ error: "empleado no encontrado" }, 404);
  if (!empleado.consentimiento_at) return c.json({ error: "empleado sin consentimiento" }, 409);
  if (empleado.baja_at) return c.json({ error: "empleado dado de baja" }, 409);

  const empresa = await c.env.DB.prepare("SELECT * FROM empresas WHERE id = ?")
    .bind(empleado.empresa_id)
    .first<{ nombre: string; tz: string }>();
  if (!empresa) return c.json({ error: "empresa no encontrada" }, 500);

  const local = enZona(new Date(), empresa.tz);
  const bloque = body.bloque ?? 0;
  const pausa = await crearPausa(c.env, {
    empleado,
    fecha: local.fecha,
    bloque,
    programadaAt: ahoraIso(),
  });
  if (!pausa) return c.json({ error: `ya existe una pausa para ${local.fecha} bloque ${bloque}` }, 409);

  try {
    const { canal } = await enviarRecordatorio(c.env, empleado, pausa, empresa.nombre, local.hhmm);
    await marcarPausaEnviada(c.env, pausa.id, canal);
    return c.json({ pausa: pausa.id, canal, hora: local.hhmm });
  } catch (error) {
    if (error instanceof PlantillaNoDisponible) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

/** Actualiza el bloque de evaluación ergonómica del reporte. */
admin.post("/ergonomia", async (c) => {
  const body = await c.req.json<{
    empresaId?: string;
    url?: string;
    enviados?: number;
    respuestas?: number;
  }>();
  const empresa = body.empresaId
    ? await empresaPorId(c.env, body.empresaId)
    : await primeraEmpresa(c.env);
  if (!empresa) return c.json({ error: "empresa no encontrada" }, 404);

  await c.env.DB.prepare(
    `UPDATE empresas SET form_ergonomia_url = COALESCE(?, form_ergonomia_url),
                         form_enviados = COALESCE(?, form_enviados),
                         form_respuestas = COALESCE(?, form_respuestas)
     WHERE id = ?`,
  )
    .bind(body.url ?? null, body.enviados ?? null, body.respuestas ?? null, empresa.id)
    .run();

  return c.json({ ok: true, empresa: empresa.id });
});

/**
 * Borra todos los datos. Solo con MODO_PRUEBA y exige {"confirmar":"si"}:
 * es lo que deja correr el suite local de forma repetible.
 */
admin.post("/reset", async (c) => {
  if (!modoPrueba(c.env)) return c.json({ error: "solo disponible con MODO_PRUEBA" }, 403);
  const body = await c.req.json<{ confirmar?: string }>().catch(() => ({}) as { confirmar?: string });
  if (body.confirmar !== "si") return c.json({ error: 'falta {"confirmar":"si"}' }, 400);

  // El orden respeta las llaves foraneas.
  const tablas = ["molestias", "pausas", "eventos", "mensajes_procesados", "empleados", "empresas"];
  await c.env.DB.batch(tablas.map((t) => c.env.DB.prepare(`DELETE FROM ${t}`)));
  return c.json({ ok: true, tablas });
});

/**
 * Marca el consentimiento a mano. Es solo para pruebas: el consentimiento real
 * lo da el empleado tocando el boton del opt-in, y por eso solo existe con
 * MODO_PRUEBA encendido.
 */
admin.post("/consentimiento", async (c) => {
  if (!modoPrueba(c.env)) return c.json({ error: "solo disponible con MODO_PRUEBA" }, 403);
  const body = await c.req.json<{ telefono?: string }>();
  if (!body.telefono) return c.json({ error: "falta telefono" }, 400);

  const empleado = await empleadoPorTelefono(c.env, body.telefono);
  if (!empleado) return c.json({ error: "empleado no encontrado" }, 404);

  await registrarConsentimiento(c.env, empleado.id);
  await registrarEvento(c.env, "consentimiento_manual", empleado.id, { origen: "admin" });
  return c.json({ ok: true, empleado: empleado.id });
});

/**
 * Corre un tick del cron a demanda. `ahora` permite simular otra hora para
 * probar los horarios sin esperar al reloj.
 */
admin.post("/tick", async (c) => {
  const body = await c.req.json<{ ahora?: string }>().catch(() => ({}) as { ahora?: string });
  const ahora = body.ahora ? new Date(body.ahora) : new Date();
  if (Number.isNaN(ahora.getTime())) return c.json({ error: "fecha invalida en 'ahora'" }, 400);
  return c.json(await correrTick(c.env, ahora));
});

/** Estado de un empleado: consentimiento, ventana y ultimos eventos. */
admin.get("/estado", async (c) => {
  const telefono = c.req.query("telefono");
  if (!telefono) return c.json({ error: "falta ?telefono=" }, 400);

  const empleado = await empleadoPorTelefono(c.env, telefono);
  if (!empleado) return c.json({ error: "empleado no encontrado" }, 404);

  const eventos = await c.env.DB.prepare(
    "SELECT tipo, payload, created_at FROM eventos WHERE empleado_id = ? ORDER BY created_at DESC LIMIT 15",
  )
    .bind(empleado.id)
    .all();

  const pausas = await c.env.DB.prepare(
    "SELECT id, fecha, bloque, estado, canal_envio, enviada_at, completada_at FROM pausas WHERE empleado_id = ? ORDER BY programada_at DESC LIMIT 10",
  )
    .bind(empleado.id)
    .all();

  const molestias = await c.env.DB.prepare(
    "SELECT zona, comentario, created_at FROM molestias WHERE empleado_id = ? ORDER BY created_at DESC LIMIT 10",
  )
    .bind(empleado.id)
    .all();

  return c.json({
    empleado: {
      ...empleado,
      ventana_abierta: ventanaAbierta(empleado),
    },
    pausas: pausas.results,
    molestias: molestias.results,
    eventos: eventos.results,
  });
});

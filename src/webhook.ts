// M1 - Webhook de Kapso: firma, normalizacion, log de eventos y router.
import { normalizeWebhook } from "@kapso/whatsapp-cloud-api/server";
import type { Env } from "./env";
import { modoPrueba } from "./env";
import {
  abrirVentana,
  crearEmpleado,
  empleadoPorTelefono,
  marcarMensajeProcesado,
  marcarPausaPospuesta,
  pausaAbiertaDelEmpleado,
  pausaPorId,
  primeraEmpresa,
  registrarBaja,
  registrarConsentimiento,
  registrarEvento,
  type Empleado,
  type Empresa,
} from "./db/queries";
import { cierreDeVentana } from "./whatsapp/ventana";
import {
  BOTON,
  enviarLinkDePausa,
  enviarOptin,
  enviarTexto,
  partirBotonId,
} from "./whatsapp/mensajes";

/** Verificacion de la firma X-Hub-Signature-256 con WebCrypto. */
export async function firmaValida(
  raw: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const esperado = header.slice("sha256=".length).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== esperado.length) return false;
  // Comparacion en tiempo constante.
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

interface MensajeNormalizado {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    buttonReply?: { id?: string; title?: string };
    listReply?: { id?: string; title?: string };
  };
  button?: { payload?: string; text?: string };
  kapso?: { direction?: string; source?: string };
}

/** Procesa el payload ya parseado del webhook. Nunca lanza hacia afuera. */
export async function procesarWebhook(env: Env, payload: unknown): Promise<void> {
  const eventos = normalizeWebhook(payload as never) as {
    messages?: MensajeNormalizado[];
    statuses?: unknown[];
  };

  for (const mensaje of eventos.messages ?? []) {
    if (mensaje.kapso?.direction === "outbound") continue; // eco de lo que enviamos
    try {
      await procesarMensaje(env, mensaje);
    } catch (error) {
      console.error("error procesando mensaje", mensaje.id, error);
      await registrarEvento(env, "error_webhook", null, {
        wamid: mensaje.id,
        error: String(error),
      });
    }
  }

  for (const estado of eventos.statuses ?? []) {
    await registrarEvento(env, "status", null, estado);
  }
}

async function procesarMensaje(env: Env, mensaje: MensajeNormalizado): Promise<void> {
  const telefono = mensaje.from;
  if (!telefono) return;

  // Meta reintenta: un wamid ya visto no se vuelve a actuar.
  if (mensaje.id && !(await marcarMensajeProcesado(env, mensaje.id))) return;

  const { empleado, empresa } = await resolverEmpleado(env, telefono);
  if (!empleado || !empresa) {
    await registrarEvento(env, "entrante_desconocido", null, { telefono, wamid: mensaje.id });
    return;
  }

  // Todo mensaje entrante reabre la ventana de servicio de 24 h.
  await abrirVentana(env, empleado.id, cierreDeVentana());
  empleado.ventana_abierta_hasta = cierreDeVentana();

  await registrarEvento(env, "entrante", empleado.id, {
    wamid: mensaje.id,
    tipo: mensaje.type,
    texto: mensaje.text?.body,
    boton: mensaje.interactive?.buttonReply?.id ?? mensaje.button?.payload,
  });

  const botonId =
    mensaje.interactive?.buttonReply?.id ??
    mensaje.interactive?.listReply?.id ??
    mensaje.button?.payload ??
    null;

  if (botonId) {
    await manejarBoton(env, empleado, empresa, botonId);
    return;
  }

  await manejarTexto(env, empleado, empresa, mensaje.text?.body ?? "");
}

/**
 * En modo prueba un numero desconocido que escribe primero queda registrado
 * como empleado de la empresa demo. En el piloto real los empleados entran
 * por CSV y esto se apaga (MODO_PRUEBA=false).
 */
async function resolverEmpleado(
  env: Env,
  telefono: string,
): Promise<{ empleado: Empleado | null; empresa: Empresa | null }> {
  const existente = await empleadoPorTelefono(env, telefono);
  if (existente) {
    return { empleado: existente, empresa: await empresaPorEmpleado(env, existente) };
  }
  if (!modoPrueba(env)) return { empleado: null, empresa: null };

  const empresa = await primeraEmpresa(env);
  if (!empresa) return { empleado: null, empresa: null };

  const empleado = await crearEmpleado(env, {
    empresaId: empresa.id,
    nombre: "Participante de prueba",
    telefono,
  });
  await registrarEvento(env, "alta_modo_prueba", empleado.id, { telefono });
  return { empleado, empresa };
}

const empresaPorEmpleado = (env: Env, empleado: Empleado): Promise<Empresa | null> =>
  env.DB.prepare("SELECT * FROM empresas WHERE id = ?").bind(empleado.empresa_id).first<Empresa>();

async function manejarBoton(
  env: Env,
  empleado: Empleado,
  empresa: Empresa,
  botonId: string,
): Promise<void> {
  const { boton, pausaId } = partirBotonId(botonId);

  switch (boton) {
    case BOTON.optinSi: {
      await registrarConsentimiento(env, empleado.id);
      await enviarTexto(
        env,
        empleado.telefono_e164,
        "Listo, quedaste inscrito. Te escribimos en tu próxima pausa programada. " +
          "Escribe SALIR cuando quieras si prefieres no seguir.",
      );
      return;
    }
    case BOTON.optinNo: {
      await registrarBaja(env, empleado.id);
      await enviarTexto(
        env,
        empleado.telefono_e164,
        "Entendido, no te vamos a escribir. Si cambias de opinión, escribe PAUSAS.",
      );
      return;
    }
    case BOTON.pausaHacer: {
      const pausa = pausaId
        ? await pausaPorId(env, pausaId)
        : await pausaAbiertaDelEmpleado(env, empleado.id);
      if (!pausa) {
        await enviarTexto(env, empleado.telefono_e164, "No encontramos una pausa activa para este link.");
        return;
      }
      await enviarLinkDePausa(env, empleado, pausa);
      return;
    }
    case BOTON.pausaNo: {
      if (pausaId) await marcarPausaPospuesta(env, pausaId);
      await enviarTexto(env, empleado.telefono_e164, "Sin problema. Te escribimos en la siguiente.");
      return;
    }
    default: {
      await registrarEvento(env, "boton_desconocido", empleado.id, { botonId });
    }
  }
}

async function manejarTexto(
  env: Env,
  empleado: Empleado,
  empresa: Empresa,
  texto: string,
): Promise<void> {
  const limpio = texto.trim().toUpperCase();

  if (limpio === "SALIR") {
    await registrarBaja(env, empleado.id);
    await enviarTexto(
      env,
      empleado.telefono_e164,
      "Listo, dejamos de escribirte. Si quieres volver, escribe PAUSAS.",
    );
    return;
  }

  // Sin consentimiento todavia: cualquier mensaje dispara (o repite) el opt-in.
  if (!empleado.consentimiento_at || empleado.baja_at) {
    const { canal } = await enviarOptin(env, empleado, empresa.nombre);
    await registrarEvento(env, "optin_enviado", empleado.id, { canal, disparo: "mensaje_entrante" });
    return;
  }

  await enviarTexto(
    env,
    empleado.telefono_e164,
    "Estás inscrito en el programa de pausas activas. Te escribimos en tus horarios programados. " +
      "Escribe SALIR para darte de baja.",
  );
}

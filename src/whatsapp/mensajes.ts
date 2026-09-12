// Los mensajes del programa. Cada envio decide plantilla vs mensaje libre
// segun la ventana de 24 h del empleado (ver ventana.ts).
import type { Env } from "../env";
import type { Empleado, Pausa } from "../db/queries";
import { clienteKapso, phoneNumberId } from "./client";
import { canalPara } from "./ventana";
import { tokenDePausa } from "../lib/tokens";

/** Ids de los botones interactivos. El sufijo ata la respuesta a una pausa. */
export const BOTON = {
  optinSi: "optin_si",
  optinNo: "optin_no",
  pausaHacer: "pausa_hacer",
  pausaNo: "pausa_no",
} as const;

export const conPausa = (boton: string, pausaId: string): string => `${boton}:${pausaId}`;

export const partirBotonId = (id: string): { boton: string; pausaId: string | null } => {
  const i = id.indexOf(":");
  return i === -1 ? { boton: id, pausaId: null } : { boton: id.slice(0, i), pausaId: id.slice(i + 1) };
};

/** Se lanza cuando haria falta una plantilla y todavia no hay ninguna aprobada. */
export class PlantillaNoDisponible extends Error {
  constructor(nombre: string) {
    super(
      `La ventana de 24 h esta cerrada y haria falta la plantilla "${nombre}", ` +
        `que aun no esta configurada. Pide al empleado que escriba primero al numero.`,
    );
    this.name = "PlantillaNoDisponible";
  }
}

const nombrePlantilla = (env: Env, clave: "optin" | "recordatorio"): string | null => {
  const v = clave === "optin" ? env.PLANTILLA_OPTIN : env.PLANTILLA_RECORDATORIO;
  return v && v.trim() ? v.trim() : null;
};

export async function enviarTexto(env: Env, telefono: string, body: string): Promise<string> {
  const r = await clienteKapso(env).messages.sendText({
    phoneNumberId: phoneNumberId(env),
    to: telefono,
    body,
  });
  return r.messages?.[0]?.id ?? "";
}

export async function enviarBotones(
  env: Env,
  telefono: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
  footerText?: string,
): Promise<string> {
  const r = await clienteKapso(env).messages.sendInteractiveButtons({
    phoneNumberId: phoneNumberId(env),
    to: telefono,
    bodyText,
    ...(footerText ? { footerText } : {}),
    buttons,
  });
  return r.messages?.[0]?.id ?? "";
}

export async function enviarBotonUrl(
  env: Env,
  telefono: string,
  bodyText: string,
  displayText: string,
  url: string,
): Promise<string> {
  const r = await clienteKapso(env).messages.sendInteractiveCtaUrl({
    phoneNumberId: phoneNumberId(env),
    to: telefono,
    bodyText,
    parameters: { displayText, url },
  });
  return r.messages?.[0]?.id ?? "";
}

export async function enviarPlantilla(
  env: Env,
  telefono: string,
  nombre: string,
  variables: string[],
): Promise<string> {
  const r = await clienteKapso(env).messages.sendTemplate({
    phoneNumberId: phoneNumberId(env),
    to: telefono,
    template: {
      name: nombre,
      language: { code: "es_CO" },
      ...(variables.length
        ? {
            components: [
              {
                type: "body",
                parameters: variables.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });
  return r.messages?.[0]?.id ?? "";
}

// --- Mensajes del programa -------------------------------------------------

const TEXTO_OPTIN =
  "Hola {nombre}. {empresa} activa su programa de pausas activas por WhatsApp.\n\n" +
  "Te vamos a escribir 3 veces al día, en días hábiles, con una rutina de 3 minutos.\n\n" +
  "Guardamos solo tu participación (si hiciste la pausa) y las molestias que reportes, " +
  "para la evidencia del SG-SST de la empresa. Puedes escribir SALIR cuando quieras y dejamos de escribirte.";

/** M2: opt-in. Libre si la ventana esta abierta; si no, plantilla. */
export async function enviarOptin(
  env: Env,
  empleado: Empleado,
  empresa: string,
): Promise<{ canal: string; wamid: string }> {
  const canal = canalPara(empleado);
  const cuerpo = TEXTO_OPTIN.replace("{nombre}", empleado.nombre).replace("{empresa}", empresa);

  if (canal === "libre") {
    const wamid = await enviarBotones(env, empleado.telefono_e164, cuerpo, [
      { id: BOTON.optinSi, title: "Sí, participo" },
      { id: BOTON.optinNo, title: "No, gracias" },
    ]);
    return { canal, wamid };
  }

  const plantilla = nombrePlantilla(env, "optin");
  if (!plantilla) throw new PlantillaNoDisponible("optin_programa_pausas");
  const wamid = await enviarPlantilla(env, empleado.telefono_e164, plantilla, [
    empleado.nombre,
    empresa,
  ]);
  return { canal, wamid };
}

/** M3/M1: recordatorio de pausa con los dos botones del PRD. */
export async function enviarRecordatorio(
  env: Env,
  empleado: Empleado,
  pausa: Pausa,
  empresa: string,
  horaLocal: string,
): Promise<{ canal: string; wamid: string }> {
  const canal = canalPara(empleado);
  const cuerpo =
    `${empleado.nombre}, es la hora de tu pausa activa programada de las ${horaLocal} ` +
    `en el programa de SST de ${empresa}. La rutina toma 3 minutos.`;

  if (canal === "libre") {
    const wamid = await enviarBotones(env, empleado.telefono_e164, cuerpo, [
      { id: conPausa(BOTON.pausaHacer, pausa.id), title: "Hacer pausa (3 min)" },
      { id: conPausa(BOTON.pausaNo, pausa.id), title: "Ahora no puedo" },
    ]);
    return { canal, wamid };
  }

  const plantilla = nombrePlantilla(env, "recordatorio");
  if (!plantilla) throw new PlantillaNoDisponible("recordatorio_pausa");
  const wamid = await enviarPlantilla(env, empleado.telefono_e164, plantilla, [
    empleado.nombre,
    horaLocal,
    empresa,
  ]);
  return { canal, wamid };
}

/** El link de la rutina: token HMAC unico que expira en 60 minutos. */
export async function enviarLinkDePausa(env: Env, empleado: Empleado, pausa: Pausa): Promise<string> {
  const token = await tokenDePausa(pausa.id, env.TOKEN_SECRET);
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/p/${token}`;
  return enviarBotonUrl(
    env,
    empleado.telefono_e164,
    "Listo. Abre la rutina y sigue los 6 ejercicios. El link vence en 60 minutos.",
    "Empezar pausa",
    url,
  );
}

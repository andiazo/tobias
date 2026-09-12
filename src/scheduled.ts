// M3 - El cron corre cada 15 min: programa los recordatorios cuyo horario
// coincide con este tick y cierra las pausas que nadie toco.
import type { Env } from "./env";
import {
  barrerPausasVencidas,
  crearPausa,
  marcarPausaEnviada,
  registrarEvento,
  type Empleado,
  type Empresa,
} from "./db/queries";
import { enviarRecordatorio, PlantillaNoDisponible } from "./whatsapp/mensajes";
import { enZona, esDiaHabil, tickDe15 } from "./lib/tz";

export interface ResumenTick {
  empresas: number;
  programadas: number;
  enviadas: number;
  fallidas: number;
  vencidas: number;
}

export async function correrTick(env: Env, ahora = new Date()): Promise<ResumenTick> {
  const resumen: ResumenTick = {
    empresas: 0,
    programadas: 0,
    enviadas: 0,
    fallidas: 0,
    vencidas: 0,
  };

  const { results: empresas = [] } = await env.DB.prepare("SELECT * FROM empresas").all<Empresa>();

  for (const empresa of empresas) {
    resumen.empresas++;
    const local = enZona(ahora, empresa.tz);
    if (!esDiaHabil(local)) continue;

    const bloque = bloqueDelTick(empresa, local.hhmm);
    if (bloque === null) continue;

    const empleados = await empleadosActivos(env, empresa.id);
    for (const empleado of empleados) {
      const pausa = await crearPausa(env, {
        empleado,
        fecha: local.fecha,
        bloque: bloque.indice,
        // La hora del tick, no el reloj: asi la simulacion es coherente.
        programadaAt: ahora.toISOString(),
      });
      // null = otro tick ya la creo. El cron puede correr dos veces.
      if (!pausa) continue;
      resumen.programadas++;

      try {
        const { canal } = await enviarRecordatorio(
          env,
          empleado,
          pausa,
          empresa.nombre,
          bloque.horario,
        );
        await marcarPausaEnviada(env, pausa.id, canal);
        resumen.enviadas++;
      } catch (error) {
        resumen.fallidas++;
        const motivo = error instanceof PlantillaNoDisponible ? "plantilla_no_disponible" : "error_envio";
        console.error(`no se pudo enviar el recordatorio a ${empleado.id}:`, error);
        await registrarEvento(env, motivo, empleado.id, {
          pausa: pausa.id,
          error: String(error),
        });
        // Queda 'programada': el barrido la cerrara como no_realizada.
      }
    }
  }

  resumen.vencidas = await barrerPausasVencidas(env);
  return resumen;
}

/** Devuelve el bloque del dia si alguno de los horarios cae en este tick. */
function bloqueDelTick(
  empresa: Empresa,
  hhmmLocal: string,
): { indice: number; horario: string } | null {
  const tick = tickDe15(hhmmLocal);
  let horarios: string[];
  try {
    horarios = JSON.parse(empresa.horarios) as string[];
  } catch {
    console.error(`horarios invalidos en la empresa ${empresa.id}: ${empresa.horarios}`);
    return null;
  }
  const indice = horarios.findIndex((h) => tickDe15(h) === tick);
  return indice === -1 ? null : { indice, horario: horarios[indice] ?? tick };
}

const empleadosActivos = async (env: Env, empresaId: string): Promise<Empleado[]> => {
  const { results = [] } = await env.DB.prepare(
    `SELECT * FROM empleados
     WHERE empresa_id = ? AND consentimiento_at IS NOT NULL AND baja_at IS NULL`,
  )
    .bind(empresaId)
    .all<Empleado>();
  return results;
};

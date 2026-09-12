// La ventana de servicio de 24 h es lo que mantiene el costo de Meta en el piso:
// dentro de ella mandamos mensajes libres; fuera, plantilla facturada.
import type { Empleado } from "../db/queries";
import { isoMasMinutos } from "../lib/tz";

export const VENTANA_MINUTOS = 24 * 60;

export const cierreDeVentana = (desde = new Date()): string =>
  isoMasMinutos(VENTANA_MINUTOS, desde);

export function ventanaAbierta(empleado: Pick<Empleado, "ventana_abierta_hasta">): boolean {
  if (!empleado.ventana_abierta_hasta) return false;
  const hasta = Date.parse(empleado.ventana_abierta_hasta);
  return Number.isFinite(hasta) && hasta > Date.now();
}

/** Canal que corresponde usar ahora mismo con este empleado. */
export const canalPara = (empleado: Pick<Empleado, "ventana_abierta_hasta">): "libre" | "plantilla" =>
  ventanaAbierta(empleado) ? "libre" : "plantilla";

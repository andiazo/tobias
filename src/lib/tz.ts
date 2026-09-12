// Todo se guarda en UTC. El calculo de horarios usa la zona de la empresa
// de forma explicita: Colombia no tiene DST, pero el offset no se hardcodea.

export interface HoraLocal {
  fecha: string; // YYYY-MM-DD
  hhmm: string; // HH:MM
  diaSemana: number; // 0 domingo ... 6 sabado
}

const PARTES = new Map<string, Intl.DateTimeFormat>();

const formateador = (tz: string): Intl.DateTimeFormat => {
  let f = PARTES.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    PARTES.set(tz, f);
  }
  return f;
};

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function enZona(fechaUtc: Date, tz: string): HoraLocal {
  const p = Object.fromEntries(
    formateador(tz)
      .formatToParts(fechaUtc)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  // Intl puede devolver "24" como hora en hour12:false segun el runtime.
  const hora = p.hour === "24" ? "00" : p.hour;
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${hora}:${p.minute}`,
    diaSemana: DIAS[p.weekday ?? "Mon"] ?? 1,
  };
}

export const esDiaHabil = (h: HoraLocal): boolean => h.diaSemana >= 1 && h.diaSemana <= 5;

/** Los horarios de la empresa deben caer en un tick del cron de 15 min. */
export const esMultiploDe15 = (hhmm: string): boolean => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return false;
  return Number(m[2]) % 15 === 0;
};

/**
 * Baja una hora local al tick de 15 min que le corresponde.
 * El cron no dispara exacto: si llega a las 10:01 el bloque sigue siendo 10:00.
 */
export function tickDe15(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  const minuto = Number(m ?? 0);
  if (!Number.isFinite(minuto)) return hhmm;
  return `${h}:${String(Math.floor(minuto / 15) * 15).padStart(2, "0")}`;
}

export const ahoraIso = (): string => new Date().toISOString();

export const isoMasMinutos = (minutos: number, desde = new Date()): string =>
  new Date(desde.getTime() + minutos * 60_000).toISOString();

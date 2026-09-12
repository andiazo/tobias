// Los 6 ejercicios de la rutina. 30 segundos cada uno, 3 minutos en total.
// La instrucción no pasa de 12 palabras: se lee de un vistazo, en el navegador
// embebido de WhatsApp, con una sola mano.
//
// Las ilustraciones van en línea a propósito. Son SVG de línea de menos de 1 KB;
// servirlas como assets sueltos costaría 6 peticiones extra en una conexión móvil
// para ahorrar unos bytes que ya viajan comprimidos con el HTML.

export interface Ejercicio {
  id: string;
  zona: string;
  nombre: string;
  instruccion: string;
  segundos: number;
  svg: string;
}

const marco = (contenido: string): string =>
  `<svg viewBox="0 0 200 170" fill="none" stroke="currentColor" stroke-width="4"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${contenido}</svg>`;

/** Punta de flecha sólida en (x,y), apuntando hacia `g` grados. */
const punta = (x: number, y: number, g: number): string =>
  `<path d="M0 0 L-13 -7 L-13 7 Z" fill="currentColor" stroke="none"
     transform="translate(${x} ${y}) rotate(${g})"/>`;

/** Flecha recta de (x1,y1) a (x2,y2). */
const flecha = (x1: number, y1: number, x2: number, y2: number): string => {
  const g = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke-width="3.5"/>${punta(x2, y2, g)}`;
};

export const EJERCICIOS: Ejercicio[] = [
  {
    id: "cuello",
    zona: "Cuello",
    nombre: "Inclinación de cuello",
    instruccion: "Lleva la oreja al hombro. Aguanta 15 segundos por lado.",
    segundos: 30,
    svg: marco(`
      <path d="M44 150 C 66 118 134 118 156 150"/>
      <path d="M100 122 L113 98"/>
      <circle cx="123" cy="71" r="27"/>
      <circle cx="134" cy="67" r="3.5" fill="currentColor" stroke="none"/>
      <path d="M64 66 A 56 56 0 0 1 112 24" stroke-width="3.5"/>
      ${punta(112, 24, -35)}`),
  },
  {
    id: "hombros",
    zona: "Hombros",
    nombre: "Círculos de hombros",
    instruccion: "Sube los hombros y gira hacia atrás, despacio.",
    segundos: 30,
    svg: marco(`
      <circle cx="100" cy="76" r="25"/>
      <path d="M100 101 v10"/>
      <path d="M44 152 C 66 114 134 114 156 152"/>
      ${flecha(60, 118, 60, 64)}
      ${flecha(140, 118, 140, 64)}`),
  },
  {
    id: "munecas",
    zona: "Muñecas",
    nombre: "Giro de muñecas",
    instruccion: "Estira los brazos y gira las muñecas en círculos.",
    segundos: 30,
    svg: marco(`
      <rect x="76" y="46" width="48" height="58" rx="15"/>
      <path d="M86 46 V20 M99 46 V14 M112 46 V22"/>
      <path d="M76 70 L52 56"/>
      <path d="M88 104 v16 M112 104 v16"/>
      <ellipse cx="100" cy="122" rx="47" ry="17" stroke-width="3.5" stroke-dasharray="9 9"/>
      ${punta(147, 122, 285)}`),
  },
  {
    id: "espalda-alta",
    zona: "Espalda alta",
    nombre: "Apertura de pecho",
    instruccion: "Junta los omóplatos y abre el pecho. Respira hondo.",
    segundos: 30,
    svg: marco(`
      <circle cx="100" cy="38" r="20"/>
      <path d="M100 58 v12"/>
      <path d="M74 78 H126"/>
      <path d="M100 70 v68"/>
      <path d="M74 78 L42 98 L34 136"/>
      <path d="M126 78 L158 98 L166 136"/>
      ${flecha(80, 64, 48, 56)}
      ${flecha(120, 64, 152, 56)}`),
  },
  {
    id: "ojos",
    zona: "Ojos",
    nombre: "Descanso visual",
    instruccion: "Mira algo lejano 20 segundos. Luego parpadea diez veces.",
    segundos: 30,
    svg: marco(`
      <path d="M18 88 C 50 42 114 42 146 88 C 114 134 50 134 18 88 Z"/>
      <circle cx="82" cy="88" r="24"/>
      <circle cx="82" cy="88" r="9" fill="currentColor" stroke="none"/>
      ${flecha(158, 60, 188, 60)}
      ${flecha(158, 88, 192, 88)}
      ${flecha(158, 116, 188, 116)}`),
  },
  {
    id: "piernas",
    zona: "Piernas",
    nombre: "Extensión de piernas",
    instruccion: "Sentado, estira una pierna y sostenla. Cambia de lado.",
    segundos: 30,
    svg: marco(`
      <path d="M28 118 V50" stroke-width="3.5"/>
      <path d="M28 118 H92" stroke-width="3.5"/>
      <path d="M38 118 v38 M86 118 v38" stroke-width="3.5"/>
      <circle cx="62" cy="42" r="17"/>
      <path d="M62 59 L66 112"/>
      <path d="M66 112 H102"/>
      <path d="M102 112 L162 92"/>
      <path d="M162 92 l10 -18"/>
      ${flecha(116, 74, 160, 60)}`),
  },
];

export const SEGUNDOS_TOTALES = EJERCICIOS.reduce((t, e) => t + e.segundos, 0);

/** Las 6 zonas del reporte de molestias (M5). */
export const ZONAS_MOLESTIA = [
  "Cuello",
  "Hombros",
  "Espalda alta",
  "Espalda baja",
  "Muñecas",
  "Ojos",
] as const;

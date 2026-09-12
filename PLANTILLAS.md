# Plantillas de WhatsApp para aprobación de Meta

Dos plantillas, listas para copiar y pegar en WhatsApp Manager. El texto está
redactado contra las reglas de rechazo y de categorización de Meta vigentes a
septiembre de 2026.

---

## 1. `recordatorio_pausa`

**Es la que importa.** Se envía hasta 3 veces al día por empleado: 100 mensajes
en el piloto y 750.000 al año a escala de contrato. Aquí es donde la categoría
decide el margen.

| Campo | Valor |
|---|---|
| Nombre | `recordatorio_pausa` |
| Categoría | **Utility** |
| Idioma | Español (COL) — `es_CO` |
| Encabezado | ninguno |
| Pie de página | ninguno |

**Cuerpo**

```
Hola {{1}}. Es la hora de tu pausa activa programada de las {{2}}, dentro del programa de seguridad y salud en el trabajo de {{3}}. La rutina guiada toma 3 minutos.
```

**Valores de ejemplo** (Meta los exige para revisar):

| Variable | Ejemplo |
|---|---|
| `{{1}}` | `Ana Ruiz` |
| `{{2}}` | `10:00` |
| `{{3}}` | `Textiles del Norte SAS` |

**Botones** — tipo *Respuesta rápida*, **en este orden exacto**:

| Índice | Texto |
|---|---|
| 0 | `Hacer pausa (3 min)` |
| 1 | `Ahora no puedo` |

---

## 2. `optin_programa_pausas`

Se envía una sola vez por empleado: 20 mensajes en todo el piloto.

| Campo | Valor |
|---|---|
| Nombre | `optin_programa_pausas` |
| Categoría | **Utility** (lee abajo por qué probablemente salga Marketing) |
| Idioma | Español (COL) — `es_CO` |
| Encabezado | ninguno |
| Pie de página | ninguno |

**Cuerpo**

```
Hola {{1}}. La empresa {{2}} activó su programa de pausas activas por WhatsApp, dentro de su sistema de seguridad y salud en el trabajo. Si aceptas, te escribiremos 3 veces al día en días hábiles con una rutina guiada de 3 minutos. Registramos tu participación y las molestias físicas que reportes, únicamente como evidencia del programa ante auditoría. Puedes escribir SALIR en cualquier momento para dejar de recibir los mensajes.
```

**Valores de ejemplo**

| Variable | Ejemplo |
|---|---|
| `{{1}}` | `Ana Ruiz` |
| `{{2}}` | `Textiles del Norte SAS` |

**Botones** — tipo *Respuesta rápida*, **en este orden exacto**:

| Índice | Texto |
|---|---|
| 0 | `Sí, participo` |
| 1 | `No, gracias` |

---

## El orden de los botones no es cosmético

El código manda el `payload` de cada botón **por posición**: al índice 0 le
asigna `optin_si` / `pausa_hacer`, y al índice 1 `optin_no` / `pausa_no`. Meta no
guarda identificadores propios en la plantilla — el payload lo pone quien envía.

Si en el formulario de Meta inviertes el orden, tocar "No, gracias" va a llegar
al servidor como "sí participo", y el empleado queda inscrito cuando dijo que no.
**Revisa el orden antes de enviar a aprobación**, porque cambiarlo después
significa una plantilla nueva y otra ronda de revisión.

Los nombres tienen que coincidir exactamente con `wrangler.toml`:

```toml
PLANTILLA_OPTIN = "optin_programa_pausas"
PLANTILLA_RECORDATORIO = "recordatorio_pausa"
```

---

## Por qué el texto está escrito así

**No empieza ni termina en variable.** Meta rechaza automáticamente las
plantillas con "parámetros colgantes" — `{{1}}` al principio o al final sin texto
alrededor. La redacción que traía el PRD (`{{1}}, es la hora de tu pausa...`)
**se habría rechazado por esto**, y son 24 horas perdidas por una coma.

**Ninguna variable pega con otra.** `{{1}} {{2}}` seguidas también se marca.

**Nada promocional.** Meta escanea intención comercial y recategoriza solo. Sin
emojis decorativos, sin marca del producto, sin "aprovecha", sin "exclusivo", sin
signos de admiración. Tono de notificación de servicio: qué, cuándo, cuánto dura.

**Nombra el programa concreto.** "el programa de seguridad y salud en el trabajo
de `{{3}}`" ata el mensaje a una relación que ya existe entre el empleado y su
empleador, que es exactamente lo que distingue Utility de Marketing.

**Una sola acción.** Hacer la pausa. Nada más.

---

## Lo que debes esperar de la categorización

`recordatorio_pausa` tiene buenas probabilidades de quedar **Utility**: es un
aviso factual sobre un evento programado dentro de un programa en el que la
persona ya se inscribió. Es el caso de uso canónico de Utility.

`optin_programa_pausas` **probablemente salga Marketing**, y conviene que lo
asumas de entrada. Meta clasifica como Utility los mensajes que confirman algo
que el usuario inició; este pide permiso para algo que inició el empleador. Es
una solicitud, y lee como tal.

No pelees esa: **son 20 mensajes en todo el piloto, unos USD 0,25 de diferencia.**
No puedes evitarlo redactándolo como "ya estás inscrito, sal si no quieres",
porque las molestias son dato de salud y la Ley 1581 exige autorización expresa
y afirmativa. El costo de la categoría es más barato que el problema legal.

**Verifica la categoría asignada en WhatsApp Manager después de la aprobación.**
Si `recordatorio_pausa` sale Marketing, apela antes de lanzar: ahí sí se te va el
margen (16× por mensaje) y además las plantillas de marketing degradan el
*quality rating* del número, que con 3 mensajes diarios termina en límites de
frecuencia.

### Si rechazan o recategorizan `recordatorio_pausa`

Redacción alterna, más seca todavía:

```
Hola {{1}}. Pausa activa programada de las {{2}} en el programa de seguridad y salud en el trabajo de {{3}}. La rutina toma 3 minutos.
```

---

## Dos cosas que cambian el cálculo

### El 1 de octubre de 2026 se acaba lo gratis dentro de la ventana

Desde julio de 2025, las plantillas Utility enviadas dentro de la ventana de
servicio de 24 h no se cobran. **Eso termina el 1 de octubre de 2026**: Meta
empieza a cobrar tanto las plantillas Utility como los mensajes libres enviados
dentro de la ventana, con 1.000 mensajes de servicio gratis al mes por número.

Es dentro de tres semanas, y afecta el pilar del diseño: mandamos mensajes
interactivos libres dentro de la ventana justamente porque eran gratis.

Qué cambia en la práctica:

- **El piloto**: nada. Son ~470 mensajes, por debajo de los 1.000 gratis.
- **A escala de contrato** (1.000 empleados, 3 mensajes/día): pasan a ser
  facturables los 750.000 del año en vez de 250.000. Con tarifa Utility en
  Colombia son del orden de USD 600–2.250 al año, contra los USD 24.000 de
  ingreso anual. El margen sigue arriba del 90%, pero la cuenta del PRD que
  asumía "2 de cada 3 mensajes gratis" ya no aplica.
- **Si sale Marketing**: ahí sí duele, porque nunca hubo gratis y la tarifa es
  16× mayor.

### Para la v1: un botón de URL en vez de dos mensajes

Hoy el flujo son dos mensajes: la plantilla con "Hacer pausa", y luego un mensaje
libre con el link de la rutina. Meta permite mezclar un botón de URL con
variable al final con botones de respuesta rápida en la misma plantilla, así que
el link único podría ir dentro de la plantilla y ahorrarse el segundo mensaje y
un toque del empleado.

No lo hacemos ahora por tres razones: la URL queda congelada en la plantilla
aprobada, así que mudarse a un dominio propio obliga a una plantilla nueva; un
toque en un botón de URL no genera evento de webhook, así que se pierde la
columna "confirmadas por el empleado" que el PRD quiere comparar contra el
cronómetro; y el segundo mensaje todavía es gratis hasta octubre. Después de esa
fecha y con el dominio estable, vale la pena.

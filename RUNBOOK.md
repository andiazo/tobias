# Runbook del piloto

Lo que te toca a ti, en orden, para pasar de este repo a 20 personas haciendo
pausas activas. Escrito para seguirse de arriba abajo.

También está como checklist con progreso guardado:
https://claude.ai/code/artifact/c88fb45d-ca52-4a16-93ce-8a71951ca735

**Tiempo de manos a la obra: ~1 h 45 min**, o 2 h 15 contando el ensayo en seco.
Presupuesta media jornada la primera vez, por los dos puntos ciegos: si Kapso
reenvía la firma de Meta, y si el `phone_number_id` es el correcto.
La aprobación de plantillas de Meta son 2–24 h de espera de calendario, no de
trabajo tuyo, y por eso va primero.

---

## Bloque 0 · Hoy, antes de tocar código (~30 min)

### 0.1 Rota las credenciales que pegaste en el chat · 2 min
El token de Cloudflare y la API key de Kapso quedaron en el historial de una
conversación. No alcanzaron a usarse, pero rótalas igual.

### 0.2 Manda las 2 plantillas a aprobación de Meta · 15 min
**Es el camino crítico. Todo lo demás depende de esto y no depende de ti.**

**El texto exacto, los valores de ejemplo y el orden de los botones están en
[`PLANTILLAS.md`](PLANTILLAS.md).** Cópialo de ahí: la redacción del PRD empezaba
con una variable, que Meta rechaza automáticamente.

En WhatsApp Manager, idioma `es_CO`, categoría `UTILITY`:

`optin_programa_pausas`
> `{{1}}`, `{{2}}` activa su programa de pausas activas por WhatsApp. Te
> escribiremos 3 veces al día en días hábiles con una rutina de 3 minutos.
> Guardamos tu participación y las molestias que reportes para la evidencia del
> SG-SST. Responde para confirmar si quieres participar.
> [Sí, participo] [No, gracias]

`recordatorio_pausa`
> `{{1}}`, es la hora de tu pausa activa programada de las `{{2}}` en el
> programa de SST de `{{3}}`. La rutina toma 3 minutos.
> [Hacer pausa (3 min)] [Ahora no puedo]

Reglas para que salga `UTILITY` y no `MARKETING` (16× más caro): nombra el
programa específico, cero emojis decorativos, cero marca del producto, cero
"¡aprovecha!", tono de notificación de servicio.

**Cuando aprueben, verifica la categoría asignada en WhatsApp Manager.** Si sale
`MARKETING`, apela antes de lanzar.

### 0.3 Confirma el plan Workers Paid · 3 min
USD 5/mes. En plan Free las consultas a D1 **fallan con error** al pasar el
límite diario de filas, hasta medianoche UTC. Con un cliente pagando no es un
modo de falla aceptable por USD 5.

### 0.4 Crea el Google Form de ergonomía · 10 min
1 foto del puesto + 5 preguntas cerradas: altura de pantalla, tipo de silla,
portátil sin base, apoyo de muñecas, iluminación.

---

## Bloque 1 · Desplegar (~20 min)

```bash
git clone https://github.com/andiazo/tobias.git
cd tobias
git checkout claude/new-session-k5mied
npm install

export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...    # el nuevo
export KAPSO_API_KEY=...           # la nueva
./scripts/deploy.sh
```

El script crea la base D1, aplica migraciones, genera y guarda los secretos,
despliega dos veces (la segunda ya con la URL pública resuelta) y crea la
empresa del piloto. Es idempotente: si algo falla a mitad, vuelve a correrlo.

Al final imprime cuatro cosas. **Guárdalas en tu gestor de contraseñas antes de
cerrar la terminal** — los secretos de Worker no se pueden volver a leer:

- URL del Worker
- URL del webhook, con el `?k=` incluido
- Verify token
- `ADMIN_TOKEN`

> Si es la primera vez que usas `workers.dev` en esa cuenta, wrangler te va a
> pedir que registres un subdominio. Es un paso interactivo, normal.

### En Windows: `deploy.sh` no corre en CMD ni en PowerShell

Es un script de bash. Dos salidas:

**a) Git Bash** (viene con Git para Windows, ya lo tienes si clonaste). Abre la
carpeta del repo, clic derecho → *Git Bash Here*, y corre los mismos comandos de
arriba tal cual.

**b) Paso a paso en CMD.** El bloque completo está más abajo, en
[Despliegue manual en CMD](#despliegue-manual-en-cmd).

### Completa `wrangler.toml` y vuelve a desplegar · 3 min
Solo si el script no lo dejó bien:

```toml
WHATSAPP_PHONE_NUMBER_ID = "1317600904767169"
PUBLIC_BASE_URL = "https://<tu-worker>.workers.dev"
```

```bash
npx wrangler deploy
curl https://<tu-worker>.workers.dev/health
```

---

### Despliegue manual en CMD

Los mismos seis pasos del script, a mano. Ojo con `set` en CMD: sin comillas y
sin espacios alrededor del `=`, o las comillas quedan dentro del valor.

```bat
git clone https://github.com/andiazo/tobias.git
cd tobias
git checkout claude/new-session-k5mied
npm install

set CLOUDFLARE_ACCOUNT_ID=a2af22052e5e28e0c34f74d1ac9ab8e2
set CLOUDFLARE_API_TOKEN=pega-aqui-el-token

:: 1. Base de datos. Copia el database_id que imprime.
npx wrangler d1 create pausas-activas
node scripts/config.mjs database_id PEGA-EL-ID-AQUI

:: 2. Migraciones
npx wrangler d1 migrations apply pausas-activas --remote

:: 3. Genera tres secretos y guardalos antes de seguir
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

:: 4. Guardalos. Cada comando pregunta y tu pegas el valor.
npx wrangler secret put KAPSO_API_KEY
npx wrangler secret put TOKEN_SECRET
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put WEBHOOK_VERIFY_TOKEN
npx wrangler secret put WEBHOOK_SECRETO_URL

:: 5. Despliega y copia la URL que imprime
npx wrangler deploy
node scripts/config.mjs PUBLIC_BASE_URL https://TU-URL.workers.dev
npx wrangler deploy

:: 6. Verifica y crea la empresa
set W=https://TU-URL.workers.dev
set A=el-admin-token-que-generaste
curl %W%/health
curl -X POST "%W%/admin/empresa" -H "authorization: Bearer %A%" -H "content-type: application/json" -d "{\"nombre\":\"Empresa Piloto SAS\",\"horarios\":[\"10:00\",\"14:30\",\"16:30\"]}"
```

`node scripts/config.mjs` sin argumentos te muestra cómo quedó la configuración.

---

## Bloque 2 · Conectar Kapso (~20 min)

En Kapso, apunta el webhook a la URL **completa con el `?k=`**:

```
https://<tu-worker>.workers.dev/webhook/kapso?k=<WEBHOOK_SECRETO_URL>
```

con el verify token que imprimió el script.

**Verifica que el handshake pasó**: Kapso debe marcar el webhook como
verificado. Si no, revisa que el verify token coincida exactamente.

### Punto ciego: ¿Kapso reenvía la firma de Meta? · 10 min
No pude comprobarlo desde aquí. Revisa la documentación de Kapso o mándate un
mensaje de prueba y mira los headers que llegan:

```bash
npx wrangler tail
```

- **Si llega `X-Hub-Signature-256` firmado con tu app secret de Meta**:
  `npx wrangler secret put META_APP_SECRET` y quedas con doble cerradura.
- **Si Kapso firma con su propio esquema**: dime cuál y lo implemento.
- **Si no firma nada**: el `?k=` es lo que mantiene el webhook cerrado. Es
  suficiente para el piloto siempre que la URL no se comparta ni quede en un
  ticket, un Slack público o una captura.

---

## Bloque 3 · Prueba de humo con tu propio celular (~15 min)

```bash
W=https://<tu-worker>.workers.dev
A=<ADMIN_TOKEN>
```

**1. Crea la empresa** (si el script no la creó como quieres):
```bash
curl -X POST $W/admin/empresa -H "authorization: Bearer $A" \
  -H 'content-type: application/json' \
  -d '{"nombre":"Empresa Piloto SAS","nit":"900000000-0","horarios":["10:00","14:30","16:30"]}'
```
Guarda el `reporteToken` que devuelve: es la URL del reporte de SST.

**2. Escribe "Hola" al número desde tu celular.** Debe llegarte el opt-in con
dos botones en segundos.

**3. Toca "Sí, participo".** Debe llegar la confirmación.

**4. Dispara un recordatorio sin esperar al cron:**
```bash
curl -X POST $W/admin/recordatorio -H "authorization: Bearer $A" \
  -H 'content-type: application/json' -d '{"telefono":"+57300XXXXXXX"}'
```

**5. Toca "Hacer pausa", abre el link y haz la rutina completa.** No la saltes:
el servidor no cuenta como completada una pausa de menos de 120 segundos.

**6. Reporta una molestia** al final. Debe llegarte confirmación por WhatsApp.

**7. Abre el reporte** en `$W/r/<reporteToken>` y descarga el CSV.

**8. Revisa el estado crudo:**
```bash
curl "$W/admin/estado?telefono=%2B57300XXXXXXX" -H "authorization: Bearer $A"
```

Si los ocho pasos funcionan, el motor está bien.

---

## Bloque 4 · Antes de los 20 sujetos (no te saltes esto)

### 4.1 Apaga el modo prueba
En `wrangler.toml`: `MODO_PRUEBA = "false"`, luego `npx wrangler deploy`.

Con `true`, **cualquier número desconocido que escriba al WhatsApp queda
registrado como empleado** de la primera empresa. Sirve para probar; en el
piloto real significa que un número equivocado entra al programa.

### 4.2 Confirma que el `phone_number_id` es el correcto
Pusiste `1317600904767169` como "whatsapp id". Si resulta ser el WABA id y no
el phone number id, el primer envío falla con un 404 de Meta. Si el bloque 3
funcionó, ya está confirmado.

### 4.3 Ensayo en seco con 3 personas internas · 1 día
Un ciclo completo de un día con 3 compañeros antes de tocar a los 20. Revisa
zona horaria, formato de teléfonos y que el cron dispare a las horas correctas.

### 4.4 Carga el CSV de RR.HH.
```bash
BASE_URL=$W ADMIN_TOKEN=$A npm run seed:empleados -- empleados.csv
```
Prueba primero con `--sin-optin` para revisar el parseo sin escribirle a nadie.

### 4.5 Registra el conteo del Form de ergonomía
```bash
curl -X POST $W/admin/ergonomia -H "authorization: Bearer $A" \
  -H 'content-type: application/json' \
  -d '{"url":"https://forms.gle/...","enviados":20,"respuestas":0}'
```
El `respuestas` lo actualizas a mano durante el piloto; el Form vive fuera del
sistema.

---

## Lo que tienes que considerar antes de producción

### 1. Sin plantillas aprobadas el piloto no se sostiene · CRÍTICO
Hoy el motor solo puede escribir dentro de la ventana de servicio de 24 h, que
se abre cuando el empleado escribe o toca un botón.

La cadena funciona así: si alguien interactúa el lunes a las 16:30, la ventana
llega hasta el martes a las 16:30, así que los recordatorios del martes a las
10:00 y 14:30 salen gratis. Mientras interactúe todos los días, la cadena se
sostiene sola.

**El problema es el día que alguien no responde.** La ventana se cierra y esa
persona deja de recibir **cualquier** mensaje hasta que vuelva a escribir. No es
solo que no participe: es que su adherencia queda en 0% y **no vas a poder
distinguir "ignoró el recordatorio" de "nunca le llegó"**. Con 20 personas y 5
días, eso contamina justo la métrica del día 5.

Las plantillas son lo único que rompe esa dependencia. Por eso el bloque 0.2 va
primero.

### 2. El reporte de SST es una URL pública con datos nominales
Cualquiera con el link ve nombres, áreas y adherencia individual; el CSV además
lleva cédulas. No hay login por diseño, y **no hay forma de revocar el token
desde la interfaz** — habría que cambiarlo a mano en la base.

Trátalo como el documento sensible que es: mándalo por un canal privado a la
persona de SST y no lo pegues en un Slack compartido.

### 3. Las molestias son dato de salud (Ley 1581 de 2012)
Exigen autorización expresa. El texto del opt-in la pide y `consentimiento_at`
la fecha. Dos cosas que quedan pendientes:

- **La retención de 60 días no está automatizada.** No hay job de borrado. Si la
  empresa no continúa, hay que borrar a mano.
- El texto del opt-in es mi redacción, no la de un abogado. Si vas a vender esto
  con contrato, que alguien lo revise.

### 4. Qué mirar durante el piloto
```bash
npx wrangler tail                                    # en vivo
curl "$W/admin/estado?telefono=%2B57..." -H "..."   # un empleado
$W/r/<reporteToken>                                  # el reporte
```
Los eventos que importan en los logs: `plantilla_no_disponible` (alguien se cayó
de la ventana), `error_envio`, `pausa_demasiado_rapida`.

### 5. Costo
USD 5/mes de Cloudflare + entre USD 0,10 y 0,36 de Meta si las plantillas salen
`UTILITY`. Kapso en plan Free cubre los ~470 mensajes del piloto. Total ≈ USD 5–7.

### 6. Un número para todos los pilotos
Todos salen del mismo número de WhatsApp. Si metes una segunda empresa, los
empleados de ambas le escriben al mismo contacto.

---

## Resumen de tiempos

| Bloque | Tuyo | Espera |
|---|---|---|
| 0 · Rotar, plantillas, plan, Form | 30 min | 2–24 h (Meta) |
| 1 · Desplegar | 20 min | — |
| 2 · Kapso + firma del webhook | 20 min | — |
| 3 · Prueba de humo | 15 min | — |
| 4 · Modo prueba, CSV, ergonomía | 20 min | — |
| Ensayo en seco con 3 internos | 30 min | 1 día |
| **Total de manos a la obra** | **2 h 15 min** | ≈ 2 días de calendario |

Camino más corto a "funcionando con tu celular": **bloques 1 a 3, unos 55
minutos.** El resto es lo que separa una demo de un piloto.

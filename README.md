# Pausas Activas — motor de WhatsApp (Kapso)

Worker de Cloudflare que corre el programa de pausas activas por WhatsApp:
recordatorios, consentimiento, ventana de servicio de 24 h y registro de evidencia.

Este repo cubre hoy **M0 (infraestructura y modelo de datos)** y **M1 (canal
WhatsApp: envío, webhook y ventana)** del PRD, más lo mínimo de M2/M3/M4 que hace
falta para cerrar un ciclo completo de punta a punta.

## Estado por módulo

| Módulo | Estado |
|---|---|
| M0 · Infra y modelo de datos | completo — 5 tablas, 4 índices, `/health`, cron `*/15` |
| M1 · Canal WhatsApp | completo — envío, webhook con firma, ventana de 24 h, log de eventos |
| M2 · Consentimiento | completo — opt-in, `SALIR`, reingreso y carga por CSV |
| M3 · Cron | completo — programa por horario, días hábiles, idempotente, barre vencidas |
| M4 · Webapp de la pausa | completo — 6 ejercicios, cronómetro, celebración, XP, `sendBeacon` |
| M5 · Molestias | completo — 6 zonas, comentario ≤200, confirmación por WhatsApp |
| M6 · Reporte SST | completo — HTML sin login, CSV fechado, filtro por rango |
| M7 · Plantillas Meta | pendiente — trabajo externo, no hay código que escribir |

Lo único que falta del MVP es M7: enviar las 2 plantillas a aprobación de Meta,
crear el Google Form y hacer el ensayo en seco. Nada de eso es código.

## Modo prueba: sin plantillas aprobadas

Las plantillas de Meta todavía no existen, así que el motor opera **solo dentro de
la ventana de servicio de 24 h**: el empleado escribe primero al número, eso abre
la ventana, y a partir de ahí el bot responde con mensajes interactivos libres.

Con `MODO_PRUEBA = "true"`, un número desconocido que escribe queda registrado
automáticamente como empleado de la primera empresa y recibe el opt-in. **Apagar
esto antes del piloto real**, donde los empleados entran por CSV.

Cuando las plantillas estén aprobadas, basta con poner sus nombres en
`PLANTILLA_OPTIN` y `PLANTILLA_RECORDATORIO` (`wrangler.toml`): `canalPara()` ya
elige plantilla cuando la ventana está cerrada. Mientras estén vacías, un envío
fuera de ventana falla con un error explícito (`PlantillaNoDisponible`) en vez de
fallar en silencio.

## Puesta en marcha

Todo el despliegue en un comando:

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
export KAPSO_API_KEY=...
./scripts/deploy.sh
```

Crea la base D1, aplica migraciones, genera y guarda los secretos, despliega dos
veces (la segunda ya con `PUBLIC_BASE_URL`), crea la empresa del piloto e imprime
la URL del webhook y el `ADMIN_TOKEN`. Es idempotente.

Falta un paso manual después: apuntar el webhook de Kapso a
`https://<worker>/webhook/kapso` con el verify token que imprime el script.

### A mano, si prefieres

```bash
npm install

# 1. Base D1 — copia el database_id que imprime a wrangler.toml
npx wrangler d1 create pausas-activas
npm run db:migrate

# 2. Secretos
npx wrangler secret put KAPSO_API_KEY        # X-API-Key del proxy de Kapso
npx wrangler secret put TOKEN_SECRET         # cualquier cadena aleatoria larga
npx wrangler secret put ADMIN_TOKEN          # protege /admin/*
npx wrangler secret put WEBHOOK_VERIFY_TOKEN # hub.verify_token del webhook
npx wrangler secret put META_APP_SECRET      # ver aviso abajo

# 3. Completa en wrangler.toml [vars]:
#    WHATSAPP_PHONE_NUMBER_ID y PUBLIC_BASE_URL (la URL pública del Worker)

npm run deploy
```

En Kapso, apunta el webhook a `https://<tu-worker>/webhook/kapso`. La ruta responde
el handshake `GET` con `hub.verify_token`.

> **`META_APP_SECRET` antes del piloto real.** Si no está configurado, el webhook
> acepta cualquier `POST` sin verificar `X-Hub-Signature-256`: quien conozca la URL
> puede fabricar un evento y hacer que el Worker envíe mensajes. Está así para
> poder arrancar sin el app secret de Meta, y el Worker lo avisa en los logs.
> Configúralo antes de cargar empleados reales.

## Probar

```bash
# 1. Crea la empresa
curl -X POST https://<worker>/admin/empresa \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"nombre":"Empresa Piloto SAS","horarios":["10:00","14:30","16:30"]}'

# 2. Escribe "Hola" al número de WhatsApp desde tu celular.
#    Abre la ventana, te registra y te llega el opt-in con dos botones.

# 3. Toca "Sí, participo", y luego dispara un recordatorio sin esperar al cron:
curl -X POST https://<worker>/admin/recordatorio \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"telefono":"+57300XXXXXXX"}'

# 4. Revisa el estado completo del empleado
curl "https://<worker>/admin/estado?telefono=%2B57300XXXXXXX" \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### Cargar empleados desde el CSV de RR.HH.

```bash
BASE_URL=https://<worker> ADMIN_TOKEN=... \
  npm run seed:empleados -- empleados.csv
```

El CSV necesita encabezado con `nombre`, `cedula`, `telefono` y `area` (acepta
los sinónimos habituales de un export de RR.HH.: `celular`, `documento`,
`dependencia`…). Normaliza a E.164 asumiendo +57 cuando faltan indicativos,
rechaza las filas sin nombre o con teléfono inválido sin abortar el resto, avisa
de los repetidos y es idempotente por teléfono: volver a correrlo no duplica.
Con `--sin-optin` carga sin enviar nada, para revisar antes de escribirle a nadie.

Mientras no haya plantillas aprobadas, el opt-in de una carga por CSV **no puede
salir**: la ventana de esos números está cerrada. El script lo dice fila por fila
en vez de fallar en silencio. Hasta entonces, el empleado tiene que escribir
primero.

### Ciclo completo en local, sin gastar mensajes

`scripts/mock-kapso.mjs` levanta un servidor que imita las respuestas de la Cloud
API y guarda lo que se le envía; `scripts/e2e-local.mjs` corre los 19 chequeos del
ciclo (firma, alta, ventana, opt-in, idempotencia por `wamid`, recordatorio, link
con token, `iniciada` → `completada`, token vencido, `SALIR`).

```bash
npx wrangler d1 migrations apply pausas-activas --local
npm run mock:kapso &
npx wrangler dev --port 8787 --local \
  --var KAPSO_BASE_URL:http://127.0.0.1:8788 \
  --var WHATSAPP_PHONE_NUMBER_ID:123456 \
  --var PUBLIC_BASE_URL:http://127.0.0.1:8787 &

npm run test:local      # canal: firma, alta, ventana, opt-in, SALIR
npm run test:cron       # horarios, días hábiles, idempotencia, barrido
npm run test:pausa      # rutina, sendBeacon, molestias
npm run test:reporte    # agregaciones, orden, CSV, zona horaria
npm run test:navegador  # lo mismo en Chromium a 390px de ancho
```

Cada suite limpia la base al arrancar (`POST /admin/reset`, solo con
`MODO_PRUEBA`), así que se pueden correr en cualquier orden y las veces que
haga falta. `test:navegador` acepta `CHROMIUM=<ruta>` si Playwright no
encuentra el binario, y `CAPTURAS=<dir>` para guardar pantallazos.

Necesita `.dev.vars` (copia `.dev.vars.example`) con los valores que usa el test:
`ADMIN_TOKEN=local-admin`, `META_APP_SECRET=local-app-secret`,
`TOKEN_SECRET=local-token-secret`.

## Rutas

| Ruta | Para qué |
|---|---|
| `GET /health` | health check |
| `GET /webhook/kapso` | handshake de verificación de Meta |
| `POST /webhook/kapso` | eventos entrantes: firma, log y router |
| `GET /r/:token` | reporte de evidencia para SST, sin login |
| `GET /r/:token/export.csv` | una fila por pausa, con `?desde=` y `?hasta=` |
| `GET /p/:token` | rutina de la pausa (token HMAC, expira en 60 min) |
| `POST /p/:token/done` | marca la pausa completada |
| `POST /p/:token/avance` | `sendBeacon` al cerrar: hasta qué ejercicio llegó |
| `POST /p/:token/molestia` | reporta molestia y confirma por WhatsApp |
| `POST /admin/empresa` | crea la empresa del piloto |
| `POST /admin/empleado` | carga un empleado y le manda el opt-in |
| `POST /admin/recordatorio` | dispara un recordatorio sin esperar al cron |
| `POST /admin/tick` | corre un tick del cron, con `ahora` opcional para simular |
| `POST /admin/consentimiento` | marca consentimiento a mano (solo `MODO_PRUEBA`) |
| `POST /admin/ergonomia` | link del Form y conteo de respuestas |
| `POST /admin/reset` | borra todos los datos (solo `MODO_PRUEBA`) |

Para correr los tests en local hay que bajar el mínimo de duración, o las
pausas de prueba nunca se completan:
`npx wrangler dev --var SEGUNDOS_MINIMOS_PAUSA:3 …` (ya está en el comando de
arriba).
| `GET /admin/estado` | consentimiento, ventana, pausas y últimos eventos |

Las rutas `/admin/*` exigen `Authorization: Bearer $ADMIN_TOKEN`.

## Notas de implementación

- **Ventana de 24 h.** Todo mensaje entrante empuja `ventana_abierta_hasta` a
  `now + 24 h`. `canalPara()` decide libre vs plantilla con ese campo. Es la
  diferencia entre ~USD 200 y ~USD 11.800 al año a escala de contrato.
- **Idempotencia.** El webhook descarta `wamid` repetidos (`mensajes_procesados`)
  porque Meta reintenta; las pausas son únicas por `(empleado_id, fecha, bloque)`.
- **`fetch` atado.** El SDK de Kapso guarda `globalThis.fetch` desagregado y
  Workers lo rechaza con *Illegal invocation*; `clienteKapso()` lo pasa ya atado.
- **Respuesta rápida al webhook.** Se responde `200` y el trabajo va en
  `waitUntil`, para que Meta no reintente por lentitud.
- **Tokens.** HMAC-SHA256 con WebCrypto. Sin sesiones, sin cookies, sin login.
- **Duración mínima, verificada en el servidor.** `POST /p/:token/done` solo marca
  `completada` si pasaron al menos `SEGUNDOS_MINIMOS_PAUSA` (120 por defecto)
  desde que se abrió la rutina. Sin esto, tocar "Saltar" seis veces dejaba la
  pausa como completada y la columna del cronómetro no valía como evidencia.
  El intento queda en `eventos` como `pausa_demasiado_rapida`.
- **Gamificación acotada a la sesión.** Progreso, celebración, XP y bono por no
  saltarse ninguno viven dentro de la rutina y se pierden al cerrarla. No hay
  rachas entre días ni ranking entre empleados: eso es lo que el PRD excluye
  por inflar la adherencia del piloto y contaminar la métrica del día 5.
- **Sonido apagado por defecto.** Esto se abre en una oficina abierta. El
  empleado lo enciende si quiere y la decisión queda en `localStorage`.
- **Tick de 15 min.** El cron no dispara exacto, así que la hora local se redondea
  hacia abajo al múltiplo de 15: si llega a las 10:07, el bloque sigue siendo el
  de las 10:00.
- **Fechas locales vs UTC.** `pausas.fecha` se guarda en hora local de la empresa
  y `created_at` en UTC. El reporte traduce los límites del rango a instantes UTC
  del día local: si no, una molestia reportada a las 8 de la noche en Bogotá cae
  en el día UTC siguiente y desaparece del reporte.
- **Confirmada ≠ completada.** Tocar "Hacer pausa" marca `confirmada_at`; terminar
  el cronómetro marca `completada_at`. El reporte muestra las dos columnas por
  separado y la brecha entre ellas, que es la métrica que dice si el botón sirve
  como evidencia.
- **Ilustraciones en línea.** Los 6 SVG viajan dentro del HTML en vez de servirse
  como assets. Son menos de 1 KB cada uno; como archivos sueltos costarían 6
  peticiones extra en una conexión móvil. Por eso no hay binding de Static Assets.

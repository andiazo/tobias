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
| M2 · Consentimiento | opt-in, `SALIR` y reingreso funcionando; falta el seed por CSV |
| M3 · Cron | el barrido de vencidas corre; falta programar por horario |
| M4 · Webapp de la pausa | esqueleto: valida token, marca `iniciada` y `completada`. Faltan los 6 ejercicios |
| M5 · Molestias | pendiente |
| M6 · Reporte SST | pendiente |
| M7 · Plantillas Meta | pendiente (trabajo externo) |

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
npx wrangler secret put META_APP_SECRET      # opcional: si está, la firma es obligatoria

# 3. Completa en wrangler.toml [vars]:
#    WHATSAPP_PHONE_NUMBER_ID y PUBLIC_BASE_URL (la URL pública del Worker)

npm run deploy
```

En Kapso, apunta el webhook a `https://<tu-worker>/webhook/kapso`. La ruta responde
el handshake `GET` con `hub.verify_token` y verifica `X-Hub-Signature-256` en cada
`POST` si `META_APP_SECRET` está configurado.

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
npm run test:local
```

Necesita `.dev.vars` (copia `.dev.vars.example`) con los valores que usa el test:
`ADMIN_TOKEN=local-admin`, `META_APP_SECRET=local-app-secret`,
`TOKEN_SECRET=local-token-secret`.

## Rutas

| Ruta | Para qué |
|---|---|
| `GET /health` | health check |
| `GET /webhook/kapso` | handshake de verificación de Meta |
| `POST /webhook/kapso` | eventos entrantes: firma, log y router |
| `GET /p/:token` | rutina de la pausa (token HMAC, expira en 60 min) |
| `POST /p/:token/done` | marca la pausa completada |
| `POST /admin/empresa` | crea la empresa del piloto |
| `POST /admin/empleado` | carga un empleado y le manda el opt-in |
| `POST /admin/recordatorio` | dispara un recordatorio sin esperar al cron |
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

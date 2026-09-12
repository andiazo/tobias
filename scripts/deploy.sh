#!/usr/bin/env bash
# Despliegue completo del motor, de cero a un Worker respondiendo.
# Corre esto en tu maquina, no en un entorno con la red restringida.
#
#   export CLOUDFLARE_ACCOUNT_ID=...
#   export CLOUDFLARE_API_TOKEN=...
#   export KAPSO_API_KEY=...
#   ./scripts/deploy.sh
#
# Es idempotente: si la base ya existe o los secretos ya estan puestos, sigue.
set -euo pipefail

falta() { echo "Falta la variable de entorno $1" >&2; exit 1; }
: "${CLOUDFLARE_ACCOUNT_ID:?$(falta CLOUDFLARE_ACCOUNT_ID)}"
: "${CLOUDFLARE_API_TOKEN:?$(falta CLOUDFLARE_API_TOKEN)}"
: "${KAPSO_API_KEY:?$(falta KAPSO_API_KEY)}"

cd "$(dirname "$0")/.."
aleatorio() { openssl rand -hex 32; }

echo "==> 1/6  Base de datos D1"
if grep -q 'database_id = "PENDIENTE' wrangler.toml; then
  salida=$(npx wrangler d1 create pausas-activas 2>&1 || true)
  id=$(echo "$salida" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$id" ]; then
    echo "$salida"
    echo "No pude leer el database_id. Si la base ya existia, corre 'npx wrangler d1 list'" >&2
    echo "y pega el id a mano en wrangler.toml." >&2
    exit 1
  fi
  sed -i.bak "s|database_id = \"PENDIENTE_wrangler_d1_create\"|database_id = \"$id\"|" wrangler.toml
  rm -f wrangler.toml.bak
  echo "    database_id = $id"
else
  echo "    ya configurada en wrangler.toml"
fi

echo "==> 2/6  Migraciones"
npx wrangler d1 migrations apply pausas-activas --remote

echo "==> 3/6  Secretos"
# Se generan aqui y se guardan solo en Worker Secrets.
ADMIN_TOKEN=${ADMIN_TOKEN:-$(aleatorio)}
TOKEN_SECRET=${TOKEN_SECRET:-$(aleatorio)}
WEBHOOK_VERIFY_TOKEN=${WEBHOOK_VERIFY_TOKEN:-$(aleatorio)}
WEBHOOK_SECRETO_URL=${WEBHOOK_SECRETO_URL:-$(aleatorio)}

printf '%s' "$KAPSO_API_KEY"        | npx wrangler secret put KAPSO_API_KEY
printf '%s' "$TOKEN_SECRET"         | npx wrangler secret put TOKEN_SECRET
printf '%s' "$ADMIN_TOKEN"          | npx wrangler secret put ADMIN_TOKEN
printf '%s' "$WEBHOOK_VERIFY_TOKEN" | npx wrangler secret put WEBHOOK_VERIFY_TOKEN
printf '%s' "$WEBHOOK_SECRETO_URL"  | npx wrangler secret put WEBHOOK_SECRETO_URL
# META_APP_SECRET se pone aparte cuando sepas si Kapso reenvia la firma de Meta:
#   npx wrangler secret put META_APP_SECRET
# Mientras tanto, el ?k= del webhook es lo que lo mantiene cerrado.

echo "==> 4/6  Primer deploy (para conocer la URL publica)"
# La URL la imprime el propio deploy. Si es la primera vez que usas workers.dev
# en esta cuenta, wrangler te va a pedir que registres un subdominio.
salida_deploy=$(npx wrangler deploy 2>&1 | tee /dev/tty)
url=$(echo "$salida_deploy" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1 || true)
if [ -z "$url" ]; then
  echo
  read -r -p "    No pude leer la URL del deploy. Pegala (https://...workers.dev): " url
fi
url=${url%/}

echo "==> 5/6  PUBLIC_BASE_URL = $url"
sed -i.bak "s|^PUBLIC_BASE_URL = .*|PUBLIC_BASE_URL = \"$url\"|" wrangler.toml
rm -f wrangler.toml.bak
npx wrangler deploy

echo "==> 6/6  Empresa del piloto"
curl -sS -X POST "$url/admin/empresa" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"nombre":"Empresa Piloto SAS","horarios":["10:00","14:30","16:30"]}'
echo

cat <<FIN

============================================================
Listo.

  Worker         $url
  Webhook        $url/webhook/kapso?k=$WEBHOOK_SECRETO_URL
  Verify token   $WEBHOOK_VERIFY_TOKEN
  ADMIN_TOKEN    $ADMIN_TOKEN

GUARDA ESTO AHORA en tu gestor de contraseñas. Los secretos de Worker no se
pueden volver a leer: si pierdes el ADMIN_TOKEN hay que generar otro.

Falta un paso manual: en Kapso, apunta el webhook a la URL de arriba
COMPLETA, con el ?k= incluido, y usa ese verify token.

Despues escribe "Hola" al numero desde tu celular. Eso abre la ventana
de 24 h, te registra y te llega el opt-in con dos botones.
============================================================
FIN

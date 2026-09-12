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

printf '%s' "$KAPSO_API_KEY"        | npx wrangler secret put KAPSO_API_KEY
printf '%s' "$TOKEN_SECRET"         | npx wrangler secret put TOKEN_SECRET
printf '%s' "$ADMIN_TOKEN"          | npx wrangler secret put ADMIN_TOKEN
printf '%s' "$WEBHOOK_VERIFY_TOKEN" | npx wrangler secret put WEBHOOK_VERIFY_TOKEN
# META_APP_SECRET se pone aparte cuando tengas el app secret de Meta:
#   npx wrangler secret put META_APP_SECRET
# Mientras no este, el webhook acepta POST sin verificar firma.

echo "==> 4/6  Primer deploy (para conocer la URL publica)"
npx wrangler deploy

url=$(npx wrangler deployments list --json 2>/dev/null | grep -oE 'https://[a-z0-9.-]+workers\.dev' | head -1 || true)
if [ -z "$url" ]; then
  read -r -p "    No pude detectar la URL. Pegala (https://...workers.dev): " url
fi

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

  Worker           $url
  Webhook          $url/webhook/kapso
  Verify token     $WEBHOOK_VERIFY_TOKEN
  ADMIN_TOKEN      $ADMIN_TOKEN

Guarda el ADMIN_TOKEN: es lo que te deja usar /admin/*.

Falta un paso manual: en Kapso, apunta el webhook a
  $url/webhook/kapso
con ese verify token.

Despues escribe "Hola" al numero desde tu celular. Eso abre la ventana
de 24 h, te registra y te llega el opt-in con dos botones.
============================================================
FIN

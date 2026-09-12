// Edita wrangler.toml sin pelear con sed ni con las comillas de CMD.
//
//   node scripts/config.mjs database_id 1234abcd-...
//   node scripts/config.mjs PUBLIC_BASE_URL https://mi-worker.workers.dev
//   node scripts/config.mjs MODO_PRUEBA false
//
// Sin argumentos, muestra lo que hay configurado.
import { readFileSync, writeFileSync } from "node:fs";

const ARCHIVO = "wrangler.toml";
const [clave, ...resto] = process.argv.slice(2);
const valor = resto.join(" ");

let toml = readFileSync(ARCHIVO, "utf8");

if (!clave) {
  const ver = (k) => (toml.match(new RegExp(`^${k} = (.*)$`, "m")) ?? [, "(sin definir)"])[1];
  console.log(`database_id              ${ver("database_id")}`);
  console.log(`PUBLIC_BASE_URL          ${ver("PUBLIC_BASE_URL")}`);
  console.log(`WHATSAPP_PHONE_NUMBER_ID ${ver("WHATSAPP_PHONE_NUMBER_ID")}`);
  console.log(`MODO_PRUEBA              ${ver("MODO_PRUEBA")}`);
  console.log(`PLANTILLA_OPTIN          ${ver("PLANTILLA_OPTIN")}`);
  console.log(`PLANTILLA_RECORDATORIO   ${ver("PLANTILLA_RECORDATORIO")}`);
  process.exit(0);
}

if (!valor) {
  console.error(`Falta el valor.  Uso: node scripts/config.mjs ${clave} <valor>`);
  process.exit(1);
}

const patron = new RegExp(`^${clave} = .*$`, "m");
if (!patron.test(toml)) {
  console.error(`No encuentro "${clave} = ..." en ${ARCHIVO}.`);
  process.exit(1);
}

const limpio = valor.trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
toml = toml.replace(patron, `${clave} = "${limpio}"`);
writeFileSync(ARCHIVO, toml);
console.log(`${clave} = "${limpio}"`);

// M2 - Carga de empleados desde el CSV que entrega RR.HH.
//
//   BASE_URL=https://mi-worker.workers.dev ADMIN_TOKEN=... \
//     node scripts/seed-empleados.mjs empleados.csv
//
// El CSV necesita encabezado con: nombre, cedula, telefono, area.
// El orden de las columnas da igual; sobran las que no estén en esa lista.
// Cada fila crea el empleado y le manda el opt-in. Es idempotente por teléfono:
// volver a correrlo sobre un empleado que ya existe no lo duplica.
//
// Opcional: --sin-optin carga sin enviar nada, para revisar antes de escribir.

import { readFileSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_TOKEN;
const EMPRESA = process.env.EMPRESA_ID;

const args = process.argv.slice(2);
const sinOptin = args.includes("--sin-optin");
const archivo = args.find((a) => !a.startsWith("--"));

if (!archivo) salir("Falta el archivo CSV.\n\nUso: node scripts/seed-empleados.mjs empleados.csv");
if (!TOKEN) salir("Falta ADMIN_TOKEN en el entorno.");

function salir(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

/** CSV mínimo pero correcto: comillas dobles, comas y saltos dentro del campo. */
function parsear(texto) {
  const filas = [];
  let campo = "";
  let fila = [];
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === ",") { fila.push(campo); campo = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      if (fila.some((x) => x.trim() !== "")) filas.push(fila);
      fila = []; campo = "";
      continue;
    }
    campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== "")) filas.push(fila);
  return filas;
}

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Acepta las variantes que suele traer un export de RR.HH.
const COLUMNAS = {
  nombre: ["nombre", "nombres", "nombre completo", "empleado"],
  cedula: ["cedula", "documento", "identificacion", "cc", "nro documento"],
  telefono: ["telefono", "celular", "movil", "whatsapp", "numero"],
  area: ["area", "dependencia", "cargo", "departamento"],
};

const texto = readFileSync(archivo, "utf8").replace(/^﻿/, "");
const filas = parsear(texto);
if (filas.length < 2) salir("El CSV no tiene filas de datos.");

const encabezado = filas[0].map(sinTildes);
const idx = {};
for (const [clave, alias] of Object.entries(COLUMNAS)) {
  idx[clave] = encabezado.findIndex((h) => alias.includes(h));
}
if (idx.nombre === -1) salir(`No encuentro la columna de nombre. Encabezado: ${filas[0].join(", ")}`);
if (idx.telefono === -1) salir(`No encuentro la columna de teléfono. Encabezado: ${filas[0].join(", ")}`);

const campo = (fila, clave) => (idx[clave] === -1 ? "" : (fila[idx[clave]] ?? "").trim());

/** Normaliza a E.164. Asume Colombia (+57) si vienen 10 dígitos sin indicativo. */
function normalizar(crudo) {
  const limpio = crudo.replace(/[^\d+]/g, "");
  if (limpio.startsWith("+")) return limpio;
  const d = limpio.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) return `+57${d}`;
  if (d.length === 12 && d.startsWith("57")) return `+${d}`;
  return `+${d}`;
}

const E164 = /^\+[1-9]\d{7,14}$/;

const pendientes = [];
const rechazadas = [];

filas.slice(1).forEach((fila, n) => {
  const linea = n + 2;
  const nombre = campo(fila, "nombre");
  const telefono = normalizar(campo(fila, "telefono"));

  if (!nombre) return rechazadas.push({ linea, motivo: "sin nombre" });
  if (!E164.test(telefono))
    return rechazadas.push({ linea, motivo: `teléfono inválido: "${campo(fila, "telefono")}"` });

  pendientes.push({
    nombre,
    telefono,
    cedula: campo(fila, "cedula") || undefined,
    area: campo(fila, "area") || undefined,
    ...(EMPRESA ? { empresaId: EMPRESA } : {}),
    ...(sinOptin ? { enviarOptin: false } : {}),
  });
});

const duplicados = new Set();
const vistos = new Set();
for (const p of pendientes) {
  if (vistos.has(p.telefono)) duplicados.add(p.telefono);
  vistos.add(p.telefono);
}

console.log(`${archivo}: ${pendientes.length} empleados válidos, ${rechazadas.length} filas rechazadas`);
if (duplicados.size) console.log(`Teléfonos repetidos en el archivo: ${[...duplicados].join(", ")}`);
for (const r of rechazadas) console.log(`  línea ${r.linea}: ${r.motivo}`);
if (pendientes.length === 0) process.exit(rechazadas.length ? 1 : 0);

console.log(sinOptin ? "\nCargando sin enviar opt-in...\n" : `\nCargando en ${BASE} y enviando opt-in...\n`);

let ok = 0;
const fallidos = [];

for (const p of pendientes) {
  try {
    const r = await fetch(`${BASE}/admin/empleado`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(p),
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 409) throw new Error(cuerpo.error ?? `HTTP ${r.status}`);

    const detalle =
      cuerpo.optin?.enviado === true ? `opt-in por ${cuerpo.optin.canal}`
      : cuerpo.optin === "omitido" ? "sin opt-in"
      : cuerpo.optin?.motivo ? "opt-in pendiente (ventana cerrada, falta plantilla)"
      : "cargado";
    console.log(`  ✓ ${p.nombre.padEnd(28)} ${p.telefono.padEnd(15)} ${detalle}`);
    ok++;
  } catch (error) {
    console.log(`  ✗ ${p.nombre.padEnd(28)} ${p.telefono.padEnd(15)} ${error.message}`);
    fallidos.push(p.telefono);
  }
}

console.log(`\n${ok} de ${pendientes.length} cargados.`);
if (fallidos.length) {
  console.log(`Fallaron: ${fallidos.join(", ")}`);
  console.log("Es seguro volver a correr el script: no duplica los que ya existen.");
  process.exit(1);
}

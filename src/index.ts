import { Hono } from "hono";
import type { Env } from "./env";
import { firmaValida, procesarWebhook } from "./webhook";
import { abrirPausa, completarPausa, registrarAvance, reportarMolestia } from "./pages/pausa";
import { admin } from "./admin";
import { exportarCsv, verReporte } from "./pages/reporte";
import { correrTick } from "./scheduled";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, servicio: "pausas-activas", at: new Date().toISOString() }));

// Handshake de verificacion del webhook (Meta / Kapso).
app.get("/webhook/kapso", (c) => {
  const { "hub.mode": modo, "hub.verify_token": token, "hub.challenge": reto } = c.req.query();
  if (modo === "subscribe" && token && token === c.env.WEBHOOK_VERIFY_TOKEN) {
    return c.text(reto ?? "");
  }
  return c.text("forbidden", 403);
});

app.post("/webhook/kapso", async (c) => {
  const raw = await c.req.text();

  // Si hay app secret configurado, la firma es obligatoria.
  if (c.env.META_APP_SECRET) {
    const ok = await firmaValida(raw, c.req.header("x-hub-signature-256") ?? null, c.env.META_APP_SECRET);
    if (!ok) return c.text("firma invalida", 401);
  } else {
    // Sin app secret cualquiera puede fabricar un evento y hacernos enviar
    // mensajes. Sirve para arrancar, no para el piloto con datos reales.
    console.warn("META_APP_SECRET sin configurar: el webhook acepta eventos sin verificar firma");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.text("json invalido", 400);
  }

  // Meta reintenta si tardamos: respondemos 200 y procesamos aparte.
  c.executionCtx.waitUntil(procesarWebhook(c.env, payload));
  return c.text("ok");
});

app.get("/p/:token", (c) => abrirPausa(c.env, c.req.param("token")));
app.post("/p/:token/done", (c) => completarPausa(c.env, c.req.param("token")));
app.post("/p/:token/avance", (c) => registrarAvance(c.env, c.req.param("token"), c.req.raw));
app.post("/p/:token/molestia", (c) => reportarMolestia(c.env, c.req.param("token"), c.req.raw));

app.get("/r/:token", (c) => verReporte(c.env, c.req.param("token"), new URL(c.req.url)));
app.get("/r/:token/export.csv", (c) => exportarCsv(c.env, c.req.param("token"), new URL(c.req.url)));

app.route("/admin", admin);

export default {
  fetch: app.fetch,

  // M3: cada 15 min programa los recordatorios del tick y cierra los vencidos.
  async scheduled(_evento: ScheduledController, env: Env): Promise<void> {
    const resumen = await correrTick(env);
    console.log("cron:", JSON.stringify(resumen));
  },
} satisfies ExportedHandler<Env>;

// M4 (esqueleto) - la rutina guiada vive aqui. Por ahora esta pagina solo
// valida el token y marca la pausa como iniciada, para poder cerrar el ciclo
// completo del motor de WhatsApp de punta a punta.
import type { Env } from "../env";
import { marcarPausaCompletada, marcarPausaIniciada, pausaPorId } from "../db/queries";
import { verificarToken } from "../lib/tokens";

export async function abrirPausa(env: Env, token: string): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return html(paginaError("Este link ya vencio o no es valido."), 410);

  const pausa = await pausaPorId(env, payload.p);
  if (!pausa) return html(paginaError("No encontramos esta pausa."), 404);

  await marcarPausaIniciada(env, pausa.id);
  return html(paginaRutina(token));
}

export async function completarPausa(env: Env, token: string): Promise<Response> {
  const payload = await verificarToken(token, env.TOKEN_SECRET);
  if (!payload) return Response.json({ ok: false, error: "token invalido" }, { status: 410 });

  await marcarPausaCompletada(env, payload.p);
  return Response.json({ ok: true });
}

const html = (cuerpo: string, status = 200): Response =>
  new Response(cuerpo, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const BASE = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#0f1115;color:#e8eaed}
 main{max-width:420px;margin:0 auto}
 h1{font-size:20px;margin:0 0 8px}
 p{color:#a8adb7}
 button{width:100%;padding:14px;border:0;border-radius:10px;background:#3b82f6;color:#fff;font-size:16px;margin-top:16px}
</style>`;

const paginaError = (mensaje: string): string =>
  `${BASE}<main><h1>Link no disponible</h1><p>${mensaje}</p></main>`;

const paginaRutina = (token: string): string => `${BASE}<main>
 <h1>Tu pausa activa</h1>
 <p>La rutina de 6 ejercicios con cronometro llega en el modulo M4. Por ahora este
 boton cierra el ciclo y registra la pausa como completada.</p>
 <button id="listo">Marcar como completada</button>
 <p id="estado"></p>
 <script>
  document.getElementById('listo').onclick = async () => {
    const r = await fetch('/p/${token}/done', { method: 'POST' });
    document.getElementById('estado').textContent = r.ok ? 'Registrada.' : 'No se pudo registrar.';
  };
 </script>
</main>`;

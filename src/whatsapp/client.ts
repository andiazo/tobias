// Wrapper sobre @kapso/whatsapp-cloud-api apuntando al proxy de Kapso.
import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import type { Env } from "../env";

export const clienteKapso = (env: Env): WhatsAppClient =>
  new WhatsAppClient({
    baseUrl: env.KAPSO_BASE_URL,
    kapsoApiKey: env.KAPSO_API_KEY,
    // El SDK guarda globalThis.fetch desagregado del global y Workers lo
    // rechaza con "Illegal invocation". Hay que pasarlo ya atado.
    fetch: globalThis.fetch.bind(globalThis),
  });

export const phoneNumberId = (env: Env): string => {
  if (!env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("falta WHATSAPP_PHONE_NUMBER_ID en wrangler.toml [vars]");
  }
  return env.WHATSAPP_PHONE_NUMBER_ID;
};

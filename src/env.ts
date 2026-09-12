export interface Env {
  DB: D1Database;

  // vars
  KAPSO_BASE_URL: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  PUBLIC_BASE_URL: string;
  MODO_PRUEBA: string;
  /** Nombres de las plantillas aprobadas en Meta. Vacios mientras no existan. */
  PLANTILLA_OPTIN?: string;
  PLANTILLA_RECORDATORIO?: string;

  // secrets
  KAPSO_API_KEY: string;
  META_APP_SECRET?: string;
  WEBHOOK_VERIFY_TOKEN?: string;
  TOKEN_SECRET: string;
  ADMIN_TOKEN?: string;
}

export const modoPrueba = (env: Env): boolean => env.MODO_PRUEBA === "true";

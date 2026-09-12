// Tokens firmados con HMAC-SHA256. Sin sesiones, sin cookies, sin login.
// Formato: <payload-base64url>.<firma-base64url>

const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const byte of view) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const deB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const clave = (secreto: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);

export interface PausaTokenPayload {
  /** id de la pausa */
  p: string;
  /** expiracion, epoch en segundos */
  exp: number;
}

export async function firmarToken(payload: PausaTokenPayload, secreto: string): Promise<string> {
  const cuerpo = b64url(enc.encode(JSON.stringify(payload)));
  const firma = await crypto.subtle.sign("HMAC", await clave(secreto), enc.encode(cuerpo));
  return `${cuerpo}.${b64url(firma)}`;
}

/** Devuelve el payload si la firma es valida y el token no expiro; si no, null. */
export async function verificarToken(
  token: string,
  secreto: string,
): Promise<PausaTokenPayload | null> {
  const punto = token.lastIndexOf(".");
  if (punto <= 0) return null;
  const cuerpo = token.slice(0, punto);
  const firma = token.slice(punto + 1);

  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await clave(secreto),
      deB64url(firma) as unknown as BufferSource,
      enc.encode(cuerpo),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(deB64url(cuerpo))) as PausaTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.p !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Token de la pausa guiada: expira 60 minutos despues del envio. */
export const tokenDePausa = (pausaId: string, secreto: string, minutos = 60): Promise<string> =>
  firmarToken({ p: pausaId, exp: Math.floor(Date.now() / 1000) + minutos * 60 }, secreto);

/** Token largo no adivinable para la URL del reporte de SST. */
export const tokenDeReporte = (): string => b64url(crypto.getRandomValues(new Uint8Array(24)));

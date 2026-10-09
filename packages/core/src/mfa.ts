// ─── Verificación en dos pasos (2FA) OPCIONAL, con Google Authenticator ─────
// No se pide para entrar. Quien la activa confirma con un código para autorizar
// cambios sensibles de su cuenta (el servidor exige un código de los últimos 10 min).
// Este módulo es lógica común: recibe el cliente de auth de Supabase (web o app).

/** El servidor acepta un código hasta 10 min después; el cliente lo da por vencido un minuto antes. */
import { t } from "./i18n";

export const MFA_FRESH_SEC = 9 * 60;

export interface MfaStatus {
  enabled: boolean;
  factorId: string | null;
}

export interface MfaEnrollment {
  factorId: string;
  /** Imagen del QR (data URI SVG) para escanear con Google Authenticator. */
  qr: string;
  /** Clave para escribir a mano si no se puede escanear. */
  secret: string;
  /** Enlace otpauth://: en el mismo celular abre Google Authenticator directamente. */
  uri: string;
}

/** Deja solo los 6 números del código (acepta espacios o guiones al pegar). */
export const cleanMfaCode = (s: string) => s.replace(/\D/g, "").slice(0, 6);
export const isMfaCode = (s: string) => /^\d{6}$/.test(s);

/** ¿El error es porque falta confirmar con el código? (lo devuelve el servidor) */
export function isMfaRequired(e: unknown): boolean {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  return /mfa_required/i.test(m);
}

/** Lee la marca de «código ingresado hace poco» del token de sesión. */
export function mfaFreshFromToken(token: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!token) return false;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { amr?: Array<{ method?: string; timestamp?: number }> };
    return (claims.amr ?? []).some((a) => a.method === "totp" && typeof a.timestamp === "number" && a.timestamp >= nowSec - MFA_FRESH_SEC);
  } catch {
    return false;
  }
}

// El cliente de Supabase se recibe suelto (any): web y app usan versiones distintas de la librería.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthLike = any;

const fail = (error: { message?: string } | null | undefined, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

/** El QR llega como SVG sin codificar dentro de un data URI; se codifica para que cualquier navegador lo muestre. */
export function safeSvgUri(uri: string): string {
  const m = /^data:image\/svg\+xml;(?:charset=)?utf-?8,([\s\S]*)$/i.exec(uri);
  return m ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m[1])}` : uri;
}

export function createMfa(auth: AuthLike) {
  /** ¿Tiene el 2FA activado? (solo cuenta un factor ya verificado) */
  async function status(): Promise<MfaStatus> {
    const { data, error } = await auth.mfa.listFactors();
    if (error) return { enabled: false, factorId: null };
    const f = (data?.totp ?? []).find((x: { status: string }) => x.status === "verified");
    return { enabled: !!f, factorId: f?.id ?? null };
  }

  /** ¿Ya confirmó con un código hace poco? */
  async function isFresh(): Promise<boolean> {
    const { data } = await auth.getSession();
    return mfaFreshFromToken(data?.session?.access_token);
  }

  /** Confirma un código de 6 números. Si es correcto, la sesión queda autorizada por unos minutos. */
  async function verifyOne(factorId: string, code: string): Promise<Error | null> {
    const c = await auth.mfa.challenge({ factorId });
    if (c.error) return new Error(c.error.message || t("No se pudo verificar."));
    const v = await auth.mfa.verify({ factorId, challengeId: c.data.id, code: cleanMfaCode(code) });
    if (v.error) return new Error(/invalid|expired/i.test(v.error.message ?? "") ? t("Código incorrecto o vencido. Probá con el siguiente que muestra la app.") : v.error.message || t("No se pudo verificar."));
    return null;
  }

  /**
   * Si la cuenta quedó con más de un factor verificado (por ejemplo, el 2FA se activó dos veces), el código de la app puede
   * pertenecer a cualquiera de ellos: se prueba primero el pedido y después los otros. Todos son de la misma persona.
   */
  async function verify(factorId: string, code: string): Promise<void> {
    const first = await verifyOne(factorId, code);
    if (!first) return;
    const { data } = await auth.mfa.listFactors();
    const others = ((data?.totp ?? []) as Array<{ id: string; status: string }>).filter((f) => f.status === "verified" && f.id !== factorId);
    for (const f of others) {
      if (!(await verifyOne(f.id, code))) return;
    }
    throw first;
  }

  /** Primer paso de la activación: crea el factor y devuelve el QR. (Limpia intentos anteriores sin terminar.) */
  async function startEnroll(label = "VELTRIX"): Promise<MfaEnrollment> {
    const { data: list } = await auth.mfa.listFactors();
    for (const f of (list?.all ?? []) as Array<{ id: string; status: string }>) {
      if (f.status !== "verified") await auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await auth.mfa.enroll({ factorType: "totp", friendlyName: `${label} ${Date.now()}` });
    if (error || !data) fail(error, t("No se pudo iniciar la activación."));
    return { factorId: data.id, qr: safeSvgUri(data.totp.qr_code), secret: data.totp.secret, uri: data.totp.uri };
  }

  /** Segundo paso: el código que muestra la app confirma que quedó bien vinculada. */
  const confirmEnroll = verify;

  /** Apagar el 2FA (el servidor pide antes un código reciente). */
  async function disable(factorId: string): Promise<void> {
    const { error } = await auth.mfa.unenroll({ factorId });
    if (error) fail(error, t("No se pudo desactivar."));
  }

  return { status, isFresh, verify, startEnroll, confirmEnroll, disable };
}

export type Mfa = ReturnType<typeof createMfa>;

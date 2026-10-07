import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cleanMfaCode, createMfa, isMfaCode, isMfaRequired, t } from "../lib";
import type { MfaEnrollment, MfaStatus } from "../lib";
import { supabase } from "../supabaseClient";
import Panel from "./Panel";

// Verificación en dos pasos OPCIONAL: no se pide para entrar, solo para autorizar cambios sensibles de la cuenta.

const mfa = createMfa(supabase.auth);

interface Ctx {
  status: MfaStatus;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Devuelve true si se puede seguir: sin 2FA, con código reciente, o después de ingresarlo. false si la persona cancela. */
  ask: (reason?: string) => Promise<boolean>;
}

const MfaContext = createContext<Ctx | null>(null);
export const useMfa = () => {
  const c = useContext(MfaContext);
  if (!c) throw new Error("useMfa fuera de MfaProvider");
  return c;
};

/** Texto para mostrar cuando el servidor rechazó el cambio por falta de código. */
export const mfaErrorText = (e: unknown, fallback: string) =>
  isMfaRequired(e) ? t("Confirmá con el código de Google Authenticator para hacer este cambio.") : e instanceof Error ? e.message : fallback;

function CodeBox({ value, onChange, onEnter, autoFocus }: { value: string; onChange: (v: string) => void; onEnter: () => void; autoFocus?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(cleanMfaCode(e.target.value))}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      placeholder="000000"
      aria-label={t("Código de 6 números")}
      className="num w-full rounded-md border border-line bg-ink px-3 py-3 text-center text-2xl font-bold tracking-[0.4em] text-snow outline-none focus:border-gold"
    />
  );
}

export function MfaProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MfaStatus>({ enabled: false, factorId: null });
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState<{ reason?: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try {
      setStatus(await mfa.status());
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ask = useCallback(async (reason?: string) => {
    const st = await mfa.status(); // se consulta de nuevo: pudo activarse desde otro dispositivo
    setStatus(st);
    if (!st.enabled || !st.factorId) return true;
    if (await mfa.isFresh()) return true;
    setCode("");
    setErr(null);
    setPrompt({ reason });
    return new Promise<boolean>((res) => {
      pending.current = res;
    });
  }, []);

  const close = (ok: boolean) => {
    setPrompt(null);
    pending.current?.(ok);
    pending.current = null;
  };

  const submit = async () => {
    const fid = statusRef.current.factorId;
    if (!fid || !isMfaCode(code) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await mfa.verify(fid, code);
      close(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo verificar."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => ({ status, loaded, refresh, ask }), [status, loaded, refresh, ask]);

  return (
    <MfaContext.Provider value={value}>
      {children}
      {prompt && (
        <div className="fade-in fixed inset-0 z-[90] flex items-center justify-center bg-ink/85 p-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-label={t("Confirmar con tu código")}>
          <div className="glass w-full max-w-sm space-y-3 rounded-xl border border-gold/40 p-5">
            <h2 className="font-display text-xl font-bold tracking-wide text-snow">🔐 {t("Confirmá que sos vos")}</h2>
            <p className="text-[12.5px] leading-relaxed text-fog">
              {prompt.reason ?? t("Este cambio necesita tu autorización.")} {t("Abrí Google Authenticator y escribí el código de 6 números de VELTRIX.")}
            </p>
            <CodeBox value={code} onChange={setCode} onEnter={submit} autoFocus />
            {err && <p className="text-[12px] text-bear">{err}</p>}
            <div className="flex gap-2">
              <button onClick={() => close(false)} className="flex-1 rounded-md border border-line px-3 py-2.5 text-[12px] font-bold text-dim hover:text-snow">
                {t("Cancelar")}
              </button>
              <button
                onClick={submit}
                disabled={!isMfaCode(code) || busy}
                className="flex-1 rounded-md bg-gold px-3 py-2.5 text-[12px] font-extrabold uppercase tracking-wider text-ink disabled:opacity-40"
              >
                {busy ? t("Verificando…") : t("Autorizar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </MfaContext.Provider>
  );
}

/** Tarjeta de ajustes: activar o desactivar la verificación en dos pasos. */
export function MfaCard({ notify }: { notify: (msg: string, kind?: "ok" | "err" | "info") => void }) {
  const { status, loaded, refresh, ask } = useMfa();
  const [enroll, setEnroll] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      setEnroll(await mfa.startEnroll());
      setCode("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo iniciar la activación."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enroll || !isMfaCode(code)) return;
    setBusy(true);
    setErr(null);
    try {
      await mfa.confirmEnroll(enroll.factorId, code);
      setEnroll(null);
      await refresh();
      notify(t("Listo: verificación en dos pasos activada."));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo verificar."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const f = enroll;
    setEnroll(null);
    setErr(null);
    if (f) await supabase.auth.mfa.unenroll({ factorId: f.factorId }).catch(() => {});
  };

  const disable = async () => {
    if (!status.factorId) return;
    if (!(await ask(t("Para desactivar la verificación en dos pasos necesitamos confirmar que sos vos.")))) return;
    try {
      await mfa.disable(status.factorId);
      await refresh();
      notify(t("Verificación en dos pasos desactivada."));
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo desactivar."), "err");
    }
  };

  return (
    <Panel
      id="mfa"
      title={t("VERIFICACIÓN EN DOS PASOS")}
      subtitle={t("Opcional: un código extra para autorizar cambios en tu cuenta")}
      summary={status.enabled ? t("Activada") : t("Desactivada")}
      defaultOpen={false}
    >
      <div className="space-y-3 p-5 text-[12.5px] leading-relaxed text-fog">
        {!loaded ? (
          <p className="text-dim">{t("Cargando…")}</p>
        ) : status.enabled ? (
          <>
            <p className="font-semibold text-bull">✅ {t("Activada")}</p>
            <p>{t("Te vamos a pedir el código de Google Authenticator para: conectar o desconectar un exchange, regenerar la URL del webhook y eliminar tu cuenta. Para entrar y usar VELTRIX todo sigue igual.")}</p>
            <p className="text-dim">{t("Si perdés el celular con el autenticador, pedí el reinicio al soporte de VELTRIX.")}</p>
            <button onClick={disable} className="rounded-md border border-line px-3 py-2 text-[11px] font-semibold text-dim transition-colors hover:border-bear/50 hover:text-bear">
              {t("Desactivar")}
            </button>
          </>
        ) : enroll ? (
          <>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t("Instalá Google Authenticator en tu celular (si no lo tenés).")}</li>
              <li>{t("Tocá «+» y elegí «Escanear código QR».")}</li>
              <li>{t("Escribí acá abajo el código de 6 números que te muestra.")}</li>
            </ol>
            <div className="flex justify-center">
              <img src={enroll.qr} alt={t("Código QR para Google Authenticator")} className="h-44 w-44 rounded-md bg-white p-2" />
            </div>
            <details className="text-[11.5px] text-dim">
              <summary className="cursor-pointer">{t("No puedo escanear el QR")}</summary>
              <p className="mt-1">{t("En Google Authenticator elegí «Ingresar una clave de configuración» y escribí esta clave:")}</p>
              <code className="num mt-1 block break-all rounded border border-line bg-ink px-2 py-1.5 text-fog">{enroll.secret}</code>
            </details>
            <CodeBox value={code} onChange={setCode} onEnter={confirm} />
            {err && <p className="text-bear">{err}</p>}
            <div className="flex gap-2">
              <button onClick={cancel} className="flex-1 rounded-md border border-line px-3 py-2.5 text-[12px] font-bold text-dim hover:text-snow">
                {t("Cancelar")}
              </button>
              <button onClick={confirm} disabled={!isMfaCode(code) || busy} className="flex-1 rounded-md bg-gold px-3 py-2.5 text-[12px] font-extrabold uppercase tracking-wider text-ink disabled:opacity-40">
                {busy ? t("Verificando…") : t("Activar")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{t("Es opcional y lo decidís vos. Si lo activás, para cambios importantes de tu cuenta (conectar o desconectar un exchange, regenerar la URL del webhook, eliminar tu cuenta) te pedimos un código de Google Authenticator. Para entrar no hace falta.")}</p>
            {err && <p className="text-bear">{err}</p>}
            <button onClick={start} disabled={busy} className="w-full rounded-md border border-gold/50 bg-gold/10 px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:opacity-40">
              🔐 {t("Activar verificación en dos pasos")}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

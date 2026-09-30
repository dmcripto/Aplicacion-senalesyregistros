import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../supabaseClient";
import { COMMUNITY_URL, cx } from "../lib";
import { IconAlert, ShieldLogo } from "../ui";

export default function Auth({ initialNotice }: { initialNotice?: string | null } = {}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setNotice("Cuenta creada. Si tu proyecto pide confirmación por email, revisá tu bandeja de entrada.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError("Ingresá tu email arriba y volvé a tocar el link.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      setNotice("Te enviamos un email para restablecer tu contraseña.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el email.");
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!email.trim()) {
      setError("Ingresá tu email arriba y volvé a tocar el link.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resend({ type: "signup", email });
      if (err) throw err;
      setNotice("Te reenviamos el email de confirmación.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reenviar el email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel shadow-[0_24px_70px_rgba(0,0,0,.5)]">
        <div className="flex flex-col items-center gap-3 border-b border-line px-6 py-7">
          <ShieldLogo className="h-20 w-20 drop-shadow-[0_0_22px_rgba(46,196,241,.4)]" />
          <div className="text-center">
            <h1 className="font-display text-3xl font-extrabold tracking-[0.04em] text-snow">
              VELTRIX
            </h1>
            <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-fog">
              Diario de trading · En vivo
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3.5 px-6 py-6">
          <div className="mb-1 flex gap-1 rounded-lg border border-line bg-ink p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={cx(
                "flex-1 rounded-md px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition-all",
                mode === "login" ? "bg-gold text-ink" : "text-fog hover:text-snow",
              )}
            >
              Ingresar
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={cx(
                "flex-1 rounded-md px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition-all",
                mode === "signup" ? "bg-gold text-ink" : "text-fog hover:text-snow",
              )}
            >
              Crear cuenta
            </button>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@ejemplo.com"
              className="field"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="field pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-gold hover:brightness-110"
              >
                {showPassword ? "Ocultar" : "Ver"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px]">
            <button
              type="button"
              onClick={forgotPassword}
              disabled={busy}
              className="font-semibold text-fog underline-offset-2 hover:text-gold hover:underline disabled:opacity-50"
            >
              ¿Olvidaste tu contraseña?
            </button>
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={busy}
              className="font-semibold text-fog underline-offset-2 hover:text-gold hover:underline disabled:opacity-50"
            >
              Reenviar confirmación
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2 text-[12px] text-bear">
              <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="rounded-md border border-cyan/30 bg-ink px-3 py-2 text-[12px] text-cyan">{notice}</div>
          )}

          {mode === "signup" && (
            <label className="flex cursor-pointer items-start gap-2.5 text-[11.5px] leading-relaxed text-fog">
              <input
                type="checkbox"
                required
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-gold)]"
              />
              <span>
                Acepto los{" "}
                <a href="/terms.html" target="_blank" rel="noopener" className="font-semibold text-gold underline">
                  términos de uso
                </a>{" "}
                y la{" "}
                <a href="/privacy.html" target="_blank" rel="noopener" className="font-semibold text-gold underline">
                  política de privacidad
                </a>
                .
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gold px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Un momento…" : mode === "login" ? "Ingresar" : "Crear cuenta"}
          </button>
        </form>
        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block border-t border-line px-6 py-3 text-center text-[12px] font-semibold text-cyan transition-colors hover:bg-cyan/10"
        >
          ✈ Unite a la comunidad de VELTRIX en Telegram
        </a>
        <p className="border-t border-line px-6 py-4 text-[10.5px] leading-relaxed text-dim">
          VELTRIX es una herramienta de registro, no brinda asesoramiento financiero. Operar implica riesgo de
          pérdida. No está afiliado a TradingView.
        </p>
      </div>
    </div>
  );
}

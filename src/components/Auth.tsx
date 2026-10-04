import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../supabaseClient";
import { COMMUNITY_URL, cx } from "../lib";
import { IconAlert, IconTelegram, ShieldLogo } from "../ui";
import { LangSwitch, legalUrl } from "../lang";
import { getLang, t, welcomeContent } from "../lib";
import LiveDemo from "./LiveDemo";
import { trackGlow } from "../glowTracking";
import { trackSignup } from "../refTracking";

export default function Auth({ initialNotice }: { initialNotice?: string | null } = {}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const welcome = welcomeContent();
  useEffect(() => trackGlow(), []);
  const lang = getLang();
  const goForm = (m: "login" | "signup") => {
    setMode(m);
    document.getElementById("acceso")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
        trackSignup();
        setNotice(t("Cuenta creada. Si tu proyecto pide confirmación por email, revisá tu bandeja de entrada."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo completar la operación."));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError(t("Ingresá tu email arriba y volvé a tocar el link."));
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
      setNotice(t("Te enviamos un email para restablecer tu contraseña."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo enviar el email."));
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!email.trim()) {
      setError(t("Ingresá tu email arriba y volvé a tocar el link."));
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resend({ type: "signup", email });
      if (err) throw err;
      setNotice(t("Te reenviamos el email de confirmación."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo reenviar el email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-5xl content-center gap-8 px-4 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-x-12 lg:gap-y-8">
      <div className="fixed right-3 top-3 z-10"><LangSwitch /></div>

      <section className="flex flex-col items-center text-center lg:col-start-1 lg:items-start lg:text-left">
        <span className="brand-logo"><ShieldLogo className="h-16 w-16" /></span>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-[0.04em] text-snow"><span className="brand-word">VELTRIX</span></h1>
        <p className="mt-2 font-display text-2xl font-bold leading-tight text-gold sm:text-3xl">{welcome.headline}</p>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-fog">{welcome.lead}</p>
      </section>

      <div className="flex justify-center lg:col-start-1 lg:justify-start">
        <LiveDemo />
      </div>

      <div className="flex gap-3 lg:hidden">
        <button type="button" onClick={() => goForm("signup")} className="flex-1 rounded-md bg-gold px-4 py-3 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98]">
          {t("Crear cuenta")}
        </button>
        <button type="button" onClick={() => goForm("login")} className="flex-1 rounded-md border border-cyan/50 px-4 py-3 text-[13px] font-bold uppercase tracking-wider text-cyan transition-colors hover:bg-cyan/10">
          {t("Ya tengo cuenta")}
        </button>
      </div>

      <section className="lg:col-start-1">
        <h2 className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.22em] text-fog lg:text-left">{t("Así te llegan los avisos")}</h2>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
          {([["signal", "1 · Llega la señal"], ["target", "2 · Aviso de cada target"], ["result", "3 · Resultado al cerrar"]] as const).map(([k, cap]) => (
            <figure key={k} className="lift w-[68%] shrink-0 snap-center rounded-xl sm:w-[44%] lg:w-auto">
              <img src={`/welcome/${k}-${lang}.png`} alt={t(cap)} loading="lazy" width={600} height={600} className="w-full rounded-xl border border-line shadow-[0_12px_36px_rgba(0,0,0,.45)]" />
              <figcaption className="mt-2 text-center text-[11.5px] font-semibold text-fog">{t(cap)}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="lg:col-start-1">
        <h2 className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.22em] text-fog lg:text-left">{t("Qué podés hacer con VELTRIX")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {welcome.features.map((f) => (
            <div key={f.title} className="lift flex items-start gap-3 rounded-lg border border-line bg-panel/80 p-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan/25 bg-cyan/10 text-[22px]">{f.icon}</span>
              <div>
                <h3 className="text-[14px] font-bold text-snow">{f.title}</h3>
                <p className="mt-0.5 text-[12px] leading-snug text-fog">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div id="acceso" data-tilt="soft" className="glass glow-card auth-card rise-in w-full max-w-sm scroll-mt-4 self-start justify-self-center rounded-lg shadow-[0_24px_70px_rgba(0,0,0,.5)] lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:max-w-md lg:justify-self-end">
        <form onSubmit={submit} className="space-y-3.5 px-6 py-6">
          <div className="relative mb-1 flex gap-1 rounded-lg border border-line bg-ink p-1">
            <span
              aria-hidden
              className="tab-slider absolute bottom-1 left-1 top-1 w-[calc(50%-6px)] rounded-md bg-gold"
              style={{ transform: mode === "login" ? "translateX(0)" : "translateX(calc(100% + 4px))" }}
            />
            <button
              type="button"
              onClick={() => setMode("login")}
              className={cx(
                "relative flex-1 rounded-md px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition-colors duration-300",
                mode === "login" ? "text-ink" : "text-fog hover:text-snow",
              )}
            >
              {t("Ingresar")}
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={cx(
                "relative flex-1 rounded-md px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition-colors duration-300",
                mode === "signup" ? "text-ink" : "text-fog hover:text-snow",
              )}
            >
              {t("Crear cuenta")}
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
              placeholder={t("vos@ejemplo.com")}
              className="field"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">{t("Contraseña")}</label>
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
                {showPassword ? t("Ocultar") : t("Ver")}
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
              {t("¿Olvidaste tu contraseña?")}
            </button>
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={busy}
              className="font-semibold text-fog underline-offset-2 hover:text-gold hover:underline disabled:opacity-50"
            >
              {t("Reenviar confirmación")}
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
                {t("Acepto los")}{" "}
                <a href={legalUrl("terms")} target="_blank" rel="noopener" className="font-semibold text-gold underline">
                  {t("términos de uso")}
                </a>{" "}
                {t("y la")}{" "}
                <a href={legalUrl("privacy")} target="_blank" rel="noopener" className="font-semibold text-gold underline">
                  {t("política de privacidad")}
                </a>
                .
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-shine w-full rounded-md bg-gold px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("Un momento…") : mode === "login" ? t("Ingresar") : t("Crear cuenta")}
          </button>
        </form>
        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 border-t border-line px-6 py-3 text-center text-[12px] font-semibold text-cyan transition-colors hover:bg-cyan/10"
        >
          <IconTelegram className="h-4 w-4 shrink-0" />
          {t("Unite a la comunidad de VELTRIX en Telegram")}
        </a>
        <p className="border-t border-line px-6 py-4 text-[10.5px] leading-relaxed text-dim">
          {t("VELTRIX no brinda asesoramiento financiero. Operar implica riesgo de pérdida. No está afiliado a TradingView.")}
        </p>
      </div>

    </div>
  );
}

import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../supabaseClient";
import { cx } from "../lib";
import { IconAlert, ShieldLogo } from "../ui";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel shadow-[0_24px_70px_rgba(0,0,0,.5)]">
        <div className="flex flex-col items-center gap-3 border-b border-line px-6 py-7">
          <ShieldLogo className="h-12 w-12 drop-shadow-[0_0_18px_rgba(243,183,30,.25)]" />
          <div className="text-center">
            <h1 className="font-display text-3xl font-extrabold tracking-[0.04em] text-snow">
              DMCRIPTO<span className="text-gold">.</span>
            </h1>
            <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-fog">
              Diario de trading · SMC / ICT
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

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2 text-[12px] text-bear">
              <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="rounded-md border border-cyan/30 bg-ink px-3 py-2 text-[12px] text-cyan">{notice}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gold px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Un momento…" : mode === "login" ? "Ingresar" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}

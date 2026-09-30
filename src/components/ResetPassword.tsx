import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../supabaseClient";
import { IconAlert, ShieldLogo } from "../ui";
import { t } from "../lib";

export default function ResetPassword({ onDone }: { onDone: (notice: string) => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      await supabase.auth.signOut();
      onDone(t("Contraseña actualizada — ingresá con tu nueva contraseña."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo actualizar la contraseña."));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel shadow-[0_24px_70px_rgba(0,0,0,.5)]">
        <div className="flex flex-col items-center gap-3 border-b border-line px-6 py-7">
          <ShieldLogo className="h-12 w-12 drop-shadow-[0_0_18px_rgba(46,196,241,.25)]" />
          <div className="text-center">
            <h1 className="font-display text-2xl font-extrabold tracking-[0.04em] text-snow">
              {t("Nueva contraseña")}
            </h1>
            <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-fog">
              {t("Elegí una contraseña nueva")}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3.5 px-6 py-6">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">
              {t("Contraseña nueva")}
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                autoComplete="new-password"
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

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2 text-[12px] text-bear">
              <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gold px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("Un momento…") : t("Guardar contraseña")}
          </button>
        </form>
      </div>
    </div>
  );
}

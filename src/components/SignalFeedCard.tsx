import { useEffect, useState } from "react";
import { checkManualSignal, cx, t } from "../lib";
import type { SignalFeedState } from "../lib";
import { fetchSignalFeed, publishManualSignal, setFollowSignals } from "../tradesApi";
import Panel from "./Panel";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

/** «Señales de VELTRIX»: recibir en tu diario y por aviso las señales que publica el equipo. Solo en cuentas con la llave beta. */
export default function SignalFeedCard({ userId, notify }: { userId: string; notify: Notify }) {
  const [state, setState] = useState<SignalFeedState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSignalFeed(userId)
      .then((s) => alive && setState(s))
      .catch(() => {}); // sin la llave beta, o sin el SQL: la tarjeta no se muestra
    return () => {
      alive = false;
    };
  }, [userId]);

  const [form, setForm] = useState({ symbol: "BTCUSDT", direction: "LONG" as "LONG" | "SHORT", entry: "", tp: "", sl: "" });
  const [community, setCommunity] = useState(false);
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!state) return null;

  const num = (v: string) => Number(v.trim().replace(",", "."));
  const check = checkManualSignal({ symbol: form.symbol, direction: form.direction, entry: num(form.entry), tp: num(form.tp), sl: num(form.sl) });
  const people = state.followers ?? 0;

  const publish = async () => {
    if (!check.ok) return;
    setArmed(false);
    setSending(true);
    try {
      const r = await publishManualSignal(userId, check.text, { community });
      if (!r.ok) return notify(r.error ?? t("No se pudo publicar la señal."), "err");
      notify(r.duplicate ? t("Esa señal ya se había enviado hace un momento.") : t("Señal publicada: llega a {n} personas y queda en tu diario.", { n: people }), r.duplicate ? "info" : "ok");
      setForm({ ...form, entry: "", tp: "", sl: "" });
    } finally {
      setSending(false);
    }
  };

  const field = "num w-full rounded-md border border-line bg-ink px-3 py-2 text-[13px] text-snow outline-none focus:border-gold";

  const toggle = async (follow: boolean) => {
    setBusy(true);
    try {
      await setFollowSignals(userId, follow);
      setState({ ...state, follow });
      notify(follow ? t("Listo: vas a recibir las señales de VELTRIX.") : t("Dejaste de recibir las señales de VELTRIX."));
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo guardar el cambio."), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel id="feed" title={t("SEÑALES DE VELTRIX")} subtitle={t("Las que publica el equipo, en tu diario y por aviso")} summary={state.follow ? t("Recibiéndolas") : t("No las recibís")} defaultOpen={false}>
      <div className="space-y-3 p-5 text-[12.5px] leading-relaxed text-fog">
        <p>{t("Si lo activás, cada señal que publica el equipo de VELTRIX se anota sola en tu diario (con la etiqueta «Señal VELTRIX») y te llega el aviso por la app y por tu Telegram, si lo vinculaste. Se cierra sola cuando toca el objetivo o el stop, como el resto de tus operaciones.")}</p>
        <p className="text-dim">{t("Es información para tu propio análisis, no una recomendación ni una orden. VELTRIX no opera por vos: la decisión y la operación son tuyas. Podés dejar de recibirlas cuando quieras.")}</p>
        <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-ink/50 px-3 py-3">
          <span className="text-snow">{t("Recibir las señales de VELTRIX")}</span>
          <input type="checkbox" checked={state.follow} disabled={busy} onChange={(e) => toggle(e.target.checked)} className="h-5 w-5 accent-[#2ec4f1]" />
        </label>
        {state.provider && (
          <p className="rounded-md border border-gold/40 bg-gold/5 px-3 py-2.5 text-snow">
            📡 {t("Tu cuenta publica señales: las alertas de TradingView que recibe tu webhook se reparten a quienes las activaron.")}{" "}
            {state.followers != null && <b className="num text-gold">{t("Hoy las reciben {n} personas.", { n: state.followers })}</b>}
          </p>
        )}
        {state.provider && (
          <div className="space-y-2.5 rounded-md border border-line p-3.5">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">{t("Publicar una señal a mano")}</p>
            <p className="text-[11.5px] text-dim">{t("Sirve para publicar sin pasar por TradingView, o para probar el reparto. Se anota en tu diario y llega a quienes las activaron.")}</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} aria-label={t("Activo")} placeholder="BTCUSDT" className={field} />
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as "LONG" | "SHORT" })} aria-label={t("Dirección")} className={field}>
                <option value="LONG">{t("COMPRA")}</option>
                <option value="SHORT">{t("VENTA")}</option>
              </select>
              <input value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} inputMode="decimal" aria-label={t("Entrada")} placeholder={t("Entrada")} className={field} />
              <input value={form.tp} onChange={(e) => setForm({ ...form, tp: e.target.value })} inputMode="decimal" aria-label={t("Objetivo")} placeholder={t("Objetivo")} className={field} />
              <input value={form.sl} onChange={(e) => setForm({ ...form, sl: e.target.value })} inputMode="decimal" aria-label="Stop" placeholder="Stop" className={cx(field, "col-span-2")} />
            </div>
            <label className="flex items-start gap-2 text-[11.5px] leading-snug text-fog">
              <input type="checkbox" checked={community} onChange={(e) => setCommunity(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2ec4f1]" />
              <span>{t("También publicarla en mi comunidad de Telegram y avisar por WhatsApp (si no, llega solo a quienes siguen las señales de VELTRIX).")}</span>
            </label>
            {form.entry && form.tp && form.sl && !check.ok && <p className="text-[11.5px] text-bear">{check.error}</p>}
            {armed ? (
              <button onClick={publish} disabled={sending} className="w-full rounded-md border border-bear bg-bear/15 px-3 py-2.5 text-[12px] font-extrabold uppercase tracking-wider text-bear hover:bg-bear/30 disabled:opacity-40">
                {t("Confirmar: enviar ahora a {n} personas", { n: people })}
              </button>
            ) : (
              <button onClick={() => setArmed(true)} disabled={!check.ok || sending} className="w-full rounded-md border border-gold/50 bg-gold/10 px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold hover:bg-gold/20 disabled:opacity-40">
                {sending ? t("Enviando…") : t("Publicar señal")}
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

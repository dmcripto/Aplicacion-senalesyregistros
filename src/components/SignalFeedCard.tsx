import { useEffect, useState } from "react";
import { t } from "../lib";
import type { SignalFeedState } from "../lib";
import { fetchSignalFeed, setFollowSignals } from "../tradesApi";
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

  if (!state) return null;

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
      </div>
    </Panel>
  );
}

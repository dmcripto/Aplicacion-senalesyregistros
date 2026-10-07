import { useEffect, useState } from "react";
import { cx, t } from "../lib";
import { fetchNewsPause, saveNewsPause } from "../tradesApi";
import type { NewsPauseState } from "../tradesApi";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

/** Pausa del bot alrededor de los datos económicos de alto impacto: interruptor, minutos y aviso de cuándo está en pausa. */
export default function NewsPauseRow({ userId, notify }: { userId: string; notify: Notify }) {
  const [p, setP] = useState<NewsPauseState | null>(null);
  const [before, setBefore] = useState("30");
  const [after, setAfter] = useState("30");

  useEffect(() => {
    let alive = true;
    const load = (first: boolean) =>
      fetchNewsPause(userId).then((r) => {
        if (!alive || !r) return;
        setP((prev) => ({ ...r, ...(prev && !first ? { enabled: prev.enabled, before: prev.before, after: prev.after } : {}) }));
        if (first) {
          setBefore(String(r.before));
          setAfter(String(r.after));
        }
      });
    void load(true);
    const id = window.setInterval(() => void load(false), 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [userId]);

  if (!p) return null; // sin el SQL: rige la pausa de fábrica (30 min antes y después) y no hay nada que cambiar

  const save = async (next: Pick<NewsPauseState, "enabled" | "before" | "after">) => {
    try {
      await saveNewsPause(userId, next);
      setP({ ...p, ...next });
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo guardar el cambio."), "err");
    }
  };
  const num = (v: string, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(180, Math.max(0, Math.round(n))) : d;
  };
  const paused = p.enabled && p.pausedUntil && new Date(p.pausedUntil).getTime() > Date.now();
  const field = "num w-16 rounded-md border border-line bg-ink px-2 py-1 text-[12.5px] text-snow outline-none focus:border-gold";

  return (
    <div className="space-y-2 rounded-md border border-line bg-ink/40 px-3.5 py-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-[12.5px] font-bold text-snow">{t("Pausar cerca de datos económicos")}</span>
          <span className="block text-[11px] leading-snug text-dim">{t("No abre operaciones nuevas desde un rato antes hasta un rato después de un dato de alto impacto (los 🔴 de la agenda económica). Las que ya están abiertas siguen igual, con su TP y su SL.")}</span>
        </span>
        <input type="checkbox" checked={p.enabled} onChange={(e) => void save({ enabled: e.target.checked, before: num(before, 30), after: num(after, 30) })} className="h-5 w-5 shrink-0 accent-[#2ec4f1]" />
      </label>
      {p.enabled && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-dim">
          <label className="flex items-center gap-2">
            {t("Minutos antes")}
            <input type="number" min={0} max={180} value={before} onChange={(e) => setBefore(e.target.value)} onBlur={() => void save({ enabled: true, before: num(before, 30), after: num(after, 30) })} className={field} />
          </label>
          <label className="flex items-center gap-2">
            {t("Minutos después")}
            <input type="number" min={0} max={180} value={after} onChange={(e) => setAfter(e.target.value)} onBlur={() => void save({ enabled: true, before: num(before, 30), after: num(after, 30) })} className={field} />
          </label>
        </div>
      )}
      {paused && (
        <p className={cx("rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[12px] font-semibold text-gold")}>
          ⏸ {t("Bot en pausa por")} {p.pausedEvent} · {t("hasta las")} {new Date(p.pausedUntil!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
        </p>
      )}
    </div>
  );
}

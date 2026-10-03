import { useMemo } from "react";
import { cx, fmtR, fmtPrice, todayOverview } from "../lib";
import type { Trade } from "../lib";
import { useCountUp } from "../hooks";
import { LevelBar, TriDown, TriUp } from "../ui";
import { t } from "../lib";

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? t("Buenas noches") : h < 13 ? t("Buen día") : h < 20 ? t("Buenas tardes") : t("Buenas noches");
};

/** Portada del panel: cómo va el día de un vistazo, con las señales abiertas y su avance hacia TP/SL. */
export default function TodayCard({ trades, prices, now }: { trades: Trade[]; prices: Record<string, number>; now: Date }) {
  const o = useMemo(() => todayOverview(trades, now), [trades, now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = useCountUp(o.r);
  const open = useMemo(
    () => trades.filter((x) => x.outcome === "ABIERTA").sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [trades],
  );
  const tone = o.closed === 0 ? "text-fog" : o.r > 0 ? "text-bull" : o.r < 0 ? "text-bear" : "text-fog";
  const glow = o.closed === 0 ? "" : o.r > 0 ? "today-glow-bull" : o.r < 0 ? "today-glow-bear" : "";

  return (
    <section className={cx("glass glow-card relative overflow-hidden rounded-xl p-5 sm:p-6", glow)} aria-label={t("Tu día")}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-fog">
            {greeting()} · {t("Tu día")}
          </p>
          <p className={cx("font-display mt-2 text-[64px] font-extrabold leading-none tracking-wide sm:text-7xl", tone)}>
            {o.closed ? fmtR(r) : "0"}
            <span className="ml-1.5 text-3xl text-fog">R</span>
          </p>
          <p className="num mt-2 text-[12px] text-dim">
            {o.closed
              ? `${o.closed} ${o.closed === 1 ? t("operación cerrada hoy") : t("operaciones cerradas hoy")} · ${o.wins}G · ${o.losses}P`
              : t("Hoy todavía no cerraste operaciones.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {o.activeStreak >= 2 && (
              <span className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11.5px] font-bold text-gold">
                🔥 {t("{n} días seguidos registrando", { n: o.activeStreak })}
              </span>
            )}
            {o.greenStreak >= 2 && (
              <span className="rounded-full border border-bull/40 bg-bull/10 px-3 py-1 text-[11.5px] font-bold text-bull">
                🟢 {t("{n} días seguidos en verde", { n: o.greenStreak })}
              </span>
            )}
            {o.activeStreak < 2 && o.greenStreak < 2 && (
              <span className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-dim">{t("Registrá cada día para armar tu racha")}</span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-fog">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
            {t("Señales abiertas")} · {open.length}
          </p>
          {open.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-5 text-[12.5px] leading-relaxed text-dim">
              {t("No tenés señales abiertas. Cuando llegue una, vas a ver acá qué tan cerca está de su TP o su SL.")}
            </p>
          ) : (
            <ul className="space-y-2">
              {open.slice(0, 3).map((tr) => (
                <li key={tr.id} className="rounded-lg border border-line bg-ink/40 px-4 py-3 transition-colors hover:border-line2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="num flex items-center gap-2 text-[13px] font-bold text-snow">
                      {tr.direction === "LONG" ? <TriUp className="h-2.5 w-2.5 text-bull" /> : <TriDown className="h-2.5 w-2.5 text-bear" />}
                      {tr.symbol}
                    </span>
                    <span className="num text-[11px] text-dim">
                      SL {fmtPrice(tr.sl)} · TP {fmtPrice(tr.tp)}
                    </span>
                  </div>
                  {prices[tr.id] != null ? (
                    <LevelBar trade={tr} price={prices[tr.id]} className="mt-2.5" />
                  ) : (
                    <p className="num mt-1.5 text-[11px] text-dim">
                      {t("Entrada")} {fmtPrice(tr.entry)}
                    </p>
                  )}
                </li>
              ))}
              {open.length > 3 && <li className="px-1 text-[11px] text-dim">+{open.length - 3} {t("más en el libro de operaciones")}</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

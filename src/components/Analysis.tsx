import { useMemo, useState } from "react";
import { analyze, cx, fmtR } from "../lib";
import type { GroupRow, Trade } from "../lib";
import { t } from "../lib";

type View = "symbol" | "weekday" | "hour" | "direction";
const VIEWS: Array<[View, string]> = [
  ["symbol", "Activo"],
  ["weekday", "Día"],
  ["hour", "Hora"],
  ["direction", "Dirección"],
];

function Bars({ rows }: { rows: GroupRow[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.netR)));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[92px_1fr_64px] items-center gap-2 text-[12px]">
          <span className="truncate font-semibold text-snow">{r.label}</span>
          <span className="flex h-2.5 items-center overflow-hidden rounded-full bg-ink">
            {r.ops > 0 && (
              <span
                className={cx("block h-full rounded-full", r.netR >= 0 ? "bg-bull" : "bg-bear")}
                style={{ width: `${Math.max(4, (Math.abs(r.netR) / max) * 100)}%` }}
              />
            )}
          </span>
          <span className="num text-right">
            {r.ops > 0 ? (
              <span className={cx("font-bold", r.netR > 0 ? "text-bull" : r.netR < 0 ? "text-bear" : "text-fog")}>
                {fmtR(r.netR)}R
              </span>
            ) : (
              <span className="text-dim">—</span>
            )}
            {r.ops > 0 && <span className="ml-1 text-[10px] text-dim">{r.ops}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Analysis({ trades }: { trades: Trade[] }) {
  const a = useMemo(() => analyze(trades), [trades]);
  const [view, setView] = useState<View>("symbol");
  if (a.closed < 2) return null;

  const rows = view === "symbol" ? a.bySymbol : view === "weekday" ? a.byWeekday : view === "hour" ? a.byHour : a.byDirection;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-display text-2xl font-bold tracking-wide text-snow">{t("ANÁLISIS")}</h2>
        <p className="text-[11px] uppercase tracking-[0.16em] text-dim">{t("Dónde ganás y dónde perdés")}</p>
      </header>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-line bg-ink/50 p-3">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{t("Mejor racha")}</p>
            <p className="num text-lg font-bold text-bull">{a.streaks.maxWin}</p>
          </div>
          <div className="rounded-md border border-line bg-ink/50 p-3">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{t("Peor racha")}</p>
            <p className="num text-lg font-bold text-bear">{a.streaks.maxLoss}</p>
          </div>
          <div className="rounded-md border border-line bg-ink/50 p-3">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{t("Racha actual")}</p>
            <p className={cx("num text-lg font-bold", a.streaks.current.type === "win" ? "text-bull" : a.streaks.current.type === "loss" ? "text-bear" : "text-fog")}>
              {a.streaks.current.count}
              <span className="ml-1 text-[10px] font-semibold">{a.streaks.current.type === "win" ? t("ganadas") : a.streaks.current.type === "loss" ? t("perdidas") : ""}</span>
            </p>
          </div>
        </div>

        {a.insights.length > 0 && (
          <ul className="space-y-1.5 rounded-md border border-gold/30 bg-golddeep/25 p-3 text-[12px] leading-relaxed text-fog">
            {a.insights.map((t) => (
              <li key={t}>💡 {t}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-1 rounded-lg border border-line bg-ink p-1">
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cx(
                "flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors",
                view === key ? "bg-gold text-ink" : "text-fog hover:text-snow",
              )}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <Bars rows={rows} />
        <p className="text-[10.5px] text-dim">{t("R neto por grupo y cantidad de operaciones cerradas. Usá los consejos con cuidado si son pocas operaciones.")}</p>
      </div>
    </section>
  );
}

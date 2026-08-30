import { useMemo } from "react";
import { cx, fmtR, monthlySummary } from "../lib";
import type { Trade } from "../lib";

export default function MonthlySummary({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => monthlySummary(trades), [trades]);

  const totals = useMemo(() => {
    const ops = rows.reduce((a, r) => a + r.ops, 0);
    const cerradas = rows.reduce((a, r) => a + r.cerradas, 0);
    const netR = rows.reduce((a, r) => a + r.netR, 0);
    const ganadas = rows.reduce((a, r) => a + Math.round((r.winRate / 100) * r.cerradas), 0);
    return { ops, cerradas, netR, winRate: cerradas ? (ganadas / cerradas) * 100 : 0 };
  }, [rows]);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-display text-2xl font-bold tracking-wide text-snow">RESUMEN MENSUAL</h2>
        <p className="text-[11px] uppercase tracking-[0.16em] text-dim">Rendimiento por mes calendario</p>
      </header>

      <div className="px-5 py-3">
        <div className="mb-1 grid grid-cols-[1fr_44px_1fr_70px] gap-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-dim">
          <span>Mes</span>
          <span className="text-right">Ops</span>
          <span>% acierto</span>
          <span className="text-right">R neto</span>
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.key}
              className="group grid grid-cols-[1fr_44px_1fr_70px] items-center gap-2 border-b border-line/50 py-2.5 transition-colors last:border-b-0 hover:bg-panel2/60"
            >
              <span className="text-[12.5px] font-semibold capitalize text-snow">{r.label}</span>
              <span className="num text-right text-[12px] text-fog">{r.ops}</span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink">
                  <span
                    className={cx(
                      "block h-full rounded-full transition-all duration-700",
                      r.winRate >= 50 ? "bg-bull" : "bg-bear",
                    )}
                    style={{ width: `${Math.max(2, r.winRate)}%` }}
                  />
                </span>
                <span className="num w-9 text-right text-[11px] text-fog">
                  {r.cerradas ? `${Math.round(r.winRate)}%` : "—"}
                </span>
              </span>
              <span
                className={cx(
                  "num text-right text-[12.5px] font-bold",
                  r.netR > 0 ? "text-bull" : r.netR < 0 ? "text-bear" : "text-fog",
                )}
              >
                {r.cerradas ? `${fmtR(r.netR)}R` : "—"}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex items-center justify-between rounded-md border border-gold/30 bg-golddeep/25 px-3.5 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
            Total · {totals.cerradas} cerradas
          </span>
          <span
            className={cx(
              "num text-lg font-bold",
              totals.netR > 0 ? "text-bull" : totals.netR < 0 ? "text-bear" : "text-fog",
            )}
          >
            {fmtR(totals.netR)}R
          </span>
        </div>
      </div>
    </section>
  );
}

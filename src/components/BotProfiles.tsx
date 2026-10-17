import { useMemo } from "react";
import { botProfileStats, cx, fmtR, t } from "../lib";
import type { Trade } from "../lib";
import Panel from "./Panel";

const rCls = (r: number) => (r > 0 ? "text-bull" : r < 0 ? "text-bear" : "text-fog");

/** Cuál perfil del bot rinde y de qué lado (compras o ventas): evita sacar conclusiones de un solo día o de pocas operaciones. */
export default function BotProfiles({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => botProfileStats(trades), [trades]);
  if (!rows.length) return null;
  return (
    <Panel
      id="bot-profiles"
      title={t("RENDIMIENTO POR PERFIL DEL BOT")}
      subtitle={t("Qué perfil rinde y en qué lado")}
      summary={`${rows.length}`}
      defaultOpen={false}
    >
      <ul className="px-5 py-3">
        {rows.map((r) => (
          <li key={r.key} className="border-b border-line/50 py-2.5 last:border-b-0">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3">
              <span className="truncate text-[12.5px] font-semibold text-snow">
                {r.label}
                {r.real && <span className="ml-2 rounded-full border border-gold/50 px-1.5 text-[9px] font-bold uppercase text-gold">{t("real")}</span>}
              </span>
              <span className="num text-right text-[11px] text-fog">{r.ops} {t("ops")}</span>
              <span className="num text-right text-[11px] text-fog">{Math.round(r.winRate)}%</span>
              <span className={cx("num text-right text-[12.5px] font-bold", rCls(r.netR))}>{fmtR(r.netR)}R</span>
            </div>
            <p className="num mt-0.5 text-[10.5px] text-dim">
              {t("R medio")} <span className={rCls(r.avgR)}>{fmtR(r.avgR)}</span> · {r.longs.ops} {t("compras")} <span className={rCls(r.longs.netR)}>{fmtR(r.longs.netR)}R</span> · {r.shorts.ops} {t("ventas")} <span className={rCls(r.shorts.netR)}>{fmtR(r.shorts.netR)}R</span>
              {r.open > 0 && <> · {r.open} {t("abiertas")}</>}
            </p>
          </li>
        ))}
      </ul>
      <p className="px-5 pb-4 text-[11px] leading-relaxed text-dim">{t("Con menos de 30 operaciones cerradas por perfil, los resultados todavía no dicen mucho: se pueden deber a un solo día de mercado.")}</p>
    </Panel>
  );
}

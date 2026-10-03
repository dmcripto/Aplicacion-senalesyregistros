import { useMemo } from "react";
import { cx, fmtR, tagStats } from "../lib";
import type { Trade } from "../lib";
import { t } from "../lib";
import Panel from "./Panel";

export default function TagStats({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => tagStats(trades), [trades]);
  if (!rows.length) return null;
  return (
    <Panel
      id="tags"
      title={t("RESULTADO POR ETIQUETA")}
      subtitle={t("Qué te suma y qué te resta")}
      summary={`${rows.length} ${t("etiquetas")}`}
      defaultOpen={false}
    >
      <ul className="px-5 py-3">
        {rows.map((r) => (
          <li key={r.tag} className="grid grid-cols-[1fr_44px_44px_64px] items-center gap-2 border-b border-line/50 py-2.5 last:border-b-0">
            <span className="truncate text-[12.5px] font-semibold text-snow">{t(r.tag)}</span>
            <span className="num text-right text-[11px] text-fog">{r.ops} {t("ops")}</span>
            <span className="num text-right text-[11px] text-fog">{Math.round(r.winRate)}%</span>
            <span className={cx("num text-right text-[12.5px] font-bold", r.netR > 0 ? "text-bull" : r.netR < 0 ? "text-bear" : "text-fog")}>
              {fmtR(r.netR)}R
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

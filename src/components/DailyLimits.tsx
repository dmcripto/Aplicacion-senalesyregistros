import { useEffect, useState } from "react";
import { cx, fmtR } from "../lib";
import type { DailyLimits, DailyStatus } from "../lib";
import { t } from "../lib";
import Panel from "./Panel";

export function LimitBanner({ status }: { status: DailyStatus }) {
  if (!status.messages.length) return null;
  const stop = status.level === "stop";
  return (
    <div
      role="alert"
      className={cx(
        "flex items-start gap-3 rounded-lg border px-5 py-3.5 text-[13px] leading-relaxed",
        stop ? "border-bear/60 bg-beardeep/50 text-bear" : "border-gold/50 bg-golddeep/40 text-gold",
      )}
    >
      <span aria-hidden className="text-lg">{stop ? "⛔" : "⚠"}</span>
      <div>
        <b className="block uppercase tracking-[0.1em]">{stop ? t("Frená por hoy") : t("Cuidado con tu límite diario")}</b>
        {status.messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
    </div>
  );
}

export default function DailyLimitsCard({
  limits,
  status,
  onSave,
}: {
  limits: DailyLimits;
  status: DailyStatus;
  onSave: (l: DailyLimits) => Promise<void>;
}) {
  const [loss, setLoss] = useState("");
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoss(limits.maxLossR == null ? "" : String(limits.maxLossR));
    setCount(limits.maxTrades == null ? "" : String(limits.maxTrades));
  }, [limits]);

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ maxLossR: num(loss), maxTrades: num(count) ? Math.round(num(count)!) : null });
    } finally {
      setBusy(false);
    }
  };

  const bar = (value: number, limit: number | null, state: string) =>
    limit ? (
      <span className="block h-2 overflow-hidden rounded-full bg-ink">
        <span
          className={cx("block h-full rounded-full", state === "reached" ? "bg-bear" : state === "near" ? "bg-gold" : "bg-bull")}
          style={{ width: `${Math.min(100, (value / limit) * 100)}%` }}
        />
      </span>
    ) : null;

  return (
    <Panel
      id="limits"
      title={t("LÍMITES DIARIOS")}
      subtitle={t("Disciplina: frená antes de que sea tarde")}
      summary={`${status.trades}${limits.maxTrades ? ` / ${limits.maxTrades}` : ""} ${t("operaciones")} · ${fmtR(status.lossR)}R`}
      defaultOpen={false}
    >
      <div className="space-y-4 p-5">
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-[12px]">
              <span className="text-fog">{t("Resultado de hoy")}</span>
              <span className={cx("num font-bold", status.lossR > 0 ? "text-bull" : status.lossR < 0 ? "text-bear" : "text-fog")}>
                {fmtR(status.lossR)}R{limits.maxLossR ? ` / −${limits.maxLossR}R` : ""}
              </span>
            </div>
            {bar(Math.max(0, -status.lossR), limits.maxLossR, status.lossState)}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12px]">
              <span className="text-fog">{t("Operaciones de hoy")}</span>
              <span className="num font-bold text-snow">
                {status.trades}
                {limits.maxTrades ? ` / ${limits.maxTrades}` : ""}
              </span>
            </div>
            {bar(status.trades, limits.maxTrades, status.tradesState)}
          </div>
        </div>

        <>
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex gap-2.5">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">{t("Pérdida máx. (R)")}</span>
                <input inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder={t("ej: 3")} className="field num" />
              </label>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">{t("Operaciones máx.")}</span>
                <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder={t("ej: 5")} className="field num" />
              </label>
            </div>
            <button
              onClick={save}
              disabled={busy}
              className="w-full rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 disabled:opacity-50"
            >
              {t("Guardar límites")}
            </button>
            <p className="text-[10.5px] leading-relaxed text-dim">
              {t("Dejá un campo vacío para no usar ese límite. Te avisamos al llegar al 80 % y cuando lo alcanzás.")}
            </p>
          </div>
        </>
      </div>
    </Panel>
  );
}

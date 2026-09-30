import { useEffect, useState } from "react";
import { balanceInfo, cx, fmtCurrency, rValueMoney } from "../lib";
import type { MoneySettings, Trade } from "../lib";

export default function MoneyCard({
  money,
  trades,
  onSave,
}: {
  money: MoneySettings;
  trades: Trade[];
  onSave: (m: MoneySettings) => Promise<void>;
}) {
  const [capital, setCapital] = useState("");
  const [risk, setRisk] = useState("1");
  const [currency, setCurrency] = useState("USD");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCapital(money.capital == null ? "" : String(money.capital));
    setRisk(money.riskPct == null ? "1" : String(money.riskPct));
    setCurrency(money.currency);
  }, [money]);

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const draft: MoneySettings = { capital: num(capital), riskPct: num(risk), currency: currency.trim().toUpperCase() || "USD" };
  const unit = rValueMoney(draft);
  const info = balanceInfo(trades, money);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-line px-5 py-4 text-left"
      >
        <span>
          <span className="block font-display text-2xl font-bold tracking-wide text-snow">CAPITAL Y DINERO</span>
          <span className="block text-[11px] uppercase tracking-[0.16em] text-dim">Tus resultados en dinero, no solo en R</span>
        </span>
        <span className="shrink-0 text-lg text-gold" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div className="space-y-3 p-5">
        {info ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-line bg-ink/50 p-3">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">Balance</p>
              <p className="num text-lg font-bold text-snow">{fmtCurrency(info.balance, money.currency, false)}</p>
            </div>
            <div className="rounded-md border border-line bg-ink/50 p-3">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">Resultado</p>
              <p className={cx("num text-lg font-bold", info.pnl >= 0 ? "text-bull" : "text-bear")}>
                {fmtCurrency(info.pnl, money.currency)} <span className="text-[11px]">({info.returnPct >= 0 ? "+" : "−"}{Math.abs(info.returnPct).toFixed(1)}%)</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-fog">
            Cargá tu capital y cuánto arriesgás por operación para ver tu balance y tus resultados en dinero.
          </p>
        )}

        {open && (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex gap-2.5">
              <label className="min-w-0 flex-[1.4]">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">Capital inicial</span>
                <input inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} placeholder="1000" className="field num" />
              </label>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">Riesgo (%)</span>
                <input inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="1" className="field num" />
              </label>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">Moneda</span>
                <input value={currency} maxLength={5} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" className="field num uppercase" />
              </label>
            </div>
            <p className="text-[11.5px] text-fog">
              {unit ? (
                <>
                  1R equivale a <b className="num text-gold">{fmtCurrency(unit, draft.currency, false)}</b>: es lo que perdés si una operación toca el stop.
                </>
              ) : (
                "Completá capital y riesgo para calcular cuánto vale 1R."
              )}
            </p>
            <button
              onClick={save}
              disabled={busy}
              className="w-full rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 disabled:opacity-50"
            >
              Guardar
            </button>
            <p className="text-[10.5px] leading-relaxed text-dim">
              El dinero se calcula multiplicando tus R por el valor de 1R (riesgo fijo sobre el capital inicial). Es una
              estimación: no incluye comisiones ni deslizamiento.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

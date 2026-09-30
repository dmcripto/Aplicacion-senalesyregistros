import { useEffect, useMemo, useState } from "react";
import { calcPosition, fmtMoney, fmtPrice, fmtQty } from "../lib";

const STORE_KEY = "veltrix_risk_settings_v1";

const fieldLabel = "mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog";

export default function RiskCalculator({ notify }: { notify: (msg: string, kind?: "ok" | "err" | "info") => void }) {
  const [capital, setCapital] = useState("");
  const [riskPct, setRiskPct] = useState("1");
  const [leverage, setLeverage] = useState("");
  const [fee, setFee] = useState("");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string>;
      if (s.capital) setCapital(s.capital);
      if (s.riskPct) setRiskPct(s.riskPct);
      if (s.leverage) setLeverage(s.leverage);
      if (s.fee) setFee(s.fee);
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ capital, riskPct, leverage, fee }));
    } catch {
      /* sin almacenamiento */
    }
  }, [capital, riskPct, leverage, fee]);

  const n = (v: string) => Number(v.replace(",", "."));
  const res = useMemo(
    () =>
      calcPosition({
        capital: n(capital),
        riskPct: n(riskPct),
        entry: n(entry),
        sl: n(sl),
        tp: tp.trim() ? n(tp) : undefined,
        leverage: leverage.trim() ? n(leverage) : undefined,
        feePct: fee.trim() ? n(fee) : undefined,
      }),
    [capital, riskPct, entry, sl, tp, leverage, fee],
  );

  const copy = async () => {
    if (!res) return;
    try {
      await navigator.clipboard.writeText(String(Number(res.units.toPrecision(6))));
      notify("Cantidad copiada.");
    } catch {
      notify("No se pudo copiar automáticamente.", "err");
    }
  };

  const input = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label className="min-w-0 flex-1">
      <span className={fieldLabel}>{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="field num"
      />
    </label>
  );

  const row = (label: string, value: string, color = "text-snow") => (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[12px]">
      <span className="text-fog">{label}</span>
      <span className={`num font-bold ${color}`}>{value}</span>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-line px-5 py-4 text-left"
      >
        <span>
          <span className="block font-display text-2xl font-bold tracking-wide text-snow">CALCULADORA DE RIESGO</span>
          <span className="block text-[11px] uppercase tracking-[0.16em] text-dim">
            Cuánto operar para no perder más de lo que decidiste
          </span>
        </span>
        <span className="shrink-0 text-lg text-gold" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 p-5">
          <div className="flex gap-2.5">
            {input("Capital ($)", capital, setCapital, "1000")}
            {input("Riesgo (%)", riskPct, setRiskPct, "1")}
          </div>
          <div className="flex gap-2.5">
            {input("Apalancamiento (x)", leverage, setLeverage, "opcional")}
            {input("Comisión (%)", fee, setFee, "opcional")}
          </div>
          <div className="flex gap-2.5">
            {input("Entrada", entry, setEntry, "65000")}
            {input("Stop loss", sl, setSl, "64350")}
            {input("Take profit", tp, setTp, "opcional")}
          </div>

          {res ? (
            <div className="space-y-2.5 rounded-md border border-gold/40 bg-ink/50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-dim">
                Cantidad a operar · {res.direction === "LONG" ? "compra" : "venta"}
              </p>
              <div className="flex items-center justify-between gap-3">
                <p className="num text-3xl font-bold text-gold">{fmtQty(res.units)}</p>
                <button
                  onClick={copy}
                  className="rounded border border-line px-3 py-1.5 text-[11px] font-semibold text-fog transition-colors hover:border-line2 hover:text-snow"
                >
                  Copiar
                </button>
              </div>
              {row("Arriesgás", fmtMoney(res.riskAmount), "text-bear")}
              {row("Valor de la posición", fmtMoney(res.notional))}
              {res.margin != null && row("Margen necesario", fmtMoney(res.margin))}
              {row("Distancia al stop", `${res.stopPct.toFixed(2)} % (${fmtPrice(res.stopDistance)})`)}
              {res.fees > 0 && row("Comisiones estimadas", fmtMoney(res.fees))}
              {res.profitAtTp != null && row("Ganás si toca el TP", fmtMoney(res.profitAtTp), "text-bull")}
              {res.rr != null && row("Riesgo : beneficio", `1 : ${res.rr.toFixed(2)}`, "text-gold")}
              {res.warnings.map((w) => (
                <p key={w} className="rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2 text-[11.5px] leading-relaxed text-bear">
                  ⚠ {w}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-center text-[11.5px] text-dim">
              Completá capital, riesgo, entrada y stop loss para ver cuánto operar.
            </p>
          )}
          <p className="text-center text-[10.5px] text-dim">
            Cálculo orientativo. Verificá siempre los valores en tu plataforma antes de operar.
          </p>
        </div>
      )}
    </section>
  );
}

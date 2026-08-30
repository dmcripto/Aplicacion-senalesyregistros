import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  EXAMPLE_ALERT,
  cx,
  parseAlerts,
  toLocalInput,
} from "../lib";
import type { Direction, NewTrade, ParseResult } from "../lib";
import { IconCheck, IconClipboard, IconPlus, IconAlert, TriDown, TriUp } from "../ui";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

export default function TradeForm({ onAdd, notify }: { onAdd: (t: NewTrade[]) => void; notify: Notify }) {
  const [tab, setTab] = useState<"pegar" | "manual">("pegar");

  // ── Pegar alerta ──
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  const interpret = () => setParsed(parseAlerts(text));

  const confirmPaste = () => {
    if (!parsed || !parsed.valid.length) return;
    onAdd(parsed.valid);
    setText("");
    setParsed(null);
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        notify("El portapapeles está vacío.", "err");
        return;
      }
      setText(t);
      setParsed(parseAlerts(t));
    } catch {
      notify("Tu navegador bloqueó el acceso al portapapeles — pegá el texto manualmente (Ctrl+V).", "err");
    }
  };

  // ── Manual ──
  const [symbol, setSymbol] = useState("");
  const [dir, setDir] = useState<Direction>("LONG");
  const [entry, setEntry] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [date, setDate] = useState(() => toLocalInput(new Date()));
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const nums = useMemo(() => {
    const n = (s: string) => Number(s.replace(",", "."));
    return { entry: n(entry), tp: n(tp), sl: n(sl) };
  }, [entry, tp, sl]);

  const liveRR = useMemo(() => {
    const { entry: e, tp: t, sl: s } = nums;
    if (![e, t, s].every((v) => Number.isFinite(v) && v > 0)) return null;
    const risk = Math.abs(e - s);
    if (risk <= 0) return null;
    return Math.abs(t - e) / risk;
  }, [nums]);

  const submitManual = (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    const { entry: e, tp: t, sl: s } = nums;
    if (!symbol.trim()) errs.symbol = "Ingresá el símbolo (ej: BTCUSDT).";
    if (!Number.isFinite(e) || e <= 0) errs.entry = "Entrada inválida.";
    if (!Number.isFinite(t) || t <= 0) errs.tp = "TP inválido.";
    if (!Number.isFinite(s) || s <= 0) errs.sl = "SL inválido.";
    if (!errs.entry && !errs.tp && !errs.sl) {
      if (Math.abs(e - s) === 0) errs.sl = "El SL no puede ser igual a la entrada.";
      else if (dir === "LONG" && (t <= e || s >= e))
        errs.tp = "En LONG el TP debe estar arriba de la entrada y el SL abajo.";
      else if (dir === "SHORT" && (t >= e || s <= e))
        errs.tp = "En SHORT el TP debe estar abajo de la entrada y el SL arriba.";
    }
    if (!date) errs.date = "Elegí fecha y hora.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    onAdd([
      {
        symbol: symbol.trim().toUpperCase(),
        direction: dir,
        entry: e,
        tp: t,
        sl: s,
        date: new Date(date).toISOString(),
        notes: notes.trim() || undefined,
      },
    ]);
    setSymbol("");
    setEntry("");
    setTp("");
    setSl("");
    setNotes("");
    setErrors({});
  };

  const tabBtn = (active: boolean) =>
    cx(
      "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition-all duration-200",
      active ? "bg-gold text-ink shadow-[0_4px_18px_rgba(243,183,30,.25)]" : "text-fog hover:text-snow",
    );

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow">REGISTRAR OPERACIÓN</h2>
          <p className="text-[11px] uppercase tracking-[0.16em] text-dim">Alerta del indicador o carga manual</p>
        </div>
      </header>

      <div className="p-5">
        <div className="mb-4 flex gap-1 rounded-lg border border-line bg-ink p-1">
          <button onClick={() => setTab("pegar")} className={tabBtn(tab === "pegar")}>
            <IconClipboard className="h-3.5 w-3.5" /> Pegar alerta
          </button>
          <button onClick={() => setTab("manual")} className={tabBtn(tab === "manual")}>
            <IconPlus className="h-3.5 w-3.5" /> Manual
          </button>
        </div>

        {tab === "pegar" ? (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setParsed(null);
              }}
              rows={3}
              spellCheck={false}
              placeholder={"DMCRIPTO|SYMBOL|DIRECCION|ENTRADA|TP|SL\n" + EXAMPLE_ALERT}
              className="field num min-h-[86px] resize-y text-[12px] leading-relaxed"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={interpret}
                disabled={!text.trim()}
                className="rounded-md bg-gold px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35"
              >
                Interpretar
              </button>
              <button
                onClick={pasteFromClipboard}
                className="rounded-md border border-line px-3.5 py-2 text-[12px] font-semibold text-fog transition-colors hover:border-line2 hover:bg-raise hover:text-snow"
              >
                Desde portapapeles
              </button>
              <button
                onClick={() => {
                  setText(EXAMPLE_ALERT);
                  setParsed(parseAlerts(EXAMPLE_ALERT));
                }}
                className="rounded-md border border-line px-3.5 py-2 text-[12px] font-semibold text-fog transition-colors hover:border-line2 hover:bg-raise hover:text-snow"
              >
                Ejemplo
              </button>
            </div>

            {parsed && (
              <div className="pop-in space-y-2">
                {parsed.valid.map((v, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-bull/30 bg-bulldeep/30 px-3 py-2">
                    <span className="num flex items-center gap-2 text-[12px] font-semibold text-snow">
                      <IconCheck className="h-3.5 w-3.5 text-bull" />
                      {v.symbol}
                      <span className={v.direction === "LONG" ? "text-bull" : "text-bear"}>
                        {v.direction}
                      </span>
                    </span>
                    <span className="num text-[11px] text-fog">
                      {v.entry} → TP {v.tp} · SL {v.sl}
                    </span>
                  </div>
                ))}
                {parsed.errors.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2 text-[12px] text-bear">
                    <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{e}</span>
                  </div>
                ))}
                {parsed.valid.length > 0 && (
                  <button
                    onClick={confirmPaste}
                    className="w-full rounded-md bg-bull px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    Confirmar {parsed.valid.length} {parsed.valid.length === 1 ? "operación" : "operaciones"}
                  </button>
                )}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-dim">
              Acepta varias líneas a la vez, con o sin el prefijo <span className="num text-fog">DMCRIPTO</span>.
              Dirección: COMPRA/VENTA o LONG/SHORT.
            </p>
          </div>
        ) : (
          <form onSubmit={submitManual} className="space-y-3" noValidate>
            <div className="flex gap-2.5">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">Activo</label>
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="BTCUSDT"
                  className={cx("field num uppercase", errors.symbol && "field-error")}
                />
                {errors.symbol && <p className="mt-1 text-[11px] text-bear">{errors.symbol}</p>}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">Dirección</label>
                <div className="flex overflow-hidden rounded-md border border-line">
                  <button
                    type="button"
                    onClick={() => setDir("LONG")}
                    className={cx(
                      "num flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-bold transition-all",
                      dir === "LONG" ? "bg-bull/15 text-bull" : "bg-ink text-dim hover:text-fog",
                    )}
                  >
                    <TriUp className="h-2 w-2" /> LONG
                  </button>
                  <button
                    type="button"
                    onClick={() => setDir("SHORT")}
                    className={cx(
                      "num flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-bold transition-all",
                      dir === "SHORT" ? "bg-bear/15 text-bear" : "bg-ink text-dim hover:text-fog",
                    )}
                  >
                    <TriDown className="h-2 w-2" /> SHORT
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  ["entry", "Entrada", entry, setEntry],
                  ["tp", "Take Profit", tp, setTp],
                  ["sl", "Stop Loss", sl, setSl],
                ] as const
              ).map(([key, label, val, set]) => (
                <div key={key}>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">{label}</label>
                  <input
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    inputMode="decimal"
                    placeholder={key === "entry" ? "65405.8" : key === "tp" ? "66694.4" : "65161.1"}
                    className={cx("field num", errors[key] && "field-error")}
                  />
                  {errors[key] && <p className="mt-1 text-[11px] leading-tight text-bear">{errors[key]}</p>}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">Fecha y hora</label>
                <input
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={cx("field num", errors.date && "field-error")}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-fog">
                  Notas <span className="normal-case text-dim">(opcional — setup, confluencia, emoción)</span>
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="OB de H1 + FVG, sesión NY…"
                  className="field"
                />
              </div>
            </div>

            <div
              className={cx(
                "num flex items-center justify-between rounded-md border px-3.5 py-2.5 text-[12px] font-semibold transition-colors",
                liveRR == null ? "border-line bg-ink text-dim" : "border-gold/35 bg-golddeep/30 text-gold",
              )}
            >
              <span className="font-body text-[10px] font-bold uppercase tracking-[0.16em] text-fog">R:R planificado</span>
              <span>{liveRR == null ? "Riesgo 1 : Beneficio —" : `Riesgo 1 : Beneficio ${liveRR.toFixed(2)}`}</span>
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-gold px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Añadir al diario
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { INDICATOR_DEFAULT_PERIOD, INDICATOR_KINDS, binanceSymbol, computeIndicator, cx, fmtPrice, locale, t } from "../lib";
import type { ChartCandle, IndicatorKind, Trade } from "../lib";
import Panel from "./Panel";

const TFS = ["5m", "15m", "1h", "4h", "1d"] as const;
type Tf = (typeof TFS)[number];
const KEY = "veltrix_chart_v1";
const LIMIT = 500;
const REFRESH_MS = 30_000;

interface Slot {
  kind: IndicatorKind | "none";
  period: number;
}
interface Prefs {
  symbol: string;
  tf: Tf;
  slots: [Slot, Slot];
}
const DEFAULTS: Prefs = {
  symbol: "BTCUSDT",
  tf: "1h",
  slots: [
    { kind: "ema", period: 50 },
    { kind: "rsi", period: 14 },
  ],
};

const loadPrefs = (): Prefs => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return DEFAULTS;
    const slot = (s: any, d: Slot): Slot => ({
      kind: s && (s.kind === "none" || INDICATOR_KINDS.includes(s.kind)) ? s.kind : d.kind,
      period: Number.isFinite(Number(s?.period)) && Number(s.period) > 0 ? Math.min(500, Math.round(Number(s.period))) : d.period,
    });
    return {
      symbol: typeof v.symbol === "string" && binanceSymbol(v.symbol) ? v.symbol : DEFAULTS.symbol,
      tf: TFS.includes(v.tf) ? v.tf : DEFAULTS.tf,
      slots: [slot(v.slots?.[0], DEFAULTS.slots[0]), slot(v.slots?.[1], DEFAULTS.slots[1])],
    };
  } catch {
    return DEFAULTS;
  }
};
const savePrefs = (p: Prefs) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: queda solo para esta visita */
  }
};

/** Velas de Binance (futuros; si el par no existe ahí, spot). */
async function fetchCandles(raw: string, tf: Tf, signal: AbortSignal): Promise<ChartCandle[]> {
  const b = binanceSymbol(raw);
  if (!b) throw new Error("symbol");
  const bases = [`https://fapi.binance.com/fapi/v1`, `https://api.binance.com/api/v3`];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/klines?symbol=${b.symbol}&interval=${tf}&limit=${LIMIT}`, { signal });
      if (!res.ok) continue;
      const rows = (await res.json()) as unknown[][];
      if (!Array.isArray(rows) || !rows.length) continue;
      return rows.map((r) => ({ time: Math.floor(Number(r[0]) / 1000), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) }));
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  throw new Error("no-data");
}

const indName = (k: Slot["kind"]) =>
  ({ none: t("Ninguno"), ema: t("EMA (media exponencial)"), sma: t("SMA (media simple)"), bb: t("Bandas de Bollinger"), rsi: t("RSI"), macd: t("MACD") })[k];

const BULL = "#16d98a";
const BEAR = "#ff4d67";
const CYAN = "#2ec4f1";

function ChartBody({ trades }: { trades: Trade[] }) {
  const initial = useMemo(() => {
    const p = loadPrefs();
    // Si hay una señal abierta con un activo cripto y nunca se eligió otro, arranca con ese activo.
    const open = trades.find((x) => x.outcome === "ABIERTA" && binanceSymbol(x.symbol));
    try {
      if (open && !localStorage.getItem(KEY)) return { ...p, symbol: binanceSymbol(open.symbol)!.symbol };
    } catch {
      /* igual */
    }
    return p;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [draft, setDraft] = useState(initial.symbol);
  const [candles, setCandles] = useState<ChartCandle[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const boxRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ update: (c: ChartCandle[], p: Prefs, levels: Trade[]) => void; destroy: () => void } | null>(null);
  const symbolKey = binanceSymbol(prefs.symbol)?.symbol ?? prefs.symbol;

  const change = (next: Partial<Prefs>) =>
    setPrefs((p) => {
      const n = { ...p, ...next };
      savePrefs(n);
      return n;
    });
  const setSlot = (i: 0 | 1, s: Partial<Slot>) =>
    setPrefs((p) => {
      const slots: [Slot, Slot] = [{ ...p.slots[0] }, { ...p.slots[1] }];
      slots[i] = { ...slots[i], ...s };
      if (s.kind && s.kind !== "none" && s.kind !== p.slots[i].kind) slots[i].period = INDICATOR_DEFAULT_PERIOD[s.kind] || slots[i].period;
      const n = { ...p, slots };
      savePrefs(n);
      return n;
    });

  // Velas: al cambiar de activo o de temporalidad, y cada 30 segundos.
  useEffect(() => {
    const ctl = new AbortController();
    let first = true;
    const load = async () => {
      if (document.hidden && !first) return;
      try {
        const c = await fetchCandles(prefs.symbol, prefs.tf, ctl.signal);
        setCandles(c);
        setState("ok");
      } catch {
        if (ctl.signal.aborted) return;
        if (first) setState("error");
      }
      first = false;
    };
    setState("loading");
    void load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      ctl.abort();
      window.clearInterval(id);
    };
  }, [prefs.symbol, prefs.tf]);

  // Gráfico: se crea una vez (la librería se baja recién al abrir esta sección).
  useEffect(() => {
    let dead = false;
    const el = boxRef.current;
    if (!el) return;
    void import("lightweight-charts").then((lc) => {
      if (dead || !el) return;
      const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
      const chart = lc.createChart(el, {
        autoSize: true,
        height: 460,
        layout: { background: { type: lc.ColorType.Solid, color: "transparent" }, textColor: "#93a5ba", fontSize: 11, panes: { separatorColor: "#223042", separatorHoverColor: "#2e415a" } },
        grid: { vertLines: { color: "rgba(34,48,66,0.45)" }, horzLines: { color: "rgba(34,48,66,0.45)" } },
        rightPriceScale: { borderColor: "#223042" },
        timeScale: {
          borderColor: "#223042",
          timeVisible: true,
          rightOffset: 6,
          tickMarkFormatter: (time: number, type: number) => {
            const d = new Date(time * 1000);
            if (type >= 3) return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
            return d.toLocaleDateString(locale(), type === 0 ? { year: "numeric" } : type === 1 ? { month: "short" } : { day: "numeric", month: "short" });
          },
        },
        localization: { timeFormatter: fmtTime },
        crosshair: { mode: lc.CrosshairMode.Normal },
      });
      let extra: Array<{ remove: () => void }> = [];
      let lines: any[] = [];
      const candle = chart.addSeries(lc.CandlestickSeries, { upColor: BULL, downColor: BEAR, borderUpColor: BULL, borderDownColor: BEAR, wickUpColor: BULL, wickDownColor: BEAR });
      let lastKey = "";

      apiRef.current = {
        update(c, p, levels) {
          const range = chart.timeScale().getVisibleLogicalRange();
          candle.setData(c.map((x) => ({ time: x.time as any, open: x.open, high: x.high, low: x.low, close: x.close })));
          // Indicadores: se rehacen enteros (son baratos con 500 velas).
          for (const s of extra) s.remove();
          extra = [];
          let sub = 0;
          p.slots.forEach((s, i) => {
            if (s.kind === "none") return;
            const r = computeIndicator(s.kind, s.period, c, i as 0 | 1);
            const pane = r.pane === "price" ? 0 : ++sub;
            r.lines.forEach((l, li) => {
              const data = l.values.map((v, k) => (v == null ? null : { time: c[k].time as any, value: v })).filter(Boolean) as any[];
              const series =
                l.kind === "hist"
                  ? chart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, base: 0 }, pane)
                  : chart.addSeries(lc.LineSeries, { color: l.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: r.pane === "sub" && li === (r.lines.length > 1 ? 1 : 0), title: r.pane === "sub" ? l.name : "" }, pane);
              series.setData(
                l.kind === "hist" ? data.map((d) => ({ ...d, color: d.value >= 0 ? "rgba(22,217,138,0.55)" : "rgba(255,77,103,0.55)" })) : data,
              );
              if (li === 0 && r.guides.length && r.pane === "sub") for (const g of r.guides) series.createPriceLine({ price: g, color: "rgba(147,165,186,0.45)", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "" });
              extra.push({ remove: () => chart.removeSeries(series) });
            });
          });
          // Altura: las velas ocupan lo principal; cada panel de abajo, una franja.
          const panes = chart.panes();
          panes.forEach((pn, i) => i > 0 && pn.setHeight(110));
          // Niveles de las señales abiertas de este activo.
          for (const l of lines) candle.removePriceLine(l);
          lines = [];
          for (const tr of levels) {
            const add = (price: number, color: string, title: string, dashed = false) =>
              lines.push(candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: dashed ? lc.LineStyle.Dotted : lc.LineStyle.Dashed, axisLabelVisible: true, title }));
            add(tr.entry, CYAN, `${t("Entrada")} ${tr.direction}`);
            tr.targets?.forEach((x, i) => add(x, BULL, `TP${i + 1}`, true));
            add(tr.tp, BULL, "TP");
            add(tr.sl, BEAR, "SL");
          }
          const key = `${p.symbol}|${p.tf}`;
          if (key !== lastKey) {
            lastKey = key;
            chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, c.length - 120), to: c.length + 6 });
          } else if (range) chart.timeScale().setVisibleLogicalRange(range);
        },
        destroy: () => chart.remove(),
      };
      setReady((n) => n + 1);
    });
    return () => {
      dead = true;
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, []);
  const [ready, setReady] = useState(0);

  const levels = useMemo(() => trades.filter((x) => x.outcome === "ABIERTA" && binanceSymbol(x.symbol)?.symbol === symbolKey), [trades, symbolKey]);

  useEffect(() => {
    if (candles && ready) apiRef.current?.update(candles, prefs, levels);
  }, [candles, prefs, levels, ready]);

  const last = candles?.[candles.length - 1];
  const first = candles?.[Math.max(0, candles.length - 1 - (prefs.tf === "1d" ? 1 : prefs.tf === "4h" ? 6 : prefs.tf === "1h" ? 24 : prefs.tf === "15m" ? 96 : 288))];
  const change24 = last && first && first.close ? ((last.close - first.close) / first.close) * 100 : null;

  const submit = () => {
    const b = binanceSymbol(draft);
    if (!b) return;
    setDraft(b.symbol);
    change({ symbol: b.symbol });
  };
  const field = "rounded-md border border-line bg-ink px-2.5 py-1.5 text-[12.5px] text-snow outline-none focus:border-gold";
  const quick = [...new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", ...trades.filter((x) => x.outcome === "ABIERTA").map((x) => binanceSymbol(x.symbol)?.symbol).filter(Boolean) as string[]])].slice(0, 6);

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value.toUpperCase())} className={cx(field, "num w-32 uppercase")} aria-label={t("Activo")} placeholder="BTCUSDT" />
          <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-fog hover:border-line2 hover:text-snow">
            {t("Ver")}
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {quick.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setDraft(s);
                change({ symbol: s });
              }}
              className={cx("num rounded-md border px-2 py-1 text-[11px] font-semibold", s === symbolKey ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-dim hover:text-fog")}
            >
              {s.replace(/USDT$/, "")}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1" role="group" aria-label={t("Temporalidad")}>
          {TFS.map((x) => (
            <button key={x} type="button" onClick={() => change({ tf: x })} className={cx("num rounded-md border px-2.5 py-1 text-[11px] font-bold", x === prefs.tf ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-dim hover:text-fog")}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {([0, 1] as const).map((i) => {
          const s = prefs.slots[i];
          const dot = i === 0 ? "#f5c518" : "#c084fc";
          return (
            <label key={i} className="flex items-center gap-2 rounded-lg border border-line bg-ink/40 px-3 py-2 text-[11.5px] text-dim">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
              <span className="shrink-0 font-semibold text-fog">{t("Indicador {n}", { n: i + 1 })}</span>
              <select value={s.kind} onChange={(e) => setSlot(i, { kind: e.target.value as Slot["kind"] })} className={cx(field, "w-0 min-w-0 flex-1")}>
                {(["none", ...INDICATOR_KINDS] as const).map((k) => (
                  <option key={k} value={k}>
                    {indName(k)}
                  </option>
                ))}
              </select>
              {s.kind !== "none" && s.kind !== "macd" && (
                <input type="number" min={2} max={500} value={s.period} onChange={(e) => setSlot(i, { period: Number(e.target.value) })} className={cx(field, "num w-16")} aria-label={t("Período")} />
              )}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="num text-[15px] font-bold text-snow">{last ? fmtPrice(last.close) : "—"}</span>
        {change24 != null && <span className={cx("num text-[12px] font-semibold", change24 >= 0 ? "text-bull" : "text-bear")}>{`${change24 >= 0 ? "+" : "−"}${Math.abs(change24).toFixed(2)}%`}</span>}
        {levels.length > 0 && <span className="text-[11.5px] text-gold">{t("Se muestran tus señales abiertas de este activo: entrada, TP y SL.")}</span>}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-line bg-ink/30">
        <div ref={boxRef} className="h-[460px] w-full" />
        {state !== "ok" && (
          <div className="absolute inset-0 grid place-items-center bg-ink/70 px-6 text-center text-[12.5px] text-dim">
            {state === "loading" ? t("Cargando velas…") : t("No se pudieron cargar las velas de este activo. Probá con otro (por ejemplo BTCUSDT).")}
          </div>
        )}
      </div>
      <p className="text-[10.5px] leading-relaxed text-dim">{t("Velas de Binance. Los indicadores se calculan con las últimas {n} velas. Es una herramienta de análisis, no asesoramiento financiero.", { n: LIMIT })}</p>
    </div>
  );
}

export default function ChartCard({ trades }: { trades: Trade[] }) {
  return (
    <Panel id="chart" title={t("GRÁFICO")} subtitle={t("Velas con 2 indicadores y tus señales abiertas")} summary={t("EMA, RSI, MACD, Bollinger · tocá para abrir")} defaultOpen={false}>
      <ChartBody trades={trades} />
    </Panel>
  );
}

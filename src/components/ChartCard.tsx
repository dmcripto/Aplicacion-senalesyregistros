import { useEffect, useMemo, useRef, useState } from "react";
import { INDICATOR_DEFAULT_PERIOD, INDICATOR_KINDS, INDICATOR_NO_PERIOD, binanceSymbol, computeIndicator, cx, fmtPrice, fmtUsdShort, locale, t } from "../lib";
import type { ChartCandle, IndicatorKind, LiquidationMap, Trade } from "../lib";
import { createAlert, fetchAlerts, fetchLiquidationMap } from "../tradesApi";
import type { UserAlert } from "../lib";
import AlertsSection from "./AlertsSection";
import ChartDrawings from "./ChartDrawings";
import Panel from "./Panel";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

const TFS = ["5m", "15m", "1h", "4h", "1d"] as const;
type Tf = (typeof TFS)[number];
const TF_SEC: Record<Tf, number> = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const KEY = "veltrix_chart_v1";
const LIMIT = 500;
const REFRESH_MS = 30_000;

interface Slot {
  kind: IndicatorKind | "none" | "liq"; // «liq» = mapa de liquidaciones (se dibuja sobre las velas)
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

const SIZE_KEY = "veltrix_chart_size_v1";
const SUB_PANE = 110;
const SCALE_LABEL = ["Normal", "Log", "%"] as const;
const loadPrefs = (): Prefs => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return DEFAULTS;
    const slot = (s: any, d: Slot): Slot => ({
      kind: s && (s.kind === "none" || s.kind === "liq" || INDICATOR_KINDS.includes(s.kind)) ? s.kind : d.kind,
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
  ({ none: t("Ninguno"), liq: t("🔥 Mapa de liquidaciones"), ema: t("EMA (media exponencial)"), sma: t("SMA (media simple)"), bb: t("Bandas de Bollinger"), rsi: t("RSI"), macd: t("MACD"), adx: t("ADX con DI+ / DI− (fuerza de tendencia)"), vol: t("Volumen con ballenas"), pdhl: t("Máx. / Mín. del día anterior"), fvg: t("Huecos FVG (zonas sin cubrir)"), sess: t("Sesiones: Asia, Londres y Nueva York") })[k];

const BULL = "#26a69a"; // verde y rojo de TradingView
const BEAR = "#ef5350";
const CYAN = "#2ec4f1";
const LIQ_LONG = "#ff9f43"; // niveles donde se liquidarían los largos (naranja)
const LIQ_SHORT = "#7c8cff"; // y donde se liquidarían los cortos (violeta azulado)

function ChartBody({ trades, userId, notify }: { trades: Trade[]; userId: string; notify: Notify }) {
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"normal" | "large">(() => {
    try {
      return localStorage.getItem(SIZE_KEY) === "large" ? "large" : "normal";
    } catch {
      return "normal";
    }
  });
  const [fs, setFs] = useState(false);
  const [subCount, setSubCount] = useState(0);
  const [scaleMode, setScaleMode] = useState<0 | 1 | 2>(0); // 0 normal · 1 logarítmica · 2 porcentaje
  const apiRef = useRef<{ update: (c: ChartCandle[], p: Prefs, levels: Trade[], alertLevels: number[], liq: LiquidationMap["hotspots"]) => void; destroy: () => void; chart: any; series: any } | null>(null);
  const symbolKey = binanceSymbol(prefs.symbol)?.symbol ?? prefs.symbol;
  const liqOn = prefs.slots.some((x) => x.kind === "liq");

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
      if (s.kind && s.kind !== "none" && s.kind !== "liq" && s.kind !== p.slots[i].kind) slots[i].period = INDICATOR_DEFAULT_PERIOD[s.kind] || slots[i].period;
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
        layout: { background: { type: lc.ColorType.Solid, color: "#131722" }, textColor: "#b2b5be", fontSize: 11, panes: { separatorColor: "#2a2e39", separatorHoverColor: "#363a45" } },
        grid: { vertLines: { color: "#1e222d" }, horzLines: { color: "#1e222d" } },
        rightPriceScale: { borderColor: "#2a2e39" },
        timeScale: {
          borderColor: "#2a2e39",
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
      let liqLines: any[] = [];
      const candle = chart.addSeries(lc.CandlestickSeries, { upColor: BULL, downColor: BEAR, borderUpColor: BULL, borderDownColor: BEAR, wickUpColor: BULL, wickDownColor: BEAR });
      let lastKey = "";

      apiRef.current = {
        update(c, p, levels, alertLevels, liq) {
          const range = chart.timeScale().getVisibleLogicalRange();
          candle.setData(c.map((x) => ({ time: x.time as any, open: x.open, high: x.high, low: x.low, close: x.close })));
          // Indicadores: se rehacen enteros (son baratos con 500 velas).
          for (const s of extra) s.remove();
          extra = [];
          let sub = 0;
          p.slots.forEach((s, i) => {
            if (s.kind === "none" || s.kind === "liq") return;
            const r = computeIndicator(s.kind, s.period, c, i as 0 | 1);
            const pane = r.pane === "price" ? 0 : ++sub;
            r.lines.forEach((l, li) => {
              const data = l.values.map((v, k) => (v == null ? null : { time: c[k].time as any, value: v })).filter(Boolean) as any[];
              const series =
                l.kind === "hist"
                  ? chart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, base: 0 }, pane)
                  : chart.addSeries(
                      lc.LineSeries,
                      {
                        color: l.color,
                        lineWidth: l.thin ? 1 : 2,
                        lineStyle: l.thin ? lc.LineStyle.Dotted : lc.LineStyle.Solid,
                        lineType: l.step ? lc.LineType.WithSteps : lc.LineType.Simple,
                        priceLineVisible: false,
                        crosshairMarkerVisible: !l.thin,
                        lastValueVisible: !!l.tag || (!l.thin && r.pane === "sub" && li === (r.lines.length > 1 ? 1 : 0)),
                        title: l.tag ?? (r.pane === "sub" ? l.name : ""),
                      },
                      pane,
                    );
              series.setData(
                l.kind === "hist"
                  ? l.values.flatMap((v, k) => (v == null ? [] : [{ time: c[k].time as any, value: v, color: l.colors?.[k] ?? (v >= 0 ? "rgba(22,217,138,0.55)" : "rgba(255,77,103,0.55)") }]))
                  : data,
              );
              if (li === 0 && r.guides.length && r.pane === "sub") for (const g of r.guides) series.createPriceLine({ price: g, color: "rgba(147,165,186,0.45)", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "" });
              extra.push({ remove: () => chart.removeSeries(series) });
            });
          });
          // Altura: las velas ocupan lo principal; cada panel de abajo, una franja.
          const panes = chart.panes();
          panes.forEach((pn, i) => i > 0 && pn.setHeight(SUB_PANE));
          setSubCount(sub);
          // Niveles de las señales abiertas de este activo.
          for (const l of lines) candle.removePriceLine(l);
          lines = [];
          const add = (price: number, color: string, title: string, dashed = false) =>
            lines.push(candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: dashed ? lc.LineStyle.Dotted : lc.LineStyle.Dashed, axisLabelVisible: true, title }));
          for (const tr of levels) {
            add(tr.entry, CYAN, `${t("Entrada")} ${tr.direction}`);
            tr.targets?.forEach((x, i) => add(x, BULL, `TP${i + 1}`, true));
            add(tr.tp, BULL, "TP");
            add(tr.sl, BEAR, "SL");
          }
          // Mis alertas de precio de este activo.
          for (const lv of alertLevels) add(lv, "#f5c518", `🔔 ${fmtPrice(lv)}`, true);
          // Mapa de liquidaciones: los niveles donde se concentran las liquidaciones estimadas (más gruesa = más dinero).
          for (const l of liqLines) candle.removePriceLine(l);
          liqLines = [];
          const maxUsd = Math.max(1, ...liq.map((h) => h.usd));
          for (const h of liq) {
            liqLines.push(
              candle.createPriceLine({
                price: h.price,
                color: h.side === "long" ? LIQ_LONG : LIQ_SHORT,
                lineWidth: h.usd > maxUsd * 0.66 ? 3 : h.usd > maxUsd * 0.33 ? 2 : 1,
                lineStyle: lc.LineStyle.Solid,
                axisLabelVisible: true,
                title: `${h.side === "long" ? t("Liq. largos") : t("Liq. cortos")} ${fmtUsdShort(h.usd)}`,
              }),
            );
          }
          const key = `${p.symbol}|${p.tf}`;
          if (key !== lastKey) {
            lastKey = key;
            chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, c.length - 120), to: c.length + 6 });
          } else if (range) chart.timeScale().setVisibleLogicalRange(range);
        },
        destroy: () => chart.remove(),
        chart,
        series: candle,
      };
      setReady((n) => n + 1);
    });
    return () => {
      dead = true;
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, []);
  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen?.().catch(() => notify(t("Tu navegador no permite la pantalla completa."), "err"));
  };
  const pickSize = (v: "normal" | "large") => {
    setSize(v);
    try {
      localStorage.setItem(SIZE_KEY, v);
    } catch {
      /* igual */
    }
  };
  const zoom = (f: number) => {
    const ts = apiRef.current?.chart.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2;
    const half = ((r.to - r.from) / 2) * f;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  };
  const [ready, setReady] = useState(0);
  useEffect(() => {
    apiRef.current?.chart.priceScale("right").applyOptions({ mode: scaleMode });
  }, [scaleMode, ready]);

  const levels = useMemo(() => trades.filter((x) => x.outcome === "ABIERTA" && binanceSymbol(x.symbol)?.symbol === symbolKey), [trades, symbolKey]);

  // Mis alertas (si todavía no se corrió el SQL de alertas, esa parte no se muestra).
  const [alerts, setAlerts] = useState<UserAlert[] | null>(null);
  const reloadAlerts = () => {
    fetchAlerts(userId)
      .then(setAlerts)
      .catch(() => setAlerts(null));
  };
  useEffect(() => {
    reloadAlerts();
    const id = window.setInterval(reloadAlerts, 30_000);
    return () => window.clearInterval(id);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const alertLevels = useMemo(() => (alerts ?? []).filter((a) => a.active && a.kind === "price" && a.symbol === symbolKey && a.level != null).map((a) => a.level as number), [alerts, symbolKey]);

  // Mapa de liquidaciones del activo (solo si está encendido; el servidor lo guarda unos minutos, así que pedirlo seguido no cuesta).
  const [liqMap, setLiqMap] = useState<LiquidationMap | null>(null);
  const [liqState, setLiqState] = useState<"off" | "loading" | "ok" | "none">("off");
  const liqCoin = symbolKey.replace(/(USDT|USDC|BUSD|USD)$/, "");
  useEffect(() => {
    if (!liqOn) {
      setLiqState("off");
      setLiqMap(null);
      return;
    }
    let dead = false;
    setLiqState("loading");
    const load = () =>
      fetchLiquidationMap(liqCoin)
        .then((r) => {
          if (dead) return;
          if (r.ok && r.data) {
            setLiqMap(r.data);
            setLiqState("ok");
          } else {
            setLiqMap(null);
            setLiqState("none");
          }
        })
        .catch(() => !dead && (setLiqMap(null), setLiqState("none")));
    void load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [liqOn, liqCoin]);
  const liqSpots = useMemo(() => (liqOn && liqMap ? liqMap.hotspots : []), [liqOn, liqMap]);

  useEffect(() => {
    if (candles && ready) apiRef.current?.update(candles, prefs, levels, alertLevels, liqSpots);
  }, [candles, prefs, levels, alertLevels, liqSpots, ready]);

  const last = candles?.[candles.length - 1];
  const first = candles?.[Math.max(0, candles.length - 1 - (prefs.tf === "1d" ? 1 : prefs.tf === "4h" ? 6 : prefs.tf === "1h" ? 24 : prefs.tf === "15m" ? 96 : 288))];
  const change24 = last && first && first.close ? ((last.close - first.close) / first.close) * 100 : null;

  const submit = () => {
    const b = binanceSymbol(draft);
    if (!b) return;
    setDraft(b.symbol);
    change({ symbol: b.symbol });
  };
  const field = "rounded border border-[#363a45] bg-[#1e222d] px-2.5 py-1.5 text-[12.5px] text-[#d1d4dc] outline-none focus:border-[#2962ff]";
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
            <label key={i} className="flex items-center gap-2 rounded border border-[#2a2e39] bg-[#131722] px-3 py-2 text-[11.5px] text-[#787b86]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
              <span className="shrink-0 font-semibold text-fog">{t("Indicador {n}", { n: i + 1 })}</span>
              <select value={s.kind} onChange={(e) => setSlot(i, { kind: e.target.value as Slot["kind"] })} className={cx(field, "w-0 min-w-0 flex-1")}>
                {(["none", ...INDICATOR_KINDS, "liq"] as const).map((k) => (
                  <option key={k} value={k}>
                    {indName(k)}
                  </option>
                ))}
              </select>
              {s.kind !== "none" && s.kind !== "liq" && !INDICATOR_NO_PERIOD.includes(s.kind) && (
                <input type="number" min={2} max={500} value={s.period} onChange={(e) => setSlot(i, { period: Number(e.target.value) })} className={cx(field, "num w-16")} aria-label={t("Período")} />
              )}
            </label>
          );
        })}
      </div>

      {liqOn && (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-dim">
          {liqState === "loading" && <span>{t("Calculando…")}</span>}
          {liqState === "none" && <span>{t("Este activo no tiene mapa de liquidaciones.")}</span>}
          {liqState === "ok" && (
            <span>
              <span style={{ color: LIQ_LONG }}>■</span> {t("largos")} · <span style={{ color: LIQ_SHORT }}>■</span> {t("cortos")} · {t("más gruesa = más dinero")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="num text-[15px] font-bold text-snow">{last ? fmtPrice(last.close) : "—"}</span>
        {change24 != null && <span className={cx("num text-[12px] font-semibold", change24 >= 0 ? "text-bull" : "text-bear")}>{`${change24 >= 0 ? "+" : "−"}${Math.abs(change24).toFixed(2)}%`}</span>}
        {levels.length > 0 && <span className="text-[11.5px] text-gold">{t("Se muestran tus señales abiertas de este activo: entrada, TP y SL.")}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="mr-1 text-dim">{t("Tamaño")}</span>
        {(["normal", "large"] as const).map((v) => (
          <button key={v} type="button" onClick={() => pickSize(v)} aria-pressed={size === v} className={cx("rounded border px-2 py-1 font-semibold", size === v ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-dim hover:text-fog")}>
            {v === "normal" ? t("Normal") : t("Grande")}
          </button>
        ))}
        <button type="button" onClick={toggleFs} className="rounded border border-line px-2 py-1 font-semibold text-dim hover:text-fog" title={t("Pantalla completa")}>
          ⛶ {t("Pantalla completa")}
        </button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <button type="button" onClick={() => zoom(0.7)} className="rounded border border-line px-2 py-1 font-semibold text-dim hover:text-fog" title={t("Acercar")} aria-label={t("Acercar")}>
          ＋
        </button>
        <button type="button" onClick={() => zoom(1 / 0.7)} className="rounded border border-line px-2 py-1 font-semibold text-dim hover:text-fog" title={t("Alejar")} aria-label={t("Alejar")}>
          −
        </button>
        <button type="button" onClick={() => apiRef.current?.chart.timeScale().scrollToRealTime()} className="rounded border border-line px-2 py-1 font-semibold text-dim hover:text-fog" title={t("Ir a la última vela")}>
          ⏭ {t("Última vela")}
        </button>
        <button type="button" onClick={() => setScaleMode((m) => ((m + 1) % 3) as 0 | 1 | 2)} className={cx("rounded border px-2 py-1 font-semibold", scaleMode ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-dim hover:text-fog")} title={t("Escala del precio: normal, logarítmica o porcentaje")}>
          {t("Escala")}: {SCALE_LABEL[scaleMode]}
        </button>
      </div>

      <div ref={wrapRef} className="relative overflow-hidden rounded-sm border border-[#2a2e39] bg-[#131722]">
        <div ref={boxRef} className="ml-10" style={{ height: fs ? "100vh" : (size === "large" ? 680 : 520) + subCount * SUB_PANE }} />
        <ChartDrawings
          api={apiRef.current}
          ready={ready}
          candles={candles}
          tfSec={TF_SEC[prefs.tf]}
          symbol={symbolKey}
          alertMaker={
            alerts
              ? {
                  lastPrice: last?.close ?? null,
                  tf: prefs.tf,
                  create: async (d) => {
                    try {
                      await createAlert(userId, d);
                      notify(t("Alerta creada: te aviso por la app y por Telegram."), "ok");
                      reloadAlerts();
                    } catch (e) {
                      notify(e instanceof Error ? e.message : t("No se pudo crear la alerta."), "err");
                    }
                  },
                }
              : undefined
          }
        />
        {state !== "ok" && (
          <div className="absolute inset-0 grid place-items-center bg-ink/70 px-6 text-center text-[12.5px] text-dim">
            {state === "loading" ? t("Cargando velas…") : t("No se pudieron cargar las velas de este activo. Probá con otro (por ejemplo BTCUSDT).")}
          </div>
        )}
      </div>
      {alerts && <AlertsSection userId={userId} symbol={symbolKey} tf={prefs.tf} lastPrice={last?.close ?? null} alerts={alerts} reload={reloadAlerts} notify={notify} />}
      <p className="text-[10.5px] leading-relaxed text-dim">{t("Velas de Binance. Los indicadores se calculan con las últimas {n} velas. Es una herramienta de análisis, no asesoramiento financiero.", { n: LIMIT })}</p>
    </div>
  );
}

export default function ChartCard({ trades, userId, notify }: { trades: Trade[]; userId: string; notify: Notify }) {
  return (
    <Panel id="chart" title={t("GRÁFICO")} subtitle={t("Velas con 2 indicadores, tus señales y alertas propias")} summary={t("EMA, RSI, MACD, Bollinger y alertas · tocá para abrir")} defaultOpen={false} plain>
      <ChartBody trades={trades} userId={userId} notify={notify} />
    </Panel>
  );
}

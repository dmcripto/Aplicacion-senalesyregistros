// ─── VELTRIX · Indicadores para el gráfico de análisis ──────────────────────
// Cálculos puros (sin DOM): medias móviles, Bandas de Bollinger, RSI y MACD. Cada valor sale alineado con su vela;
// `null` donde todavía no hay datos suficientes.

export interface ChartCandle {
  time: number; // segundos (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type IndicatorKind = "ema" | "sma" | "bb" | "rsi" | "macd" | "adx" | "vol" | "pdhl" | "fvg";
export const INDICATOR_KINDS: IndicatorKind[] = ["ema", "sma", "bb", "rsi", "macd", "adx", "vol", "pdhl", "fvg"];
/** Indicadores que no tienen un período para elegir. */
export const INDICATOR_NO_PERIOD: IndicatorKind[] = ["macd", "pdhl", "fvg"];

/** Período inicial de cada indicador (el MACD usa 12/26/9 fijo). */
export const INDICATOR_DEFAULT_PERIOD: Record<IndicatorKind, number> = { ema: 20, sma: 50, bb: 20, rsi: 14, macd: 0, adx: 14, vol: 20, pdhl: 0, fvg: 0 };

export interface IndicatorLine {
  name: string;
  values: Array<number | null>;
  kind: "line" | "hist";
  color: string;
  /** Color de cada barra (solo para `hist`); si falta, verde/rojo según el signo. */
  colors?: string[];
  /** Línea escalonada (los niveles que cambian de golpe, como el máximo del día anterior). */
  step?: boolean;
  /** Trazo más fino y punteado (zonas, niveles). */
  thin?: boolean;
}
export interface IndicatorResult {
  /** `price` se dibuja sobre las velas; `sub` en un panel aparte debajo. */
  pane: "price" | "sub";
  lines: IndicatorLine[];
  /** Líneas guía horizontales del panel aparte (por ejemplo 30/70 en el RSI). */
  guides: number[];
}

type Series = Array<number | null>;

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period; // arranca con la media simple
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI de Wilder. */
export function rsi(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1 || values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const at = (g: number, l: number) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[period] = at(gain, loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = at(gain, loss);
  }
  return out;
}

export function bollinger(values: number[], period: number, mult = 2): { mid: Series; upper: Series; lower: Series } {
  const mid = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9): { line: Series; signal: Series; hist: Series } {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  // La señal es la EMA de la línea MACD, desde donde esta empieza a existir.
  const first = line.findIndex((x) => x != null);
  const sig: Series = new Array(values.length).fill(null);
  if (first >= 0) {
    const e = ema(line.slice(first) as number[], signal);
    e.forEach((x, i) => (sig[first + i] = x));
  }
  const hist: Series = line.map((x, i) => (x != null && sig[i] != null ? x - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

/** Wilder (RMA): el suavizado que usan el RSI y el ADX. */
function rma(values: Array<number | null>, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const first = values.findIndex((v) => v != null);
  if (first < 0 || period < 1) return out;
  let sum = 0;
  let n = 0;
  let prev: number | null = null;
  for (let i = first; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      sum += v;
      n++;
      if (n === period) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + v) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function atrSeries(c: ChartCandle[], period: number): Series {
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  return rma(tr, period);
}

/** ADX con DI+ y DI− (el mismo cálculo que `ta.dmi` de TradingView). */
export function adx(c: ChartCandle[], period: number): { adx: Series; plus: Series; minus: Series } {
  const n = c.length;
  const tr: number[] = [];
  const pdm: number[] = [];
  const mdm: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = c[i].high - c[i - 1].high;
    const dn = c[i - 1].low - c[i].low;
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const sTr = rma(tr, period);
  const plus: Series = [null];
  const minus: Series = [null];
  const dx: Array<number | null> = [null];
  const sP = rma(pdm, period);
  const sM = rma(mdm, period);
  for (let i = 0; i < tr.length; i++) {
    const t = sTr[i];
    if (t == null || sP[i] == null || sM[i] == null || t === 0) {
      plus.push(null);
      minus.push(null);
      dx.push(null);
      continue;
    }
    const p = ((sP[i] as number) / t) * 100;
    const m = ((sM[i] as number) / t) * 100;
    plus.push(p);
    minus.push(m);
    dx.push(p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100);
  }
  return { adx: rma(dx, period), plus, minus };
}

export interface FvgZone {
  start: number; // índice de la primera vela del hueco
  end: number; // índice hasta donde vive (la última vela si sigue sin llenarse)
  top: number;
  bottom: number;
  bull: boolean;
  filled: boolean;
}

/**
 * Huecos de valor justo (FVG): tres velas donde la primera y la tercera no se tocan. Se ignoran los huecos más chicos que
 * `minAtr` veces el ATR (ruido) y los que ya se llenaron por completo. Devuelve los últimos `max` sin llenar.
 */
export function fairValueGaps(c: ChartCandle[], minAtr = 0.3, max = 6): FvgZone[] {
  const atr = atrSeries(c, 14);
  const zones: FvgZone[] = [];
  for (let i = 2; i < c.length; i++) {
    const a = atr[i - 1];
    const minSize = a != null ? a * minAtr : 0;
    if (c[i].low > c[i - 2].high && c[i].low - c[i - 2].high >= minSize) zones.push({ start: i - 2, end: c.length - 1, top: c[i].low, bottom: c[i - 2].high, bull: true, filled: false });
    else if (c[i].high < c[i - 2].low && c[i - 2].low - c[i].high >= minSize) zones.push({ start: i - 2, end: c.length - 1, top: c[i - 2].low, bottom: c[i].high, bull: false, filled: false });
  }
  // Un hueco se llena cuando una vela posterior lo atraviesa por completo.
  for (const z of zones) {
    for (let j = z.start + 3; j < c.length; j++) {
      if (z.bull ? c[j].low <= z.bottom : c[j].high >= z.top) {
        z.filled = true;
        z.end = j;
        break;
      }
    }
  }
  return zones.filter((z) => !z.filled).slice(-max);
}

/** Una vela es «ballena» si su volumen supera este múltiplo de la media. */
export const WHALE_MULT = 2.5;

export const INDICATOR_COLORS = { a: "#f5c518", b: "#c084fc", band: "#7dd3fc" };

/** Calcula un indicador sobre las velas. `slot` (0 o 1) solo decide los colores, para distinguir los dos que se usan a la vez. */
export function computeIndicator(kind: IndicatorKind, period: number, candles: ChartCandle[], slot: 0 | 1 = 0): IndicatorResult {
  const close = candles.map((c) => c.close);
  const p = Math.max(2, Math.min(500, Math.round(period) || INDICATOR_DEFAULT_PERIOD[kind] || 14));
  const color = slot === 0 ? INDICATOR_COLORS.a : INDICATOR_COLORS.b;
  switch (kind) {
    case "ema":
      return { pane: "price", guides: [], lines: [{ name: `EMA ${p}`, values: ema(close, p), kind: "line", color }] };
    case "sma":
      return { pane: "price", guides: [], lines: [{ name: `SMA ${p}`, values: sma(close, p), kind: "line", color }] };
    case "bb": {
      const b = bollinger(close, p);
      return {
        pane: "price",
        guides: [],
        lines: [
          { name: `BB ${p} ↑`, values: b.upper, kind: "line", color: INDICATOR_COLORS.band },
          { name: `BB ${p}`, values: b.mid, kind: "line", color },
          { name: `BB ${p} ↓`, values: b.lower, kind: "line", color: INDICATOR_COLORS.band },
        ],
      };
    }
    case "rsi":
      return { pane: "sub", guides: [30, 70], lines: [{ name: `RSI ${p}`, values: rsi(close, p), kind: "line", color }] };
    case "adx": {
      const d = adx(candles, p);
      return {
        pane: "sub",
        guides: [20, 25],
        lines: [
          { name: `ADX ${p}`, values: d.adx, kind: "line", color },
          { name: "DI+", values: d.plus, kind: "line", color: "#16d98a" },
          { name: "DI−", values: d.minus, kind: "line", color: "#ff4d67" },
        ],
      };
    }
    case "vol": {
      const vols = candles.map((x) => x.volume);
      const avg = sma(vols, p);
      const colors = candles.map((x, i) => {
        const a = avg[i];
        const whale = a != null && a > 0 && x.volume > a * WHALE_MULT;
        const up = x.close >= x.open;
        return whale ? (up ? "#ccff00" : "#ff00ff") : up ? "rgba(22,217,138,0.45)" : "rgba(255,77,103,0.45)";
      });
      return {
        pane: "sub",
        guides: [],
        lines: [
          { name: "Volumen", values: vols, kind: "hist", color: "#64748b", colors },
          { name: `Media ${p}`, values: avg, kind: "line", color },
        ],
      };
    }
    case "pdhl": {
      const days = new Map<number, { h: number; l: number }>();
      for (const x of candles) {
        const d = Math.floor(x.time / 86_400);
        const cur = days.get(d);
        days.set(d, cur ? { h: Math.max(cur.h, x.high), l: Math.min(cur.l, x.low) } : { h: x.high, l: x.low });
      }
      const prev = (x: ChartCandle) => days.get(Math.floor(x.time / 86_400) - 1);
      return {
        pane: "price",
        guides: [],
        lines: [
          { name: "Máx. día anterior", values: candles.map((x) => prev(x)?.h ?? null), kind: "line", color: "#e2e8f0", step: true, thin: true },
          { name: "Mín. día anterior", values: candles.map((x) => prev(x)?.l ?? null), kind: "line", color: "#e2e8f0", step: true, thin: true },
        ],
      };
    }
    case "fvg": {
      const lines: IndicatorLine[] = [];
      for (const z of fairValueGaps(candles)) {
        const col = z.bull ? "rgba(22,217,138,0.85)" : "rgba(255,77,103,0.85)";
        const span = (v: number) => candles.map((_, i) => (i >= z.start && i <= z.end ? v : null));
        lines.push({ name: z.bull ? "FVG ↑" : "FVG ↓", values: span(z.top), kind: "line", color: col, thin: true });
        lines.push({ name: z.bull ? "FVG ↑" : "FVG ↓", values: span(z.bottom), kind: "line", color: col, thin: true });
      }
      return { pane: "price", guides: [], lines };
    }
    case "macd": {
      const m = macd(close);
      return {
        pane: "sub",
        guides: [0],
        lines: [
          { name: "MACD hist", values: m.hist, kind: "hist", color: "#64748b" },
          { name: "MACD", values: m.line, kind: "line", color },
          { name: "Signal", values: m.signal, kind: "line", color: slot === 0 ? "#fb7185" : "#38bdf8" },
        ],
      };
    }
  }
}

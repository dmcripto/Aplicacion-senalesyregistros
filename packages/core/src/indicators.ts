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

export type IndicatorKind = "ema" | "sma" | "bb" | "rsi" | "macd";
export const INDICATOR_KINDS: IndicatorKind[] = ["ema", "sma", "bb", "rsi", "macd"];

/** Período inicial de cada indicador (el MACD usa 12/26/9 fijo). */
export const INDICATOR_DEFAULT_PERIOD: Record<IndicatorKind, number> = { ema: 20, sma: 50, bb: 20, rsi: 14, macd: 0 };

export interface IndicatorLine {
  name: string;
  values: Array<number | null>;
  kind: "line" | "hist";
  color: string;
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

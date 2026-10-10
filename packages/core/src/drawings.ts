// ─── VELTRIX · Dibujos sobre el gráfico (líneas, rayos, reglas, notas, rectángulos, Fibonacci) ───
// Cada dibujo se guarda con puntos en (hora, precio), así sigue en su lugar aunque el gráfico se corra o cambie de temporalidad.

export type DrawKind = "hline" | "vline" | "trend" | "ray" | "rect" | "fib" | "ruler" | "text" | "long" | "short";
export const DRAW_KINDS: DrawKind[] = ["hline", "vline", "trend", "ray", "rect", "fib", "ruler", "text", "long", "short"];
/** Dibujos que se hacen con un solo toque (los demás necesitan dos puntos). */
export const ONE_POINT_KINDS: DrawKind[] = ["hline", "vline", "text"];
export const DRAW_COLORS = ["#2962ff", "#f5b301", "#16d98a", "#ff4d67", "#c084fc", "#d1d4dc"] as const;
export const MAX_TEXT = 60;
export const MAX_DRAWINGS = 60;

export interface DrawPoint {
  t: number; // segundos (UTC)
  p: number; // precio
}
export interface Drawing {
  id: string;
  kind: DrawKind;
  a: DrawPoint;
  b?: DrawPoint; // las líneas horizontal y vertical y la nota tienen un solo punto
  color?: string; // #rrggbb; si falta, azul
  text?: string; // solo en las notas
  rr?: number; // solo en las posiciones: cuántas veces el riesgo se busca de ganancia (el TP)
}

export const POSITION_RRS = [1, 1.5, 2, 3, 4, 5] as const;
export const DEFAULT_POSITION_RR = 2;

/**
 * Herramienta «posición» (como en TradingView): el primer punto es la entrada y el segundo marca el stop; el TP se calcula con
 * el R:R elegido. En una compra el stop queda abajo y el TP arriba; en una venta, al revés (aunque se haya tocado del otro lado).
 */
export function positionLevels(d: Pick<Drawing, "kind" | "a" | "b" | "rr">) {
  const entry = d.a.p;
  const dist = Math.abs((d.b?.p ?? entry) - entry);
  const long = d.kind === "long";
  const rr = d.rr && d.rr > 0 ? d.rr : DEFAULT_POSITION_RR;
  return {
    direction: (long ? "LONG" : "SHORT") as "LONG" | "SHORT",
    entry,
    sl: long ? entry - dist : entry + dist,
    tp: long ? entry + dist * rr : entry - dist * rr,
    rr,
    stopPct: entry ? (dist / entry) * 100 : 0,
    tpPct: entry ? ((dist * rr) / entry) * 100 : 0,
  };
}

/** Lo que mide la regla entre dos puntos: diferencia de precio, porcentaje y tiempo. */
export function measure(a: DrawPoint, b: DrawPoint) {
  const diff = b.p - a.p;
  return { diff, pct: a.p ? (diff / a.p) * 100 : 0, seconds: Math.abs(b.t - a.t) };
}

/** Niveles de retroceso de Fibonacci. El 0 está en el segundo punto y el 1 en el primero (como en TradingView). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const fibPrices = (a: DrawPoint, b: DrawPoint) => FIB_LEVELS.map((level) => ({ level, price: b.p + (a.p - b.p) * level }));

/** Posición en «número de vela» (puede ser fraccionaria o estar fuera de las velas cargadas) de una hora. */
export function timeToLogical(times: number[], tfSec: number, t: number): number {
  const n = times.length;
  if (!n) return 0;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / tfSec;
  if (t <= times[0]) return (t - times[0]) / tfSec;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]) / (times[lo + 1] - times[lo]);
}

/** Lo inverso: la hora de una posición en número de vela. */
export function logicalToTime(times: number[], tfSec: number, l: number): number {
  const n = times.length;
  if (!n) return 0;
  if (l >= n - 1) return times[n - 1] + (l - (n - 1)) * tfSec;
  if (l <= 0) return times[0] + l * tfSec;
  const i = Math.floor(l);
  return times[i] + (l - i) * (times[i + 1] - times[i]);
}

const okPoint = (x: unknown): x is DrawPoint => !!x && typeof x === "object" && Number.isFinite((x as DrawPoint).t) && Number.isFinite((x as DrawPoint).p);

/** Lee dibujos guardados (por si el almacenamiento tiene datos viejos o rotos): se queda solo con los válidos. */
export function cleanDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const { id, kind, a, b, color, text } = d as Drawing;
    if (typeof id !== "string" || !DRAW_KINDS.includes(kind) || !okPoint(a)) continue;
    const one = ONE_POINT_KINDS.includes(kind);
    if (!one && !okPoint(b)) continue;
    if (kind === "text" && (typeof text !== "string" || !text.trim())) continue;
    const item: Drawing = one ? { id, kind, a: { t: a.t, p: a.p } } : { id, kind, a: { t: a.t, p: a.p }, b: { t: b!.t, p: b!.p } };
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) item.color = color;
    if (kind === "text") item.text = text!.trim().slice(0, MAX_TEXT);
    const rr = (d as Drawing).rr;
    if ((kind === "long" || kind === "short") && typeof rr === "number" && Number.isFinite(rr) && rr >= 0.5 && rr <= 20) item.rr = rr;
    out.push(item);
  }
  return out.slice(-MAX_DRAWINGS);
}

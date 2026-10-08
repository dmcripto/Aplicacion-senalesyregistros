// ─── VELTRIX · Dibujos sobre el gráfico (líneas, rectángulos, Fibonacci) ───
// Cada dibujo se guarda con puntos en (hora, precio), así sigue en su lugar aunque el gráfico se corra o cambie de temporalidad.

export type DrawKind = "hline" | "trend" | "rect" | "fib";
export const DRAW_KINDS: DrawKind[] = ["hline", "trend", "rect", "fib"];
export const MAX_DRAWINGS = 60;

export interface DrawPoint {
  t: number; // segundos (UTC)
  p: number; // precio
}
export interface Drawing {
  id: string;
  kind: DrawKind;
  a: DrawPoint;
  b?: DrawPoint; // la línea horizontal tiene un solo punto
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
    const { id, kind, a, b } = d as Drawing;
    if (typeof id !== "string" || !DRAW_KINDS.includes(kind) || !okPoint(a)) continue;
    if (kind !== "hline" && !okPoint(b)) continue;
    out.push(kind === "hline" ? { id, kind, a: { t: a.t, p: a.p } } : { id, kind, a: { t: a.t, p: a.p }, b: { t: b!.t, p: b!.p } });
  }
  return out.slice(-MAX_DRAWINGS);
}

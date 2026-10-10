// ─── VELTRIX · Medias móviles del gráfico (hasta 3, con tipo, período, color y grosor a elección) ───

export type MAType = "ema" | "sma";
export interface MovingAverage {
  on: boolean;
  type: MAType;
  period: number; // 2–500
  color: string; // #rrggbb
  width: 1 | 2 | 3 | 4;
}

export const MA_COUNT = 3;
export const MA_WIDTHS: Array<MovingAverage["width"]> = [1, 2, 3, 4];
export const MA_COLORS = ["#f5c518", "#2962ff", "#16d98a", "#ff4d67", "#c084fc", "#ff9f43", "#d1d4dc"] as const;

/** Arranca con la EMA 50 y la EMA 200 (apagadas) y una tercera libre: la persona las prende y las ajusta. */
export const DEFAULT_MAS: MovingAverage[] = [
  { on: false, type: "ema", period: 50, color: "#f5c518", width: 2 },
  { on: false, type: "ema", period: 200, color: "#2962ff", width: 2 },
  { on: false, type: "sma", period: 20, color: "#16d98a", width: 1 },
];

/** Lee las medias guardadas (por si el almacenamiento tiene datos viejos o rotos); lo que falte o sea inválido queda como en DEFAULT_MAS. */
export function cleanMAs(raw: unknown): MovingAverage[] {
  const list = Array.isArray(raw) ? raw : [];
  return DEFAULT_MAS.map((d, i) => {
    const v = list[i] as Partial<MovingAverage> | null | undefined;
    if (!v || typeof v !== "object") return { ...d };
    const period = Number(v.period);
    return {
      on: v.on === true,
      type: v.type === "sma" || v.type === "ema" ? v.type : d.type,
      period: Number.isFinite(period) && period >= 2 ? Math.min(500, Math.round(period)) : d.period,
      color: typeof v.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : d.color,
      width: v.width === 1 || v.width === 2 || v.width === 3 || v.width === 4 ? v.width : d.width,
    };
  });
}

export const maLabel = (m: Pick<MovingAverage, "type" | "period">) => `${m.type === "ema" ? "EMA" : "SMA"} ${m.period}`;

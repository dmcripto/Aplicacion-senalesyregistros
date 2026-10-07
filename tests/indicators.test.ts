import { describe, expect, it } from "vitest";
import { bollinger, computeIndicator, ema, macd, rsi, sma } from "../packages/core/src/indicators";
import type { ChartCandle } from "../packages/core/src/indicators";

const candles = (closes: number[]): ChartCandle[] => closes.map((c, i) => ({ time: 1_700_000_000 + i * 3600, open: c, high: c + 1, low: c - 1, close: c, volume: 1 }));

describe("indicadores", () => {
  it("SMA: promedio móvil, vacío hasta tener datos", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
  it("EMA: arranca con la SMA y pondera lo nuevo", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3, 10); // k=0.5: 4*0.5 + 2*0.5
    expect(e[4]).toBeCloseTo(4, 10);
  });
  it("RSI: 100 si solo sube, 0 si solo baja, 50 si no se mueve, siempre entre 0 y 100", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up, 14)[29]).toBe(100);
    expect(rsi(up.slice().reverse(), 14)[29]).toBe(0);
    expect(rsi(new Array(30).fill(5), 14)[29]).toBe(50);
    const wavy = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    for (const v of rsi(wavy, 14)) if (v != null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
    expect(rsi(wavy, 14)[13]).toBeNull();
    expect(rsi(wavy, 14)[14]).not.toBeNull();
  });
  it("RSI: valor conocido (ejemplo clásico de Wilder)", () => {
    const px = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(px, 14)[14]).toBeCloseTo(70.46, 1);
  });
  it("Bollinger: banda simétrica y plana si el precio no se mueve", () => {
    const flat = bollinger(new Array(25).fill(10), 20);
    expect(flat.upper[24]).toBe(10);
    expect(flat.lower[24]).toBe(10);
    const b = bollinger([1, 2, 3, 4, 5], 5);
    expect(b.mid[4]).toBe(3);
    expect((b.upper[4] as number) - 3).toBeCloseTo(3 - (b.lower[4] as number), 10);
    expect(b.upper[4]).toBeCloseTo(3 + 2 * Math.sqrt(2), 10);
  });
  it("MACD: la línea es EMA12 − EMA26 y el histograma es línea − señal", () => {
    const px = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 4) * 3);
    const m = macd(px);
    const f = ema(px, 12);
    const s = ema(px, 26);
    expect(m.line[25]).toBeCloseTo((f[25] as number) - (s[25] as number), 10);
    expect(m.line[24]).toBeNull();
    const i = 70;
    expect(m.hist[i]).toBeCloseTo((m.line[i] as number) - (m.signal[i] as number), 10);
    expect(m.signal[25 + 7]).toBeNull(); // la señal necesita 9 valores de la línea
    expect(m.signal[25 + 8]).not.toBeNull();
  });
  it("computeIndicator: panel, cantidad de líneas, períodos acotados y largo igual al de las velas", () => {
    const c = candles(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5));
    const ema20 = computeIndicator("ema", 20, c);
    expect(ema20.pane).toBe("price");
    expect(ema20.lines[0].name).toBe("EMA 20");
    expect(ema20.lines[0].values).toHaveLength(60);
    expect(computeIndicator("bb", 20, c).lines).toHaveLength(3);
    const r = computeIndicator("rsi", 14, c);
    expect(r.pane).toBe("sub");
    expect(r.guides).toEqual([30, 70]);
    expect(computeIndicator("macd", 0, c).lines.map((l) => l.kind)).toEqual(["hist", "line", "line"]);
    expect(computeIndicator("ema", 99999, c).lines[0].name).toBe("EMA 500");
    expect(computeIndicator("ema", NaN, c).lines[0].name).toBe("EMA 20");
    expect(computeIndicator("ema", 20, c, 1).lines[0].color).not.toBe(computeIndicator("ema", 20, c, 0).lines[0].color); // colores distintos por ranura
  });
});

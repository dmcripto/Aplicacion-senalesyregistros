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

import { adx, atrSeries, computeIndicator as ci, fairValueGaps } from "../packages/core/src/indicators";

const mk = (rows: Array<[number, number, number, number, number?]>): ChartCandle[] => rows.map(([o, h, l, c, v], i) => ({ time: 1_700_000_000 + i * 3600, open: o, high: h, low: l, close: c, volume: v ?? 10 }));

describe("ADX / DI", () => {
  const up = mk(Array.from({ length: 80 }, (_, i) => [100 + i, 101.5 + i, 99.5 + i, 101 + i] as [number, number, number, number]));
  const flat = mk(Array.from({ length: 80 }, (_, i) => (i % 2 ? [100, 100.5, 99.5, 100.2] : [100.2, 100.6, 99.4, 100]) as [number, number, number, number]));
  it("tendencia clara: ADX alto y DI+ por encima de DI−; rango: ADX bajo", () => {
    const a = adx(up, 14);
    expect(a.adx[79]).toBeGreaterThan(40);
    expect(a.plus[79]!).toBeGreaterThan(a.minus[79]!);
    expect(adx(flat, 14).adx[79]!).toBeLessThan(20);
  });
  it("valores entre 0 y 100 y vacío hasta tener datos", () => {
    const a = adx(up, 14);
    for (const v of [...a.adx, ...a.plus, ...a.minus]) if (v != null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
    expect(a.adx[10]).toBeNull();
    expect(a.plus[14]).not.toBeNull();
  });
  it("ATR constante cuando todas las velas miden lo mismo", () => {
    const c = mk(Array.from({ length: 30 }, () => [100, 102, 98, 100] as [number, number, number, number]));
    expect(atrSeries(c, 14)[29]).toBeCloseTo(4, 10);
  });
});

describe("FVG (huecos)", () => {
  const base: Array<[number, number, number, number, number?]> = Array.from({ length: 20 }, () => [100, 102, 98, 100]);
  it("detecta un hueco alcista y lo mantiene mientras no se llene; ignora los chicos", () => {
    const rows = [...base, [100, 102, 99, 101.5], [102, 110, 101.8, 109], [109, 112, 107, 111], [111, 113, 109, 112]] as Array<[number, number, number, number]>;
    const z = fairValueGaps(mk(rows));
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ bull: true, bottom: 102, top: 107, start: 20 });
    // hueco diminuto (0,1): ruido
    const tiny = [...base, [100, 102, 99, 101.5], [102, 103, 102.1, 102.8], [102.8, 104, 102.2, 103.5]] as Array<[number, number, number, number]>;
    expect(fairValueGaps(mk(tiny))).toHaveLength(0);
  });
  it("un hueco que el precio atraviesa por completo deja de mostrarse; el bajista es simétrico", () => {
    const filled = [...base, [100, 102, 99, 101.5], [102, 110, 101.8, 109], [109, 112, 107, 111], [111, 113, 100, 101]] as Array<[number, number, number, number]>;
    expect(fairValueGaps(mk(filled))).toHaveLength(0);
    const bear = [...base, [100, 101, 98.5, 99], [98, 98.2, 90, 91], [91, 93, 89, 90]] as Array<[number, number, number, number]>;
    const z = fairValueGaps(mk(bear));
    expect(z[0]).toMatchObject({ bull: false, top: 98.5, bottom: 93 });
  });
});

describe("volumen con ballenas y día anterior", () => {
  it("marca como ballena (color fluor) solo el volumen muy por encima de la media", () => {
    const rows: Array<[number, number, number, number, number]> = Array.from({ length: 30 }, () => [100, 101, 99, 100.5, 10]);
    rows[29] = [100, 103, 99, 102, 80]; // sube con 8× la media
    rows[28] = [100, 101, 98, 99, 80]; // baja con volumen enorme
    const r = ci("vol", 20, mk(rows));
    const bars = r.lines[0];
    expect(bars.colors![29]).toBe("#ccff00");
    expect(bars.colors![28]).toBe("#ff00ff");
    expect(bars.colors![5]).toContain("rgba");
    expect(r.pane).toBe("sub");
  });
  it("máximo y mínimo del día anterior, escalonados y vacíos el primer día", () => {
    const day = 86_400;
    const c: ChartCandle[] = [];
    for (let d = 0; d < 3; d++) for (let h = 0; h < 4; h++) c.push({ time: 1_700_006_400 - (1_700_006_400 % day) + d * day + h * 3600, open: 10, high: 10 + d * 5 + h, low: 5 - d, close: 10, volume: 1 });
    const r = ci("pdhl", 0, c);
    expect(r.lines[0].values[0]).toBeNull(); // primer día: no hay día anterior
    expect(r.lines[0].values[4]).toBe(13); // máximo del día 0 = 10+0+3
    expect(r.lines[1].values[4]).toBe(5);
    expect(r.lines[0].values[8]).toBe(18); // máximo del día 1 = 10+5+3
    expect(r.lines[0].step).toBe(true);
  });
  it("fvg y pdhl no tienen período y quedan sobre las velas", () => {
    const c = mk(Array.from({ length: 40 }, (_, i) => [100 + i, 102 + i, 99 + i, 101 + i] as [number, number, number, number]));
    expect(ci("pdhl", 0, c).pane).toBe("price");
    expect(ci("fvg", 0, c).pane).toBe("price");
    expect(ci("adx", 14, c).lines.map((l) => l.name)).toEqual(["ADX 14", "DI+", "DI−"]);
  });
});

import { describe, expect, it } from "vitest";
import { buildMap, computeMap, fetchBybit, LEVERAGES } from "../supabase/functions/_shared/liquidations";
import type { Bar, OiPoint } from "../supabase/functions/_shared/liquidations";

const H = 3_600_000;
const T0 = Math.floor(Date.UTC(2026, 8, 1) / H) * H;
const meta = { coin: "BTC", symbol: "BTCUSDT", source: "binance" as const };

/** Velas planas alrededor de un precio (alto/bajo apenas separados). */
const flat = (n: number, price: number, from = 0): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * H, h: price * 1.001, l: price * 0.999, c: price }));
const oiSeries = (values: number[]): OiPoint[] => values.map((usd, i) => ({ t: T0 + i * H, usd }));
/** Suma de los niveles que rodean a un precio (±0,25 %), para no depender del borde exacto de cada nivel. */
const at = (m: ReturnType<typeof computeMap>, price: number) => {
  const near = m.buckets.filter((b) => Math.abs(b.price / price - 1) <= 0.0025);
  const add = (k: "longs" | "shorts") => m.leverages.map((_, i) => near.reduce((a, b) => a + b[k][i], 0));
  return { longs: add("longs"), shorts: add("shorts") };
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const tot = (b: { longs: number[]; shorts: number[] }, k: "longs" | "shorts") => sum(b[k]);

describe("estimación de liquidaciones", () => {
  it("las posiciones nuevas dejan largos debajo del precio y cortos arriba", () => {
    const bars = flat(10, 100);
    const m = computeMap(bars, oiSeries([1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000, 2000, 2000]), [], meta);
    expect(m.price).toBe(100);
    for (const b of m.buckets) {
      if (tot(b, "longs") > 0) expect(b.price).toBeLessThan(100);
      if (tot(b, "shorts") > 0) expect(b.price).toBeGreaterThan(100);
    }
    // 10x: liquidación del largo en 100·(1−0,1+0,005) = 90,5 y del corto en 109,5
    const k10 = m.leverages.indexOf(10);
    expect(at(m, 90.5).longs[k10]).toBeGreaterThan(0);
    expect(at(m, 109.5).shorts[k10]).toBeGreaterThan(0);
    // puntos calientes de los dos lados
    expect(m.hotspots.some((h) => h.side === "long" && h.pct < 0)).toBe(true);
    expect(m.hotspots.some((h) => h.side === "short" && h.pct > 0)).toBe(true);
  });

  it("si el interés abierto baja o no cambia, no se suma nada", () => {
    const m = computeMap(flat(10, 100), oiSeries([2000, 1900, 1800, 1800, 1700, 1700, 1600, 1500, 1500, 1500]), [], meta);
    expect(m.buckets.every((b) => tot(b, "longs") === 0 && tot(b, "shorts") === 0)).toBe(true);
    expect(m.hotspots).toEqual([]);
  });

  it("las liquidaciones que el precio ya cruzó se descartan", () => {
    // Se abre a 100 y después el precio cae a 88: los largos con liquidación en 90,5 (10x) y 96,5 (25x) ya saltaron;
    // los de 5x (80,5) siguen. Los cortos no se tocaron.
    const bars = [...flat(5, 100), ...flat(5, 88, 5)];
    const m = computeMap(bars, oiSeries([1000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000]), [], meta, { rangePct: 0.25 });
    expect(m.price).toBe(88);
    expect(tot(at(m, 90.5), "longs")).toBe(0);
    expect(tot(at(m, 96.5), "longs")).toBe(0);
    const alive = m.buckets.filter((b) => tot(b, "longs") > 0);
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.every((b) => b.price < 88 * 0.95)).toBe(true);
    expect(tot(at(m, 109.5), "shorts")).toBeGreaterThan(0);
  });

  it("los dólares se calibran con el interés abierto actual y la proporción largos/cortos", () => {
    const oi = oiSeries([1000, 2000, 2500, 2500, 3000, 3000, 3000, 3500, 4000, 4000]);
    const ls = oi.map((p) => ({ t: p.t, longShare: 0.8 }));
    const m = computeMap(flat(10, 100), oi, ls, meta, { rangePct: 0.9 });
    const longs = sum(m.buckets.map((b) => tot(b, "longs")));
    const shorts = sum(m.buckets.map((b) => tot(b, "shorts")));
    expect(m.openInterestUsd).toBe(4000);
    expect(longs).toBeCloseTo(4000 * 0.8, -1);
    expect(shorts).toBeCloseTo(4000 * 0.2, -1);
  });

  it("los puntos calientes de un mismo lado están separados al menos 1 %", () => {
    const m = computeMap(flat(10, 100), oiSeries([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]), [], meta);
    for (const side of ["long", "short"] as const) {
      const hs = m.hotspots.filter((h) => h.side === side);
      expect(hs.length).toBeGreaterThan(0);
      for (const a of hs) for (const b of hs) if (a !== b) expect(Math.abs(a.price / b.price - 1)).toBeGreaterThanOrEqual(0.01);
    }
  });

  it("los pesos de apalancamiento suman 100 %", () => {
    expect(LEVERAGES.reduce((a, l) => a + l.w, 0)).toBeCloseTo(1);
  });

  it("pocos datos → error claro", () => {
    expect(() => computeMap(flat(3, 100), [], [], meta)).toThrow();
  });
});

describe("datos públicos", () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const hours = Array.from({ length: 12 }, (_, i) => T0 + i * H);
  const binance = async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname === "/fapi/v1/klines") return json(hours.map((t) => [t, "100", "101", "99", "100", "1"]));
    if (u.pathname === "/futures/data/openInterestHist") return json(hours.map((t, i) => ({ symbol: "BTCUSDT", sumOpenInterestValue: String(1000 + i * 100), timestamp: t })));
    if (u.pathname === "/futures/data/globalLongShortAccountRatio") return json(hours.map((t) => ({ longAccount: "0.55", shortAccount: "0.45", timestamp: t })));
    return json({}, 404);
  };
  const bybit = async (url: any) => {
    const u = new URL(String(url));
    if (u.host !== "api.bybit.com") return json({}, 451);
    if (u.pathname === "/v5/market/kline") return json({ retCode: 0, result: { list: [...hours].reverse().map((t) => [String(t), "100", "101", "99", "100", "1", "100"]) } });
    if (u.pathname === "/v5/market/open-interest") return json({ retCode: 0, result: { list: [...hours].reverse().map((t, i) => ({ openInterest: String(10 + (11 - i)), timestamp: String(t) })) } });
    if (u.pathname === "/v5/market/account-ratio") return json({ retCode: 0, result: { list: hours.map((t) => ({ buyRatio: "0.6", sellRatio: "0.4", timestamp: String(t) })) } });
    return json({}, 404);
  };

  it("usa Binance cuando responde", async () => {
    const m = await buildMap("BTC", binance as any);
    expect(m.source).toBe("binance");
    expect(m.symbol).toBe("BTCUSDT");
    expect(m.buckets.some((b) => tot(b, "longs") > 0)).toBe(true);
  });

  it("pasa a Bybit si Binance está bloqueado, y convierte el interés abierto a dólares", async () => {
    const m = await buildMap("BTC", (async (url: any) => (new URL(String(url)).host === "fapi.binance.com" ? json({}, 451) : bybit(url))) as any);
    expect(m.source).toBe("bybit");
    expect(m.buckets.some((b) => tot(b, "shorts") > 0)).toBe(true);
    const d = await fetchBybit("BTCUSDT", bybit as any);
    expect(d.oi.every((p) => p.usd > 0)).toBe(true);
  });

  it("si los dos fallan, devuelve error", async () => {
    await expect(buildMap("BTC", (async () => json({}, 500)) as any)).rejects.toBeTruthy();
  });
});

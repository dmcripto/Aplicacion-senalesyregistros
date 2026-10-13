import { describe, expect, it } from "vitest";
import { liquidationSummary } from "../packages/core/src/trading";
import type { LiquidationMap } from "../packages/core/src/trading";

const map = (over: Partial<LiquidationMap> = {}): LiquidationMap => ({
  coin: "BTC",
  symbol: "BTCUSDT",
  source: "binance",
  price: 100,
  step: 1,
  hours: 24,
  leverages: [5, 10],
  buckets: [
    { price: 90, longs: [10, 20], shorts: [0, 0] },
    { price: 95, longs: [30, 0], shorts: [0, 0] },
    { price: 105, longs: [0, 0], shorts: [5, 5] },
    { price: 110, longs: [0, 0], shorts: [20, 10] },
  ],
  hotspots: [
    { side: "long", price: 95, usd: 30, pct: -5 },
    { side: "long", price: 90, usd: 30, pct: -10 },
    { side: "short", price: 110, usd: 30, pct: 10 },
    { side: "short", price: 105, usd: 10, pct: 5 },
  ],
  openInterestUsd: null,
  computedAt: 0,
  ...over,
});

describe("resumen del mapa de liquidaciones", () => {
  it("suma lo que hay arriba (cortos) y abajo (largos) del precio", () => {
    const s = liquidationSummary(map());
    expect(s.aboveUsd).toBe(40);
    expect(s.belowUsd).toBe(60);
    expect(s.abovePct).toBeCloseTo(40, 10);
    expect(s.heavier).toBe("below");
  });
  it("elige la zona más fuerte de cada lado y la mayor de todas", () => {
    const s = liquidationSummary(map({ hotspots: [{ side: "long", price: 95, usd: 20, pct: -5 }, { side: "long", price: 90, usd: 50, pct: -10 }, { side: "short", price: 110, usd: 30, pct: 10 }] }));
    expect(s.topBelow?.price).toBe(90);
    expect(s.topAbove?.price).toBe(110);
    expect(s.magnet?.price).toBe(90);
  });
  it("parejo si la diferencia es chica, y sin datos no rompe", () => {
    expect(liquidationSummary(map({ buckets: [{ price: 95, longs: [50, 0], shorts: [0, 0] }, { price: 105, longs: [0, 0], shorts: [52, 0] }] })).heavier).toBe("even");
    const empty = liquidationSummary(map({ buckets: [], hotspots: [] }));
    expect(empty).toMatchObject({ aboveUsd: 0, belowUsd: 0, abovePct: 50, topAbove: null, topBelow: null, magnet: null, heavier: "even" });
  });
});

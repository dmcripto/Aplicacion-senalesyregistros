import { describe, expect, it } from "vitest";
import { ago, exchangeTradeUrl, signalGuide, EXCHANGE_LIST } from "../packages/core/src/trading";

const money = { capital: 1000, riskPct: 1, currency: "USD" };
const btc = { symbol: "BTCUSDT", direction: "LONG" as const, entry: 65000, sl: 64500, tp: 66500, source: null, targets: undefined };

describe("señal explicada para ejecutarla", () => {
  it("una compra: pasos simples y tamaño según el capital y el riesgo", () => {
    const g = signalGuide(btc, money);
    expect(g.long).toBe(true);
    expect(g.sideLabel).toBe("COMPRA");
    expect(g.simulated).toBe(false);
    expect(g.rr).toBeCloseTo(3);
    expect(g.stopPct).toBeCloseTo(0.769, 2);
    // arriesga 10 USD con un stop de 500 → 0,02 BTC
    expect(g.position!.units).toBeCloseTo(0.02, 6);
    expect(g.position!.riskAmount).toBe(10);
    expect(g.steps).toHaveLength(3);
    expect(g.steps[0]).toContain("BTCUSDT");
    expect(g.steps[0]).toContain("Comprar (Long)");
    expect(g.steps[1]).toContain("65,000");
    expect(g.steps[2]).toContain("0.0200 BTC");
    expect(g.steps[2]).toContain("$10.00");
  });

  it("una venta se explica como venta", () => {
    const g = signalGuide({ ...btc, direction: "SHORT", sl: 65500, tp: 63500 }, money);
    expect(g.long).toBe(false);
    expect(g.sideLabel).toBe("VENTA");
    expect(g.steps[0]).toContain("Vender (Short)");
    expect(g.position!.units).toBeCloseTo(0.02, 6);
  });

  it("sin capital cargado no inventa un tamaño y explica cómo obtenerlo", () => {
    const g = signalGuide(btc, { capital: null, riskPct: null, currency: "USD" });
    expect(g.position).toBeNull();
    expect(g.steps[2]).toContain("Cargá tu capital");
  });

  it("una señal del bot simulado se marca como simulada y no da pasos para ejecutarla", () => {
    const g = signalGuide({ ...btc, source: "bot" }, money);
    expect(g.simulated).toBe(true);
    expect(g.steps).toHaveLength(1);
    expect(g.steps[0]).toContain("no se ejecuta en ningún exchange");
  });

  it("el texto para copiar trae lo esencial en líneas claras", () => {
    const g = signalGuide({ ...btc, targets: [66000, 66500] }, money);
    expect(g.copyText.split("\n")).toEqual(["BTCUSDT · COMPRA", "Entrada: 65,000", "Stop: 64,500", "TP: 66,500", "TP1: 66,000 · TP2: 66,500", "R:R 1:3.00"]);
  });

  it("los activos con prefijo numérico o USDC calculan bien la moneda base", () => {
    const g = signalGuide({ ...btc, symbol: "1000PEPEUSDT", entry: 0.01, sl: 0.0095, tp: 0.012 }, money);
    expect(g.position!.base).toBe("1000PEPE");
  });
});

describe("abrir el exchange", () => {
  it("cada exchange conocido tiene una página https y se arma bien para activos comunes y raros", () => {
    for (const e of EXCHANGE_LIST) {
      const u = exchangeTradeUrl(e.id, "BTCUSDT");
      expect(u, e.id).toMatch(/^https:\/\//);
    }
    expect(exchangeTradeUrl("binance", "ETHUSDT")).toBe("https://www.binance.com/en/futures/ETHUSDT");
    expect(exchangeTradeUrl("bybit", "SOLUSDT")).toBe("https://www.bybit.com/trade/usdt/SOLUSDT");
    expect(exchangeTradeUrl("okx", "XRPUSDT")).toBe("https://www.okx.com/trade-swap/xrp-usdt-swap");
    expect(exchangeTradeUrl("gate", "1000PEPEUSDT")).toBe("https://www.gate.io/futures/USDT/1000PEPE_USDT");
    expect(exchangeTradeUrl("mexc", "BTCUSDT")).toBe("https://futures.mexc.com/exchange/BTC_USDT");
  });

  it("un exchange desconocido no devuelve nada", () => {
    expect(exchangeTradeUrl("inventado", "BTCUSDT")).toBeNull();
    expect(exchangeTradeUrl("bot", "BTCUSDT")).toBeNull();
  });
});

describe("hace cuánto llegó", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  it("usa minutos, horas y días", () => {
    expect(ago("2026-10-06T11:59:40Z", now)).toBe("ahora");
    expect(ago("2026-10-06T11:55:00Z", now)).toBe("hace 5 min");
    expect(ago("2026-10-06T09:00:00Z", now)).toBe("hace 3 h");
    expect(ago("2026-10-04T12:00:00Z", now)).toBe("hace 2 d");
  });
});

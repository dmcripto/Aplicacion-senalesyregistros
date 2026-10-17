import { describe, expect, it } from "vitest";
import { leverageCheck, leverageWarning, maxSafeLeverage } from "../packages/core/src/trading";
import { maxSafeLeverageOf, signalCardHtml } from "../supabase/functions/_shared/community";

describe("apalancamiento seguro", () => {
  it("el máximo es el 60 % de 1/apalancamiento: el stop tiene que quedar antes de la liquidación", () => {
    expect(maxSafeLeverage(100, 99)).toBe(60); // stop a 1 %
    expect(maxSafeLeverage(100, 95)).toBe(12); // stop a 5 %
    expect(maxSafeLeverage(4175.56, 4160)).toBe(100); // stop muy cerca: tope de 100x
    expect(maxSafeLeverage(100, 20)).toBe(1); // stop lejísimos: nunca menos de 1x
  });
  it("sin datos válidos no inventa nada", () => {
    expect(maxSafeLeverage(0, 1)).toBeNull();
    expect(maxSafeLeverage(100, 100)).toBeNull();
    expect(maxSafeLeverage(NaN, 90)).toBeNull();
    expect(leverageCheck(100, 99, 0)).toBeNull();
    expect(leverageWarning(null, 10)).toBeNull();
  });
  it("detecta cuando te liquidan antes del stop (el caso de 200x en el oro)", () => {
    // MUBARAK corto, entrada 0.05808, stop 3 % arriba, 25x: se liquida a ~4 % → el stop (3 %) queda cerca pero antes
    const mub = leverageCheck(0.05808, 0.05808 * 1.03, 25)!;
    expect(mub.level).toBe("warn");
    // Oro con 200x: la liquidación está a ~0,5 %, el stop a 1 % → te liquidan antes
    const xau = leverageCheck(4175.56, 4175.56 * 0.99, 200)!;
    expect(xau.level).toBe("danger");
    expect(xau.liqPct).toBeCloseTo(0.5);
    expect(leverageWarning(xau, 200)).toContain("te liquidan antes de llegar al stop");
    expect(leverageWarning(xau, 200)).toContain(`${xau.maxSafe}x`);
  });
  it("un apalancamiento prudente no avisa nada", () => {
    const ok = leverageCheck(100, 95, 5)!; // stop 5 %, liquidación a 20 %
    expect(ok.level).toBe("ok");
    expect(leverageWarning(ok, 5)).toBeNull();
  });
  it("el mensaje de Telegram usa la misma cuenta que la app", () => {
    for (const [e, s] of [[100, 99], [100, 95], [0.05808, 0.0598], [4175.56, 4160]] as const) expect(maxSafeLeverageOf(e, s)).toBe(maxSafeLeverage(e, s));
    const html = signalCardHtml({ symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 103, sl: 99 } as any, "es", { disclaimer: false });
    expect(html).toContain("Apalancamiento máx. sugerido: <b>60x</b>");
    expect(signalCardHtml({ symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 103, sl: 99 } as any, "en", { disclaimer: false })).toContain("Max. suggested leverage: <b>60x</b>");
  });
});

describe("topes que no se llevan bien", () => {
  it("avisa cuando el tope diario casi no deja margen para perder", async () => {
    const { liveConfigWarnings } = await import("../packages/core/src/trading");
    expect(liveConfigWarnings({ riskUsdt: 0.8, dailyLossUsdt: 0.9 })).toHaveLength(1);
    expect(liveConfigWarnings({ riskUsdt: 0.5, dailyLossUsdt: 1 })).toHaveLength(1); // solo 2 pérdidas
    expect(liveConfigWarnings({ riskUsdt: 0.3, dailyLossUsdt: 1 })).toEqual([]); // 3 pérdidas: ok
    expect(liveConfigWarnings({ riskUsdt: 0.1, dailyLossUsdt: 0.5 })).toEqual([]);
    // tope semanal: menor que el diario avisa; igual o mayor, o sin tope (0), no
    expect(liveConfigWarnings({ riskUsdt: 0.3, dailyLossUsdt: 1, weeklyLossUsdt: 0.5 })).toHaveLength(1);
    expect(liveConfigWarnings({ riskUsdt: 0.3, dailyLossUsdt: 1, weeklyLossUsdt: 5 })).toEqual([]);
    expect(liveConfigWarnings({ riskUsdt: 0.3, dailyLossUsdt: 1, weeklyLossUsdt: 0 })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { detectHit, parseMarketSymbol, rOfHit } from "../supabase/functions/_shared/autoClose";

const candle = (t: number, h: number, l: number) => ({ t, h, l });

describe("cierre automático", () => {
  it("reconoce símbolos de cripto", () => {
    expect(parseMarketSymbol("XRP-USDC")).toEqual(parseMarketSymbol("XRPUSDC"));
    expect(parseMarketSymbol("BTCUSDT")).toBeTruthy();
  });

  it("marca TP, SL, y SL cuando una misma vela toca ambos", () => {
    const open = { id: "a", user_id: "u", symbol: "BTCUSDT", direction: "LONG" as const, entry: 100, tp: 110, sl: 95, date: new Date(0).toISOString() };
    expect(detectHit(open, [candle(10, 111, 99)] as any)?.outcome).toBe("TP");
    expect(detectHit(open, [candle(10, 105, 94)] as any)?.outcome).toBe("SL");
    expect(detectHit(open, [candle(10, 111, 94)] as any)?.outcome).toBe("SL");
    expect(detectHit(open, [candle(10, 105, 99)] as any)).toBeNull();
    expect(rOfHit(open as any, "TP")).toBe(2);
    expect(rOfHit(open as any, "SL")).toBe(-1);
  });
});

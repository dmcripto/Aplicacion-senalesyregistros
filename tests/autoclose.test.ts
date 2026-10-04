import { describe, expect, it } from "vitest";
import { detectHit, detectPartial, parseMarketSymbol, partialLevel, rOfHit } from "../supabase/functions/_shared/autoClose";

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

describe("aviso de Target 1 (beneficios parciales)", () => {
  const base = { symbol: "BTCUSDT", entry: 100, tp: 130, sl: 90, date: new Date(0).toISOString() };
  const long = { ...base, direction: "LONG" as const };
  const short = { ...base, direction: "SHORT" as const, entry: 100, tp: 70, sl: 110 };

  it("el nivel está a 1R a favor, y solo si el TP queda a 1,5R o más", () => {
    expect(partialLevel(long)).toBe(110);
    expect(partialLevel(short)).toBe(90);
    expect(partialLevel({ ...long, tp: 110 })).toBeNull(); // R:R 1:1 → alcanza con el aviso del TP
    expect(partialLevel({ ...long, tp: 114 })).toBeNull(); // 1,4R
    expect(partialLevel({ ...long, tp: 115 })).toBe(110); // 1,5R
    expect(partialLevel({ ...long, sl: 100 })).toBeNull(); // sin riesgo
  });

  it("detecta la primera vela que llega al nivel antes del SL", () => {
    expect(detectPartial(long, [candle(10, 105, 99), candle(20, 111, 100)] as any)).toBe(20);
    expect(detectPartial(short, [candle(10, 101, 95), candle(20, 100, 89)] as any)).toBe(20);
  });

  it("no avisa si el SL se tocó antes o en la misma vela, ni con velas anteriores a la apertura", () => {
    expect(detectPartial(long, [candle(10, 105, 89), candle(20, 115, 100)] as any)).toBeNull(); // SL primero
    expect(detectPartial(long, [candle(10, 115, 89)] as any)).toBeNull(); // misma vela
    expect(detectPartial({ ...long, date: new Date(50).toISOString() }, [candle(10, 120, 100)] as any)).toBeNull();
    expect(detectPartial(long, [candle(10, 108, 99)] as any)).toBeNull(); // todavía no llegó
  });
});

import { describe, expect, it } from "vitest";
import { isoDay, parseUpcomingUnlocks } from "../supabase/functions/_shared/tokenomist";

const item = (over: any = {}) => ({
  tokenId: "layerzero",
  tokenSymbol: "ZRO",
  marketCap: 278811255,
  upcomingEvent: { unlockDate: "2025-11-20T11:00:00Z", cliffUnlocks: { cliffValue: 49929711.58, valueToMarketCap: 2.7744 } },
  ...over,
});

describe("desbloqueos de Tokenomist", () => {
  it("pasa la respuesta al formato de la tabla", () => {
    expect(parseUpcomingUnlocks([item()])).toEqual([{ symbol: "ZROUSDT", at: "2025-11-20T11:00:00.000Z", pct: 2.7744 }]);
  });
  it("calcula el % con el valor y la capitalización si falta valueToMarketCap", () => {
    const r = parseUpcomingUnlocks([item({ upcomingEvent: { unlockDate: "2025-11-20T11:00:00Z", cliffUnlocks: { cliffValue: 1_000_000 } }, marketCap: 100_000_000 })]);
    expect(r[0].pct).toBe(1);
  });
  it("descarta lo que no se entiende y repite el mayor si hay duplicados", () => {
    const r = parseUpcomingUnlocks([
      item({ tokenSymbol: "" }),
      item({ upcomingEvent: { unlockDate: "no es fecha", cliffUnlocks: { valueToMarketCap: 3 } } }),
      item({ upcomingEvent: { unlockDate: "2025-11-20T11:00:00Z", cliffUnlocks: {} }, marketCap: null }),
      item(),
      item({ upcomingEvent: { unlockDate: "2025-11-20T11:00:00Z", cliffUnlocks: { valueToMarketCap: 9 } } }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].pct).toBe(9);
  });
  it("tolera una respuesta vacía o rara", () => {
    expect(parseUpcomingUnlocks(null)).toEqual([]);
    expect(parseUpcomingUnlocks({})).toEqual([]);
  });
  it("suma días a una fecha", () => {
    expect(isoDay(Date.UTC(2026, 0, 30), 3)).toBe("2026-02-02");
  });
});

import { describe, expect, it } from "vitest";
import { BOT_ASSETS, BOT_MAX_SYMBOLS, botAssetGroups, botAssetName } from "../packages/core/src/trading";
import { isBotSymbol, isTradableSymbol } from "../supabase/functions/_shared/botStrategy";

describe("catálogo de activos del bot", () => {
  it("incluye oro, plata, petróleo, MSTR y ENA, sin repetidos", () => {
    for (const sym of ["XAUUSDT", "XAGUSDT", "CLUSDT", "MSTRUSDT", "ENAUSDT", "BTCUSDT"]) expect(BOT_ASSETS).toContain(sym);
    expect(new Set(BOT_ASSETS).size).toBe(BOT_ASSETS.length);
    expect(BOT_ASSETS.length).toBeGreaterThan(60);
  });
  it("todos los símbolos los acepta el servidor y el nombre se ve bien", () => {
    for (const sym of BOT_ASSETS) {
      expect(isTradableSymbol(sym)).toBe(true);
      expect(isBotSymbol(sym)).toBe(true);
    }
    expect(botAssetName("XAUUSDT")).toBe("Oro");
    expect(botAssetName("1000PEPEUSDT")).toBe("PEPE");
    expect(botAssetName("ZZZUSDT")).toBe("ZZZ");
  });
  it("el máximo es 10 y los grupos no están vacíos", () => {
    expect(BOT_MAX_SYMBOLS).toBe(10);
    expect(botAssetGroups().every((g) => g.items.length > 0)).toBe(true);
  });
  it("el servidor rechaza lo que no parece un futuro USDT", () => {
    for (const bad of ["btcusdt", "BTC-USDT", "DROP TABLE", "", "BTCUSD", null, 5]) expect(isBotSymbol(bad)).toBe(false);
  });
});

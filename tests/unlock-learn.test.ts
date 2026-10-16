import { describe, expect, it } from "vitest";
import { parseLlamaEmissions } from "../supabase/functions/_shared/llamaUnlocks";
import { extractEvents, extractTokens, projectRecurring } from "../supabase/functions/_shared/unlockLearn";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

describe("DefiLlama (alternativa gratuita)", () => {
  const item = (over: Record<string, unknown> = {}) => ({ name: "Arbitrum", symbol: "ARB", circSupply: 1_000_000, tPrice: 2, mcap: 2_000_000, nextEvent: { date: Math.floor((NOW + 3 * DAY) / 1000), toUnlock: 50_000 }, ...over });

  it("calcula el tamaño del desbloqueo sobre lo que circula (fechas en segundos) y descarta lo chico o lejano", () => {
    const rows = parseLlamaEmissions([item(), item({ symbol: "TINY", nextEvent: { date: Math.floor((NOW + DAY) / 1000), toUnlock: 100 } }), item({ symbol: "FAR", nextEvent: { date: Math.floor((NOW + 90 * DAY) / 1000), toUnlock: 500_000 } })], NOW);
    expect(rows).toEqual([{ symbol: "ARBUSDT", at: new Date(NOW + 3 * DAY).toISOString(), pct: 5 }]);
  });
  it("si no hay oferta circulante, usa valor y capitalización; acepta listas de cantidades y fechas en milisegundos", () => {
    const rows = parseLlamaEmissions([item({ circSupply: undefined, nextEvent: { date: NOW + 2 * DAY, toUnlock: [10_000, 20_000] } })], NOW);
    expect(rows[0].pct).toBeCloseTo(3, 3); // 30.000 × 2 / 2.000.000
  });
  it("sin nextEvent toma el primer evento futuro de la lista, y lo que no se entiende se descarta", () => {
    const rows = parseLlamaEmissions({ data: [item({ nextEvent: undefined, events: [{ timestamp: Math.floor((NOW - 5 * DAY) / 1000), noOfTokens: [1] }, { timestamp: Math.floor((NOW + 4 * DAY) / 1000), noOfTokens: [100_000] }] }), { symbol: "???" }, null] }, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("ARBUSDT");
    expect(parseLlamaEmissions("nada", NOW)).toEqual([]);
  });
});

describe("aprender del período de prueba", () => {
  it("saca los tokens de la lista de la fuente (id y símbolo) sin repetir", () => {
    const json = { status: true, data: [{ id: "arbitrum", symbol: "ARB" }, { tokenId: "zro", tokenSymbol: "zro" }, { id: "arbitrum", symbol: "ARB" }, { id: "x", symbol: "mal símbolo largo muy largo" }] };
    expect(extractTokens({ status: 200, body: json }).map((t) => `${t.id}:${t.symbol}`)).toEqual(["arbitrum:ARB", "zro:ZRO"]);
  });

  it("saca cada desbloqueo de los eventos de un token (en % o con valor y capitalización) y deja el mayor de cada día", () => {
    const json = { marketCap: 1000, data: [
      { unlockDate: "2026-03-20T00:00:00Z", cliffUnlocks: { valueToMarketCap: 4.2 } },
      { unlockDate: "2026-03-20T12:00:00Z", cliffUnlocks: { valueToMarketCap: 1 } },
      { unlockDate: "2026-04-20T00:00:00Z", cliffUnlocks: { cliffValue: 30 } },
      { unlockDate: "2026-05-20T00:00:00Z", note: "sin tamaño" },
    ] };
    const ev = extractEvents(json, "zro");
    expect(ev.map((e) => [e.symbol, e.at.slice(0, 10), e.pct])).toEqual([["ZROUSDT", "2026-03-20", 4.2], ["ZROUSDT", "2026-04-20", 3]]);
    expect(extractEvents(json, "")).toEqual([]);
  });

  const monthly = (symbol: string, pct = 2, n = 5, gapDays = 30, lastAgo = 10) =>
    Array.from({ length: n }, (_, i) => ({ symbol, at: new Date(NOW - (lastAgo + (n - 1 - i) * gapDays) * DAY).toISOString(), pct }));

  it("proyecta los próximos desbloqueos de un activo con ritmo fijo", () => {
    const rows = projectRecurring(monthly("ZROUSDT"), NOW);
    expect(rows).toHaveLength(1); // último hace 10 días + 30 = dentro de 20 días
    expect(rows[0].symbol).toBe("ZROUSDT");
    expect(rows[0].pct).toBe(2);
    expect(new Date(rows[0].at).getTime() - NOW).toBeCloseTo(20 * DAY, -5);
  });
  it("no proyecta si el ritmo no es fijo, hay pocos eventos, son chicos o el último es muy viejo", () => {
    const irregular = [10, 55, 70, 130].map((d, i) => ({ symbol: "AAAUSDT", at: new Date(NOW - d * DAY).toISOString(), pct: 2 + i }));
    expect(projectRecurring(irregular, NOW)).toEqual([]);
    expect(projectRecurring(monthly("BBBUSDT", 2, 2), NOW)).toEqual([]);
    expect(projectRecurring(monthly("CCCUSDT", 0.1), NOW)).toEqual([]);
    expect(projectRecurring(monthly("DDDUSDT", 2, 5, 30, 120), NOW)).toEqual([]);
  });
  it("con ritmo mensual y horizonte largo proyecta varios y usa la mediana del tamaño", () => {
    const hist = monthly("EEEUSDT", 2, 4).map((r, i) => ({ ...r, pct: [1, 3, 5, 9][i] }));
    const rows = projectRecurring(hist, NOW, 70);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].pct).toBe(5); // mediana de los últimos tres (3, 5, 9)
  });
});

describe("rango permitido por la prueba de Tokenomist", () => {
  it("lee las dos formas del mensaje", async () => {
    const { parseAllowedRange } = await import("../supabase/functions/_shared/tokenomist");
    expect(parseAllowedRange("Invalid Date Range : The available range for unlock events data are 2025-10-16 - 2026-10-16")).toEqual({ from: "2025-10-16", to: "2026-10-16" });
    expect(parseAllowedRange("date must be within the allowed range: 2025-01-01 to 2026-01-01")).toEqual({ from: "2025-01-01", to: "2026-01-01" });
    expect(parseAllowedRange("otra cosa")).toBeNull();
    expect(parseAllowedRange(undefined)).toBeNull();
  });
});

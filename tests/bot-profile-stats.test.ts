import { describe, expect, it } from "vitest";
import { botProfileKey, botProfileStats } from "../packages/core/src/trading";
import type { Trade } from "../packages/core/src/trading";

const trade = (o: Partial<Trade>): Trade => ({ id: String(Math.random()), symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 102, sl: 99, date: "2026-10-14T10:00:00Z", outcome: "TP", ...o });
const sim = (profile: string, o: Partial<Trade> = {}) => trade({ notes: `🤖 Bot simulado (${profile}) · ruptura`, tags: ["Bot simulado"], ...o });

describe("rendimiento por perfil del bot", () => {
  it("reconoce el perfil por la nota y separa pruebas paralelas y bot real", () => {
    expect(botProfileKey(sim("perfil de máxima actividad, todas las señales posibles"))?.key).toBe("max");
    expect(botProfileKey(sim("perfil lento con tendencia rápida, velas de 4 horas"))?.key).toBe("slowquick");
    expect(botProfileKey(sim("perfil lento con objetivo amplio, velas de 4 horas"))?.key).toBe("slowwide");
    expect(botProfileKey(sim("perfil lento, velas de 4 horas"))?.key).toBe("slow");
    expect(botProfileKey(sim("perfil dinámico"))?.key).toBe("dynamic");
    expect(botProfileKey(sim("perfil equilibrado"))?.key).toBe("balanced");
    expect(botProfileKey(trade({ notes: "🧪 Bot simulado · prueba paralela «filtro de entradas estiradas» (velas de 4 horas)", tags: ["Bot simulado", "Filtro 4h"] }))?.key).toBe("p-filtro");
    expect(botProfileKey(trade({ notes: "🏃 Bot simulado · prueba paralela «corredor»", tags: ["Bot simulado", "Corredor"] }))?.key).toBe("p-corredor");
    expect(botProfileKey(trade({ notes: "🤖 Bot real · Bitunix", tags: ["Bot real"] }))).toMatchObject({ key: "real", real: true });
    expect(botProfileKey(trade({ notes: "Bitunix · cantidad 1" }))).toBeNull(); // operación manual
  });

  it("suma aciertos, R neto y compras/ventas por perfil, y cuenta las abiertas aparte", () => {
    const rows = botProfileStats([
      sim("perfil de máxima actividad", { outcome: "TP", direction: "SHORT", entry: 100, tp: 98.8, sl: 100.8, exit: 98.8 }),
      sim("perfil de máxima actividad", { outcome: "TP", direction: "SHORT", entry: 100, tp: 98.8, sl: 100.8, exit: 98.8 }),
      sim("perfil de máxima actividad", { outcome: "SL", direction: "LONG", entry: 100, tp: 101.2, sl: 99.2, exit: 99.2 }),
      sim("perfil de máxima actividad", { outcome: "ABIERTA" }),
      sim("perfil dinámico", { outcome: "SL", entry: 100, tp: 101.5, sl: 98.8, exit: 98.8 }),
      trade({ notes: "Bitunix manual" }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["max", "dynamic"]);
    const max = rows[0];
    expect(max.ops).toBe(3);
    expect(max.open).toBe(1);
    expect(max.winRate).toBeCloseTo(66.67, 1);
    expect(max.netR).toBeCloseTo(1.5 + 1.5 - 1, 1); // 2 ventas ganadas (1,5R cada una) y una compra perdida
    expect(max.shorts.ops).toBe(2);
    expect(max.longs).toMatchObject({ ops: 1 });
    expect(max.avgR).toBeCloseTo(max.netR / 3, 5);
  });
});

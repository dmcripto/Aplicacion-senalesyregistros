import { describe, expect, it } from "vitest";
import { filterBySource, metricsOf, strategyPlan, strategySources } from "../packages/core/src/trading";
import type { Trade } from "../packages/core/src/trading";

// Operación ya cerrada: entrada 100, riesgo 1 → TP = +rr, SL = −1.
let n = 0;
const mk = (iso: string, r: number, over: Partial<Trade> = {}): Trade => {
  const win = r > 0;
  const closed = new Date(new Date(iso).getTime() + 2 * 3_600_000).toISOString();
  return {
    id: `t${n++}`,
    symbol: "BTCUSDT",
    direction: "LONG",
    entry: 100,
    sl: 99,
    tp: 100 + Math.max(r, 1),
    date: iso,
    outcome: win ? "TP" : "SL",
    closedAt: closed,
    ...over,
  };
};
const day = (d: number, h = 10) => new Date(2026, 8, d, h, 0, 0).toISOString();

describe("métricas", () => {
  it("calcula acierto, payoff, expectativa, factor de beneficio y caída", () => {
    const m = metricsOf([2, -1, 2, -1, -1, 2]);
    expect(m.n).toBe(6);
    expect(m.winRate).toBeCloseTo(50);
    expect(m.payoff).toBeCloseTo(2);
    expect(m.netR).toBeCloseTo(3);
    expect(m.expectancy).toBeCloseTo(0.5);
    expect(m.profitFactor).toBeCloseTo(2);
    expect(m.maxDrawdownR).toBeCloseTo(2); // +2 -1 +2 -1 -1 → pico 3, piso 1
    expect(m.maxLossStreak).toBe(2);
  });
  it("sin operaciones no inventa números", () => {
    const m = metricsOf([]);
    expect(m.n).toBe(0);
    expect(m.profitFactor).toBeNull();
  });
});

describe("estrategia sugerida", () => {
  it("pide un mínimo de operaciones cerradas", () => {
    const trades = Array.from({ length: 6 }, (_, i) => mk(day(1 + i), 1));
    const p = strategyPlan(trades);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.have).toBe(6);
  });

  it("no cuenta las abiertas", () => {
    const trades = [...Array.from({ length: 9 }, (_, i) => mk(day(1 + i), 1)), { ...mk(day(12), 1), outcome: "ABIERTA" as const, closedAt: undefined }];
    expect(strategyPlan(trades).ok).toBe(false);
  });

  it("sugiere evitar el activo que más pierde y mide qué habría pasado", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 12; i++) trades.push(mk(day(1 + i), i % 3 === 0 ? -1 : 2, { symbol: "BTCUSDT" })); // gana
    for (let i = 0; i < 8; i++) trades.push(mk(day(13 + i), i % 4 === 0 ? 1 : -1, { symbol: "DOGEUSDT" })); // pierde
    const p = strategyPlan(trades);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const avoid = p.rules.find((r) => r.kind === "avoid");
    expect(avoid?.title).toContain("DOGEUSDT");
    expect(avoid?.impactR).toBeGreaterThan(0);
    expect(p.after).not.toBeNull();
    expect(p.after!.netR).toBeGreaterThan(p.before.netR);
    expect(p.avoidedTrades).toBe(8);
  });

  it("con pocas operaciones nunca da confianza alta", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 6; i++) trades.push(mk(day(1 + i), 2));
    for (let i = 0; i < 6; i++) trades.push(mk(day(8 + i), -1, { symbol: "XRPUSDT" }));
    const p = strategyPlan(trades);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.rules.filter((r) => r.kind === "avoid" || r.kind === "focus").every((r) => r.confidence === "low")).toBe(true);
  });

  it("si el promedio es negativo, lo primero es bajar el riesgo", () => {
    const trades = Array.from({ length: 14 }, (_, i) => mk(day(1 + i), i % 4 === 0 ? 1 : -1));
    const p = strategyPlan(trades);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.edge).toBe("none");
    expect(p.rules[0].kind).toBe("risk");
    expect(p.rules[0].confidence).toBe("low"); // con 14 operaciones nunca se afirma con fuerza
    expect(p.lowSample).toBe(true);
    expect(p.headline).toContain("todavía no se puede decir");
  });

  it("con muchas operaciones y promedio negativo sí lo afirma", () => {
    const trades = Array.from({ length: 45 }, (_, i) => mk(day(1 + (i % 28)), i % 4 === 0 ? 1 : -1));
    const p = strategyPlan(trades);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.lowSample).toBe(false);
    expect(p.rules[0].confidence).toBe("high");
    expect(p.headline).toContain("Por ahora perdés");
  });

  it("la regla de ganancia/pérdida habla de pérdida promedio, no de 1R", () => {
    const trades = Array.from({ length: 14 }, (_, i) => mk(day(1 + i), i % 4 === 0 ? 1 : -1));
    const p = strategyPlan(trades);
    expect(p.ok && p.rules.some((r) => r.title.includes("pérdida promedio"))).toBe(true);
  });

  it("una ventaja con pocas operaciones se marca como no comprobada, no como real", () => {
    const trades = Array.from({ length: 12 }, (_, i) => mk(day(1 + i), i % 3 === 0 ? -1 : 2));
    const p = strategyPlan(trades);
    expect(p.ok && p.edge).toBe("unproven");
  });

  it("detecta que las pérdidas duran mucho más que las ganancias", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 6; i++) trades.push(mk(day(1 + i), 2)); // ganancias: 2 h
    for (let i = 0; i < 6; i++) {
      const open = day(8 + i);
      trades.push({ ...mk(open, -1), closedAt: new Date(new Date(open).getTime() + 9 * 3_600_000).toISOString() }); // pérdidas: 9 h
    }
    const p = strategyPlan(trades);
    expect(p.ok && p.rules.some((r) => r.title.toLowerCase().includes("stop"))).toBe(true);
  });

  it("traduce la peor caída a % del capital con el riesgo que usás", () => {
    const trades = Array.from({ length: 12 }, (_, i) => mk(day(1 + i), i < 6 ? -1 : 2));
    const p = strategyPlan(trades, { riskPct: 2 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const risk = p.rules.find((r) => r.kind === "risk" && r.why.includes("capital"));
    expect(risk).toBeTruthy();
    expect(risk!.why).toContain("12%"); // 6R de caída × 2%
  });

  it("comprueba las reglas con operaciones más nuevas que no se usaron para armarlas", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 40; i++) trades.push(mk(day(1 + (i % 28), 8 + (i % 3)), i % 3 === 0 ? -1 : 2, { symbol: "BTCUSDT" }));
    for (let i = 0; i < 20; i++) trades.push(mk(day(1 + (i % 28), 14), i % 5 === 0 ? 1 : -1, { symbol: "PEPEUSDT" }));
    const p = strategyPlan(trades);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.validation).not.toBeNull();
    expect(p.validation!.testN).toBeGreaterThanOrEqual(8);
    expect(p.validation!.held).toBe(true);
  });
});

describe("estrategia por exchange", () => {
  const set: Trade[] = [
    ...Array.from({ length: 12 }, (_, i) => mk(day(1 + i), i % 3 === 0 ? -1 : 2, { source: "mexc" })),
    ...Array.from({ length: 10 }, (_, i) => mk(day(14 + i), i % 2 === 0 ? -1 : 1, { source: "bitunix" })),
    ...Array.from({ length: 3 }, (_, i) => mk(day(25 + i), 1)),
    { ...mk(day(28), 1), outcome: "ABIERTA" as const, closedAt: undefined, source: "mexc" },
  ];
  it("lista de dónde viene cada operación cerrada, con el manual al final", () => {
    expect(strategySources(set)).toEqual([
      { id: "mexc", count: 12 },
      { id: "bitunix", count: 10 },
      { id: "manual", count: 3 },
    ]);
  });
  it("filtra por origen y cada exchange tiene su propio plan", () => {
    expect(filterBySource(set, "all")).toHaveLength(set.length);
    expect(filterBySource(set, "mexc")).toHaveLength(13);
    expect(filterBySource(set, "manual")).toHaveLength(3);
    const a = strategyPlan(filterBySource(set, "mexc"), { source: "mexc" });
    const b = strategyPlan(filterBySource(set, "bitunix"), { source: "bitunix" });
    expect(a.ok && a.source).toBe("mexc");
    expect(a.ok && a.profile.n).toBe(12);
    expect(b.ok && b.profile.n).toBe(10);
    expect(a.ok && b.ok && a.profile.expectancy).not.toBe(b.ok && b.profile.expectancy);
  });
  it("un origen con pocas operaciones avisa cuántas faltan", () => {
    const p = strategyPlan(filterBySource(set, "manual"));
    expect(p.ok).toBe(false);
  });
});

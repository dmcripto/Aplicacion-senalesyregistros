import { describe, expect, it } from "vitest";
import { BOT_PROFILES as CORE_PROFILES, BOT_OWN_MIN, botHowItDecides, botProfileInfo, actionId, backtestVerdict, filterBySource, metricsOf, ruleEvidence, strategyPlan, strategySources } from "../packages/core/src/trading";
import { BOT_PROFILES as SERVER_PROFILES, cleanActions } from "../supabase/functions/_shared/botStrategy";
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

describe("reglas que el bot puede aplicar", () => {
  const mkSet = () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 12; i++) trades.push(mk(day(1 + i), i % 3 === 0 ? -1 : 2, { symbol: "BTCUSDT" }));
    for (let i = 0; i < 8; i++) trades.push(mk(day(13 + i), i % 4 === 0 ? 1 : -1, { symbol: "ETHUSDT" }));
    return trades;
  };

  it("evitar un activo viene con la acción para el bot y qué hará", () => {
    const p = strategyPlan(mkSet());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = p.rules.find((x) => x.kind === "avoid" && x.title.includes("ETHUSDT"));
    expect(r?.action).toEqual({ op: "skip", dim: "symbol", key: "ETHUSDT" });
    expect(r?.effect).toBe("El bot no operará ETHUSDT.");
    expect(r?.id).toBe("skip:symbol:ETHUSDT");
  });

  it("concentrarse en un activo es «solo operar»", () => {
    const p = strategyPlan(mkSet());
    if (!p.ok) throw new Error("sin plan");
    const f = p.rules.find((x) => x.kind === "focus" && x.title.includes("BTCUSDT"));
    expect(f?.action).toEqual({ op: "only", dim: "symbol", key: "BTCUSDT" });
    expect(f?.effect).toBe("El bot operará solo BTCUSDT.");
  });

  it("el tope diario y el freno por pérdidas también se pueden aplicar", () => {
    const trades: Trade[] = [];
    // días con muchas operaciones perdedoras y días tranquilos ganadores
    for (let d = 1; d <= 6; d++) for (let k = 0; k < 4; k++) trades.push(mk(day(d, 8 + k), -1));
    for (let d = 8; d <= 15; d++) trades.push(mk(day(d, 10), 2));
    const p = strategyPlan(trades);
    if (!p.ok) throw new Error("sin plan");
    expect(p.rules.find((r) => r.action?.op === "maxPerDay")?.action).toEqual({ op: "maxPerDay", n: 3 });
    expect(p.rules.find((r) => r.action?.op === "stopAfterLosses")?.effect).toBe("Tras 3 pérdidas seguidas el bot frena el resto del día.");
  });

  it("los consejos que no cambian al bot no traen acción (riesgo, hábitos)", () => {
    const p = strategyPlan(Array.from({ length: 14 }, (_, i) => mk(day(1 + i), i % 4 === 0 ? 1 : -1)));
    if (!p.ok) throw new Error("sin plan");
    for (const r of p.rules.filter((x) => x.id.startsWith("risk:") || x.id.startsWith("habit:"))) expect(r.action).toBeUndefined();
  });

  it("todo lo que sugiere el núcleo lo entiende la función del servidor (mismo formato)", () => {
    const p = strategyPlan(mkSet());
    if (!p.ok) throw new Error("sin plan");
    for (const r of p.rules) {
      if (!r.action) continue;
      expect(cleanActions([r.action])).toEqual([r.action]);
      expect(r.id).toBe(actionId(r.action));
    }
  });

  it("ids únicos en el plan", () => {
    const p = strategyPlan(mkSet());
    if (!p.ok) throw new Error("sin plan");
    expect(new Set(p.rules.map((r) => r.id)).size).toBe(p.rules.length);
  });
});

describe("qué tan firme es cada regla para el bot", () => {
  const hist = () => {
    const trades: Trade[] = [];
    for (let d = 1; d <= 6; d++) for (let k = 0; k < 4; k++) trades.push(mk(day(d, 8 + k), -1, { symbol: "ETHUSDT" }));
    for (let d = 8; d <= 20; d++) trades.push(mk(day(d, 10), 2, { symbol: "BTCUSDT" }));
    return trades;
  };

  it("los filtros por activo, día u hora son hipótesis si salen de tus operaciones", () => {
    const p = strategyPlan(hist());
    if (!p.ok) throw new Error("sin plan");
    const filters = p.rules.filter((r) => r.action && "dim" in r.action);
    expect(filters.length).toBeGreaterThan(0);
    for (const r of filters) expect(ruleEvidence(p, r)).toBe("hypothesis");
  });

  it("el tope diario y el freno por pérdidas son disciplina, no hipótesis", () => {
    const p = strategyPlan(hist());
    if (!p.ok) throw new Error("sin plan");
    const disc = p.rules.filter((r) => r.action && !("dim" in r.action));
    expect(disc.length).toBeGreaterThan(0);
    for (const r of disc) expect(ruleEvidence(p, r)).toBe("discipline");
  });

  it("con 100 o más operaciones del propio bot los filtros dejan de ser hipótesis", () => {
    const bot: Trade[] = [];
    for (let i = 0; i < BOT_OWN_MIN + 20; i++) bot.push(mk(day(1 + (i % 28), 8 + (i % 4)), i % 3 === 0 ? -1 : 2, { symbol: i % 2 ? "BTCUSDT" : "SOLUSDT", source: "bot" }));
    for (let i = 0; i < 30; i++) bot.push(mk(day(1 + (i % 28), 22), i % 6 === 0 ? 1 : -1, { symbol: "XRPUSDT", source: "bot" }));
    const p = strategyPlan(filterBySource(bot, "bot"), { source: "bot" });
    if (!p.ok) throw new Error("sin plan");
    expect(p.profile.n).toBeGreaterThanOrEqual(BOT_OWN_MIN);
    const f = p.rules.find((r) => r.action && "dim" in r.action);
    expect(f).toBeTruthy();
    expect(ruleEvidence(p, f!)).toBe("bot");
    // pero con pocas operaciones del bot vuelve a ser hipótesis
    const few = strategyPlan(filterBySource(bot, "bot").slice(0, 40), { source: "bot" });
    if (few.ok) for (const r of few.rules.filter((x) => x.action && "dim" in x.action)) expect(ruleEvidence(few, r)).toBe("hypothesis");
  });

  it("un consejo sin acción no se aplica al bot", () => {
    const p = strategyPlan(hist());
    if (!p.ok) throw new Error("sin plan");
    for (const r of p.rules.filter((x) => !x.action)) expect(ruleEvidence(p, r)).toBeNull();
  });

  it("el riesgo va primero y los filtros al final", () => {
    const p = strategyPlan(hist());
    if (!p.ok) throw new Error("sin plan");
    const order = { risk: 0, habit: 1, avoid: 2, focus: 3 } as const;
    const ks = p.rules.map((r) => order[r.kind]);
    expect(ks).toEqual([...ks].sort((a, b) => a - b));
  });
});

describe("veredicto de la prueba con y sin reglas", () => {
  const f = (n: number) => `${n.toFixed(2)}R`;
  it("no dice nada si no hay reglas", () => {
    expect(backtestVerdict({ n: 50, expectancy: 0.1 }, null, f)).toBe("");
  });
  it("con muy pocas operaciones no concluye", () => {
    expect(backtestVerdict({ n: 60, expectancy: 0 }, { n: 8, expectancy: 0.9 }, f)).toContain("no alcanza");
  });
  it("distingue mejora, empeora y casi igual", () => {
    expect(backtestVerdict({ n: 60, expectancy: 0 }, { n: 40, expectancy: 0.2 }, f)).toContain("mejora");
    expect(backtestVerdict({ n: 60, expectancy: 0.1 }, { n: 40, expectancy: -0.1 }, f)).toContain("empeora");
    expect(backtestVerdict({ n: 60, expectancy: 0.1 }, { n: 40, expectancy: 0.12 }, f)).toContain("casi no cambia");
  });
});

describe("perfiles del bot: pantalla y servidor", () => {
  it("los números de cada perfil son los mismos en el núcleo y en la función del servidor", () => {
    for (const id of ["conservative", "balanced", "dynamic"] as const) {
      const c = CORE_PROFILES[id], s = SERVER_PROFILES[id];
      expect({ lookback: s.lookback, emaFast: s.emaFast, emaSlow: s.emaSlow, atrMult: s.atrMult, rr: s.rr }).toEqual(c);
    }
  });

  it("«Cómo decide» usa los números del perfil", () => {
    const bal = botHowItDecides("balanced").join(" ");
    expect(bal).toContain("últimas 20 velas");
    expect(bal).toContain("1,5 veces el ATR");
    expect(bal).toContain("2R");
    const dyn = botHowItDecides("dynamic").join(" ");
    expect(dyn).toContain("últimas 10 velas");
    expect(dyn).toContain("1,5R");
    expect(dyn).toContain("media de 20 velas sobre la de 100");
  });

  it("cada perfil tiene nombre y explicación", () => {
    expect(botProfileInfo("conservative").name).toBe("Conservador");
    expect(botProfileInfo("balanced").name).toBe("Equilibrado");
    expect(botProfileInfo("dynamic").blurb.length).toBeGreaterThan(10);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  analyze, balanceInfo, calcPosition, cleanTags, computeStats, dailyStatus, fmtCurrency, monthlySummary,
  parseAlerts, resultR, rrOf, rValueMoney, sampleTrades, setLang, summarize, tagStats, tradesToCsv,
} from "../packages/core/src/trading";
import type { Trade } from "../packages/core/src/trading";

beforeEach(() => setLang("es"));

const trade = (o: Partial<Trade>): Trade => ({
  id: "x", symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 110, sl: 95, date: new Date().toISOString(), outcome: "ABIERTA", ...o,
});

describe("intérprete de señales", () => {
  const one = (text: string) => {
    const r = parseAlerts(text);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
    return r.valid[0];
  };

  it("formato con barras (con y sin prefijo VELTRIX)", () => {
    expect(one("VELTRIX|BTCUSDT|COMPRA|65405.8|66694.4|65161.1")).toMatchObject({ symbol: "BTCUSDT", direction: "LONG", entry: 65405.8, tp: 66694.4, sl: 65161.1 });
    expect(one("BTCUSDT|VENTA|100|95|105")).toMatchObject({ direction: "SHORT", entry: 100, tp: 95, sl: 105 });
  });

  it("JSON y clave=valor", () => {
    expect(one('{"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":66500,"sl":64500}')).toMatchObject({ direction: "LONG", entry: 65000 });
    expect(one("symbol=ETHUSDT side=sell entry=3000 tp=2900 sl=3050")).toMatchObject({ symbol: "ETHUSDT", direction: "SHORT" });
  });

  it("texto libre de Telegram/WhatsApp", () => {
    expect(one("#BTC/USDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500")).toMatchObject({ symbol: "BTCUSDT", direction: "LONG", tp: 66500, sl: 64500 });
    expect(one("XRP/USDT SHORT\nEntry zone: 0.5200-0.5250\nTP: 0.50\nSL: 0.53")).toMatchObject({ symbol: "XRPUSDT", entry: 0.5225 });
  });

  it("separadores de miles y decimales en ambos estilos", () => {
    expect(one("BTCUSDT LONG Entry: 65,000.5 TP1: 66,500 SL: 64,500")).toMatchObject({ entry: 65000.5, tp: 66500 });
    expect(one("ETH SHORT Entrada: 3.020,5 Objetivo 1: 2.900 Stop: 3.100")).toMatchObject({ entry: 3020.5, tp: 2900, sl: 3100 });
  });

  it("rechaza niveles incoherentes y mensajes sin datos", () => {
    const bad = parseAlerts("BTC LONG entry 65000 tp 64000 sl 66000");
    expect(bad.valid).toHaveLength(0);
    expect(bad.errors[0]).toMatch(/niveles/i);
    expect(parseAlerts("hola").valid).toHaveLength(0);
    expect(parseAlerts("").errors).toHaveLength(1);
  });

  it("varias alertas en un mismo mensaje", () => {
    const r = parseAlerts("BTCUSDT|COMPRA|100|110|95\nETHUSDT|VENTA|50|45|53");
    expect(r.valid.map((v) => v.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

describe("resultados en R", () => {
  it("TP, SL y cierre manual", () => {
    expect(resultR(trade({ outcome: "TP" }))).toBe(2);
    expect(resultR(trade({ outcome: "SL" }))).toBe(-1);
    expect(resultR(trade({ outcome: "MANUAL", exit: 105 }))).toBe(1);
    expect(resultR(trade({ direction: "SHORT", entry: 100, tp: 90, sl: 105, outcome: "MANUAL", exit: 102 }))).toBeCloseTo(-0.4);
    expect(resultR(trade({ outcome: "ABIERTA" }))).toBeNull();
    expect(rrOf(trade({}))).toBe(2);
  });

  it("estadísticas, resumen mensual y análisis", () => {
    const list = sampleTrades();
    const st = computeStats(list);
    expect(st.total).toBe(list.length);
    expect(st.cerradas + st.abiertas).toBe(st.total);
    expect(st.ganadas + st.perdidas).toBeLessThanOrEqual(st.cerradas);
    expect(monthlySummary(list).length).toBeGreaterThan(0);
    const a = analyze(list);
    expect(a.byWeekday).toHaveLength(7);
    expect(a.byHour).toHaveLength(8);
  });
});

describe("dinero y capital", () => {
  it("1R en dinero, balance y formato", () => {
    const m = { capital: 1000, riskPct: 1, currency: "USD" };
    expect(rValueMoney(m)).toBe(10);
    expect(rValueMoney({ capital: null, riskPct: 1, currency: "USD" })).toBeNull();
    const info = balanceInfo([trade({ outcome: "TP" }), trade({ outcome: "SL" })], m)!;
    expect(info.pnl).toBe(10);
    expect(info.balance).toBe(1010);
    expect(fmtCurrency(120, "USD")).toBe("+$120.00");
    expect(fmtCurrency(-45.5, "EUR")).toBe("−€45.50");
    expect(fmtCurrency(1200, "ARS")).toBe("+ARS 1,200.00");
  });
});

describe("calculadora de riesgo", () => {
  it("tamaño de posición y advertencias", () => {
    const r = calcPosition({ capital: 1000, riskPct: 1, direction: "LONG", entry: 100, sl: 95, tp: 110 } as any)!;
    expect(r.riskAmount).toBe(10);
    expect(r.units).toBe(2);
    expect(r.rr).toBe(2);
    expect(r.warnings).toEqual([]);
    const risky = calcPosition({ capital: 1000, riskPct: 10, direction: "LONG", entry: 100, sl: 99 } as any)!;
    expect(risky.warnings.length).toBeGreaterThan(0);
    expect(calcPosition({ capital: 0, riskPct: 1, direction: "LONG", entry: 100, sl: 99 } as any)).toBeNull();
  });
});

describe("límites diarios", () => {
  it("avisa al acercarse y frena al alcanzar", () => {
    const now = new Date();
    const loss = (n: number) => Array.from({ length: n }, (_, i) => trade({ id: `l${i}`, outcome: "SL", date: now.toISOString(), closedAt: now.toISOString() }));
    expect(dailyStatus(loss(1), { maxLossR: 5, maxTrades: null }).level).toBe("ok");
    expect(dailyStatus(loss(4), { maxLossR: 5, maxTrades: null }).level).toBe("warning");
    const stop = dailyStatus(loss(5), { maxLossR: 5, maxTrades: null });
    expect(stop.level).toBe("stop");
    expect(stop.messages[0]).toMatch(/pérdida máxima/);
    expect(dailyStatus(loss(2), { maxLossR: null, maxTrades: 2 }).level).toBe("stop");
  });
});

describe("etiquetas y exportación", () => {
  it("limpia etiquetas y las resume", () => {
    expect(cleanTags([" FOMO ", "fomo", "", "Calma"])).toEqual(["FOMO", "Calma"]);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(8);
    const rows = tagStats([trade({ outcome: "TP", tags: ["FOMO"] }), trade({ outcome: "SL", tags: ["FOMO", "Calma"] })]);
    expect(rows.find((r) => r.tag === "FOMO")).toMatchObject({ ops: 2, netR: 1 });
  });

  it("CSV con encabezados y una fila por operación", () => {
    const csv = tradesToCsv(sampleTrades().slice(0, 3));
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv.split("\n")[0]).toContain("Activo");
  });

  it("resumen para compartir solo trae R", () => {
    const s = summarize(sampleTrades(), "all");
    expect(s.closed).toBeGreaterThan(0);
    expect(Object.keys(s)).not.toContain("money");
  });
});

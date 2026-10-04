import { beforeEach, describe, expect, it } from "vitest";
import {
  analyze, balanceInfo, binanceSymbol, levelProgress, todayOverview, calcPosition, cleanTags, computeStats, dailyStatus, fmtCurrency, monthlySummary,
  demoFrame, parseAlerts, resultR, rrOf, rValueMoney, sampleTrades, setLang, signalShareMessage, summarize, tagStats, tradesToCsv, whatsappShareUrl,
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

import { cumulativeLiquidations, fmtUsdShort, rebinLiquidations } from "../packages/core/src/trading";
import type { LiquidationMap } from "../packages/core/src/trading";

describe("mapa de liquidaciones: agrupar y acumular", () => {
  const map: LiquidationMap = {
    coin: "BTC", symbol: "BTCUSDT", source: "binance", price: 100, step: 1, hours: 10, leverages: [5, 10], openInterestUsd: 1000, computedAt: 0, hotspots: [],
    buckets: [
      { price: 96.5, longs: [10, 20], shorts: [0, 0] },
      { price: 97.5, longs: [5, 0], shorts: [0, 0] },
      { price: 98.5, longs: [1, 1], shorts: [0, 0] },
      { price: 101.5, longs: [0, 0], shorts: [4, 6] },
      { price: 102.5, longs: [0, 0], shorts: [2, 3] },
    ],
  };

  it("agrupa por columnas sin perder dinero y respeta el rango", () => {
    const cols = rebinLiquidations(map, 96, 104, 4); // columnas de 2 de ancho: 96–98, 98–100, 100–102, 102–104
    expect(cols).toHaveLength(4);
    expect(cols.map((c) => c.longTotal)).toEqual([35, 2, 0, 0]); // 96,5 (30) + 97,5 (5) | 98,5 (2)
    expect(cols.map((c) => c.shortTotal)).toEqual([0, 0, 10, 5]);
    expect(cols[0].longs).toEqual([15, 20]); // por apalancamiento: 10+5 y 20+0
    expect(cols.reduce((a, c) => a + c.longTotal + c.shortTotal, 0)).toBe(52); // nada se pierde
    // un zoom que deja afuera parte de los niveles solo cuenta los de adentro
    expect(rebinLiquidations(map, 100, 104, 2).reduce((a, c) => a + c.longTotal, 0)).toBe(0);
  });

  it("acumula desde el precio actual hacia afuera", () => {
    const cum = cumulativeLiquidations(map);
    expect(cum.longs.map((p) => [p.price, p.usd])).toEqual([[96.5, 37], [97.5, 7], [98.5, 2]]); // si cae hasta 96,5 se liquidan 37
    expect(cum.shorts.map((p) => [p.price, p.usd])).toEqual([[101.5, 10], [102.5, 15]]);
  });

  it("formatea dólares abreviados", () => {
    expect(fmtUsdShort(1_230_000_000)).toBe("$1.23B");
    expect(fmtUsdShort(15_340_000)).toBe("$15.3M");
    expect(fmtUsdShort(820_000)).toBe("$820K");
    expect(fmtUsdShort(95)).toBe("$95");
  });
});

describe("compartir una señal", () => {
  it("arma el texto con activo, niveles y R:R, sin dinero", () => {
    const m = signalShareMessage(trade({ symbol: "ETHUSDT", direction: "SHORT", entry: 3000, tp: 2900, sl: 3050 }));
    expect(m).toContain("▼ ETHUSDT VENTA");
    expect(m).toContain("Entrada 3000 · TP 2900 · SL 3050 · R:R 1:2.0");
    expect(m).toContain("no es asesoramiento financiero");
    expect(m).not.toContain("$"); // sin montos de dinero
  });

  it("en inglés usa los textos en inglés", () => {
    setLang("en");
    const m = signalShareMessage(trade({ direction: "LONG" }));
    expect(m).toContain("New signal");
    expect(m).toContain("BTCUSDT BUY");
    expect(m).toContain("Entry 100");
  });

  it("el enlace de WhatsApp codifica el texto (saltos de línea, símbolos y emojis)", () => {
    const url = whatsappShareUrl("a b\n& c ▲");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe("a b\n& c ▲");
    expect(url).not.toMatch(/\s/);
  });
});

describe("panel «Tu día» y avance hacia TP/SL", () => {
  const NOW = new Date(2026, 9, 3, 15, 0, 0); // 3 oct 2026, hora local
  const at = (days: number, h = 10) => new Date(2026, 9, 3 + days, h, 0, 0).toISOString();
  const mk = (over: Partial<Trade>): Trade => ({
    id: String(Math.random()), symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 110, sl: 95, date: at(0), outcome: "ABIERTA", tags: [], ...over,
  } as Trade);

  it("suma solo lo cerrado hoy y cuenta abiertas", () => {
    const o = todayOverview([
      mk({ outcome: "TP", closedAt: at(0, 12) }), // +2R
      mk({ outcome: "SL", closedAt: at(0, 13) }), // −1R
      mk({ outcome: "TP", date: at(-1), closedAt: at(-1, 12) }), // ayer
      mk({ outcome: "ABIERTA", date: at(-2) }),
    ], NOW);
    expect(o).toMatchObject({ r: 1, closed: 2, wins: 1, losses: 1, open: 1 });
  });

  it("racha activa y racha en verde (días seguidos)", () => {
    const o = todayOverview([
      mk({ outcome: "TP", date: at(0), closedAt: at(0, 12) }),
      mk({ outcome: "TP", date: at(-1), closedAt: at(-1, 12) }),
      mk({ outcome: "SL", date: at(-2), closedAt: at(-2, 12) }),
      mk({ outcome: "TP", date: at(-3), closedAt: at(-3, 12) }),
    ], NOW);
    expect(o.activeStreak).toBe(4);
    expect(o.greenStreak).toBe(2); // hoy y ayer; el SL de anteayer la corta
  });

  it("sin operaciones hoy, las rachas son 0", () => {
    expect(todayOverview([mk({ outcome: "TP", date: at(-3), closedAt: at(-3) })], NOW)).toMatchObject({ r: 0, activeStreak: 0, greenStreak: 0 });
  });

  it("levelProgress sirve igual para LONG y SHORT", () => {
    const long = levelProgress({ direction: "LONG", entry: 100, tp: 110, sl: 95 }, 105)!;
    expect(long.pos).toBeCloseTo(2 / 3);
    expect(long.entry).toBeCloseTo(1 / 3);
    expect(long.r).toBeCloseTo(1);
    const short = levelProgress({ direction: "SHORT", entry: 100, tp: 90, sl: 105 }, 95)!;
    expect(short.pos).toBeCloseTo(2 / 3);
    expect(short.r).toBeCloseTo(1);
    expect(levelProgress({ direction: "LONG", entry: 100, tp: 110, sl: 95 }, 200)!.pos).toBe(1); // pasado el TP
    expect(levelProgress({ direction: "LONG", entry: 100, tp: 110, sl: 95 }, 50)!.pos).toBe(0);
    expect(levelProgress({ direction: "LONG", entry: 100, tp: 100, sl: 100 }, 100)).toBeNull();
  });

  it("binanceSymbol entiende los formatos habituales y descarta lo que no es cripto", () => {
    expect(binanceSymbol("BTCUSDT")).toEqual({ symbol: "BTCUSDT", perp: false });
    expect(binanceSymbol("BINANCE:SOLUSDT.P")).toEqual({ symbol: "SOLUSDT", perp: true });
    expect(binanceSymbol("eth/usd")).toEqual({ symbol: "ETHUSDT", perp: false });
    expect(binanceSymbol("EURUSD")).toBeNull();
    expect(binanceSymbol("AAPL")).toBeNull();
  });
});

describe("señales con varios targets (TP1, TP2, TP3…)", () => {
  const view = (text: string) => {
    const t = parseAlerts(text).valid[0];
    return t && { tp: t.tp, targets: t.targets };
  };

  it("el TP más lejano es el final y los demás quedan como targets parciales, en cualquier formato", () => {
    const want = { tp: 68000, targets: [66000, 67000] };
    expect(view("VELTRIX|BTCUSDT|COMPRA|65000|66000/67000/68000|64500")).toEqual(want);
    expect(view('{"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":[66000,67000,68000],"sl":64500}')).toEqual(want);
    expect(view("symbol=BTCUSDT side=buy entry=65000 tp1=66000 tp2=67000 tp3=68000 sl=64500")).toEqual(want);
    expect(view("BTCUSDT LONG\nEntry: 65000\nTP1: 66000\nTP2: 67000\nTP3: 68000\nSL: 64500")).toEqual(want);
  });

  it("en una venta ordena hacia abajo; ignora niveles del lado equivocado o repetidos", () => {
    expect(view("BTCUSDT SHORT entrada 65000 targets: 64000, 63000, 62000 sl 66000")).toEqual({ tp: 62000, targets: [64000, 63000] });
    expect(view("VELTRIX|BTCUSDT|COMPRA|65000|66000/66000/64000|64500")).toEqual({ tp: 66000, targets: undefined });
  });

  it("con un solo TP no hay targets parciales", () => {
    expect(view("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500")).toEqual({ tp: 66500, targets: undefined });
    expect(view("BTCUSDT LONG entry 65000 tp 66500 sl 64500")).toEqual({ tp: 66500, targets: undefined });
  });
});

describe("demo animada de la bienvenida", () => {
  it("la señal aparece fila por fila, el precio sube y cada target salta en orden", () => {
    expect(demoFrame(0).levels.every((l) => !l.shown)).toBe(true);
    expect(demoFrame(1400).levels.every((l) => l.shown)).toBe(true);
    const at = (ms: number) => demoFrame(ms);
    expect(at(1400).price).toBe(65000);
    expect(at(2400).price).toBeGreaterThan(65000);
    expect(at(3300).levels.filter((l) => l.reached).map((l) => l.key)).toEqual(["t1"]);
    expect(at(3300).toast?.title).toBe("TARGET 1 ALCANZADO");
    expect(at(5600).levels.filter((l) => l.reached).map((l) => l.key).sort()).toEqual(["t1", "t2"]);
    expect(at(5600).toast?.n).toBe(2);
    expect(at(5600).toast?.text).toContain("Target 1"); // «mover el SL al Target 1»
  });

  it("termina en TP alcanzado con +4.0R, se desvanece y vuelve a empezar", () => {
    const win = demoFrame(9000);
    expect(win.win?.title).toBe("TP ALCANZADO");
    expect(win.win?.r).toBe("+4.0R");
    expect(win.toast).toBeNull();
    expect(demoFrame(11800).fade).toBeGreaterThan(0.5);
    expect(demoFrame(12000 + 3300).levels.filter((l) => l.reached)).toHaveLength(1); // segunda vuelta = igual que la primera
  });

  it("el precio nunca se sale de la entrada y el último target, y el punto queda dentro de las filas", () => {
    for (let ms = 0; ms < 24000; ms += 100) {
      const f = demoFrame(ms);
      expect(f.price).toBeGreaterThanOrEqual(65000);
      expect(f.price).toBeLessThanOrEqual(67000);
      expect(f.track).toBeGreaterThanOrEqual(0);
      expect(f.track).toBeLessThanOrEqual(4);
    }
  });

  it("en inglés usa los textos en inglés", () => {
    setLang("en");
    expect(demoFrame(3300).toast?.title).toBe("TARGET 1 HIT");
    expect(demoFrame(9000).win?.title).toBe("TP HIT");
  });
});

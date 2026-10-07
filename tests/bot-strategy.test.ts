import { describe, expect, it } from "vitest";
import { fetchUniverse, mapPool, scanSizeOf, isTradableSymbol, BAR_MS, LAB_DAYS, LAB_VARIANTS, barMsOf, runLab, BOT_PROFILES, BOT_PROFILE_IDS, DEFAULT_PARAMS, describeParams, isProfileId, paramsOf, allowedByActions, atr, backtest, botStats, capOf, cleanActions, closedBars, ema, fetchBars, indicators, localParts, resolveFrom, signalAt, simulate } from "../supabase/functions/_shared/botStrategy";
import type { Bar } from "../supabase/functions/_shared/botStrategy";

const T0 = Date.UTC(2026, 0, 1);
const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: T0 + i * BAR_MS, o, h, l, c });

/** Tendencia alcista pareja con pequeñas oscilaciones y, al final, una vela que rompe el máximo. */
function uptrendWithBreakout(n = 260): Bar[] {
  const bars: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 3) * 0.4; // ruido que impide que cada vela sea un nuevo máximo
    const c = p + 0.1 + wave * 0.2;
    bars.push(bar(i, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c));
    p = c;
  }
  const last = bars[bars.length - 1].c;
  bars.push(bar(n, last, last + 5, last - 0.2, last + 4.5)); // ruptura fuerte
  return bars;
}

describe("indicadores", () => {
  it("EMA y ATR dan números razonables", () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    expect(e[1]).toBeNaN();
    expect(e[2]).toBeCloseTo(2);
    expect(e[5]).toBeGreaterThan(e[4]);
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, 10, 11, 9, 10));
    expect(atr(bars, 14)[29]).toBeCloseTo(2);
  });
});

describe("señal de ruptura con tendencia", () => {
  it("compra cuando rompe el máximo a favor de la tendencia alcista", () => {
    const bars = uptrendWithBreakout();
    const ind = indicators(bars);
    const sig = signalAt(bars, ind, bars.length - 1);
    expect(sig?.direction).toBe("LONG");
    expect(sig!.sl).toBeLessThan(sig!.entry);
    expect(sig!.tp).toBeGreaterThan(sig!.entry);
    // objetivo = 2 veces el riesgo
    expect((sig!.tp - sig!.entry) / (sig!.entry - sig!.sl)).toBeCloseTo(DEFAULT_PARAMS.rr);
  });

  it("no mira el futuro: cambiar velas posteriores no cambia la señal", () => {
    const bars = uptrendWithBreakout();
    const idx = bars.length - 1;
    const a = signalAt(bars, indicators(bars), idx);
    const more = [...bars, bar(idx + 1, 1, 1000, 0.1, 500), bar(idx + 2, 500, 900, 1, 2)];
    expect(signalAt(more, indicators(more), idx)).toEqual(a);
  });

  it("no opera contra la tendencia ni sin ruptura", () => {
    const bars = uptrendWithBreakout();
    // la misma ruptura hacia abajo en tendencia alcista: no vende
    const last = bars[bars.length - 2].c;
    const down = [...bars.slice(0, -1), bar(bars.length - 1, last, last + 0.2, last - 5, last - 4.5)];
    expect(signalAt(down, indicators(down), down.length - 1)).toBeNull();
    // sin ruptura: la vela cierra dentro del rango
    const flat = [...bars.slice(0, -1), bar(bars.length - 1, last, last + 0.1, last - 0.1, last)];
    expect(signalAt(flat, indicators(flat), flat.length - 1)).toBeNull();
  });

  it("con pocas velas no hay señal", () => {
    const bars = Array.from({ length: 50 }, (_, i) => bar(i, 1, 2, 0.5, 1.5 + i));
    expect(signalAt(bars, indicators(bars), 49)).toBeNull();
  });
});

describe("resolución y prueba con historial", () => {
  it("si una vela toca stop y objetivo a la vez, se asume el stop", () => {
    const bars = [bar(0, 10, 10, 10, 10), bar(1, 10, 20, 5, 12)];
    expect(resolveFrom(bars, 1, { direction: "LONG", sl: 8, tp: 15 })).toEqual({ outcome: "SL", index: 1 });
    expect(resolveFrom(bars, 1, { direction: "SHORT", sl: 15, tp: 8 })).toEqual({ outcome: "SL", index: 1 });
  });

  it("devuelve null si todavía no pasó nada", () => {
    expect(resolveFrom([bar(0, 10, 11, 9, 10)], 0, { direction: "LONG", sl: 5, tp: 20 })).toBeNull();
  });

  it("descuenta el costo en R y no superpone operaciones", () => {
    // tendencia alcista fuerte y pareja: tras cada ruptura el objetivo se toca rápido
    const bars: Bar[] = [];
    let p = 100;
    for (let i = 0; i < 900; i++) {
      const c = p * (1 + 0.003 + (i % 7 === 0 ? -0.004 : 0.001));
      bars.push(bar(i, p, Math.max(p, c) * 1.002, Math.min(p, c) * 0.9985, c));
      p = c;
    }
    const r = backtest(bars);
    expect(r.trades.length).toBeGreaterThan(0);
    const times = r.trades.map((t) => t.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const t of r.trades) {
      if (t.outcome === "TP") expect(t.r).toBeLessThan(DEFAULT_PARAMS.rr); // el costo siempre resta
      else expect(t.r).toBeLessThan(-1);
    }
    expect(botStats(r.trades.map((t) => t.r)).n).toBe(r.trades.length);
  });

  it("estadísticas", () => {
    const s = botStats([2, -1, 2, -1, -1]);
    expect(s.n).toBe(5);
    expect(s.winRate).toBeCloseTo(40);
    expect(s.netR).toBeCloseTo(1);
    expect(s.profitFactor).toBeCloseTo(4 / 3);
    expect(s.maxDrawdownR).toBeCloseTo(2);
    expect(botStats([]).n).toBe(0);
  });
});

describe("velas", () => {
  it("descarta la vela que todavía está en curso", () => {
    const now = T0 + 5.5 * BAR_MS;
    const bars = Array.from({ length: 6 }, (_, i) => bar(i, 1, 1, 1, 1));
    expect(closedBars(bars, now).map((b) => b.t)).toEqual(bars.slice(0, 5).map((b) => b.t));
  });

  it("baja velas de Binance y, si falla, de Bybit", async () => {
    const mk = (i: number) => [T0 + i * BAR_MS, "1", "2", "0.5", "1.5", "10"];
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.includes("binance")) return new Response("blocked", { status: 451 });
      return new Response(JSON.stringify({ result: { list: Array.from({ length: 400 }, (_, i) => mk(399 - i).map(String)) } }), { status: 200 });
    }) as unknown as typeof fetch;
    const bars = await fetchBars("BTCUSDT", 400, fetchFn);
    expect(calls[0]).toContain("fapi.binance.com");
    expect(calls.some((c) => c.includes("api.bybit.com"))).toBe(true);
    expect(bars).toHaveLength(400);
    expect(bars[0].t).toBeLessThan(bars[399].t);
  });

  it("avisa claro si ningún proveedor responde", async () => {
    const fetchFn = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchBars("BTCUSDT", 400, fetchFn)).rejects.toThrow("BTCUSDT");
  });
});

describe("sin ventaja inventada", () => {
  // Control contra errores que "adivinen el futuro": en un mercado al azar (sin tendencia real) la estrategia
  // NO puede ganar; con el costo de ida y vuelta tiene que dar un promedio igual o menor a cero.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

  it("en un mercado al azar el promedio por operación no es positivo", () => {
    const all: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      let p = 100;
      const bars: Bar[] = [];
      for (let i = 0; i < 4000; i++) {
        const o = p;
        let c = o, h = o, l = o;
        for (let k = 0; k < 4; k++) {
          c *= 1 + gauss(r) * 0.004;
          h = Math.max(h, c);
          l = Math.min(l, c);
        }
        bars.push({ t: T0 + i * BAR_MS, o, h, l, c });
        p = c;
      }
      all.push(...backtest(bars).trades.map((t) => t.r));
    }
    const s = botStats(all);
    expect(s.n).toBeGreaterThan(1500);
    expect(s.expectancy).toBeLessThan(0.02);
  });
});

describe("reglas elegidas por la persona", () => {
  it("se queda solo con reglas bien formadas", () => {
    const raw = [
      { op: "skip", dim: "symbol", key: "ETHUSDT" },
      { op: "skip", dim: "symbol", key: "DOGEUSDT" }, // activo que el bot no opera
      { op: "only", dim: "weekday", key: "3" },
      { op: "only", dim: "weekday", key: "9" }, // día inexistente
      { op: "skip", dim: "hour", key: "7" },
      { op: "only", dim: "direction", key: "LONG" },
      { op: "maxPerDay", n: 3 },
      { op: "maxPerDay", n: 0 },
      { op: "stopAfterLosses", n: 2.5 },
      { op: "rm", dim: "symbol", key: "BTCUSDT" },
      "basura",
      null,
    ];
    expect(cleanActions(raw)).toEqual([
      { op: "skip", dim: "symbol", key: "ETHUSDT" },
      { op: "only", dim: "weekday", key: "3" },
      { op: "skip", dim: "hour", key: "7" },
      { op: "only", dim: "direction", key: "LONG" },
      { op: "maxPerDay", n: 3 },
    ]);
    expect(cleanActions("x")).toEqual([]);
    expect(cleanActions(Array.from({ length: 50 }, () => ({ op: "maxPerDay", n: 3 })))).toHaveLength(20);
  });

  it("día y franja horaria según la zona horaria de la persona", () => {
    // miércoles 2026-01-07 02:30 UTC = martes 23:30 en Buenos Aires (UTC−3)
    const ms = Date.UTC(2026, 0, 7, 2, 30);
    expect(localParts(ms, "UTC")).toEqual({ weekday: 3, block: 0 });
    expect(localParts(ms, "America/Argentina/Buenos_Aires")).toEqual({ weekday: 2, block: 7 });
    expect(localParts(ms, "no-existe")).toEqual({ weekday: 3, block: 0 }); // zona inválida: UTC
    expect(localParts(ms, null)).toEqual({ weekday: 3, block: 0 });
  });

  it("«no operar» bloquea y «solo operar» limita", () => {
    const ctx = { symbol: "BTCUSDT", direction: "LONG", weekday: 3, block: 4 };
    expect(allowedByActions([], ctx)).toBe(true);
    expect(allowedByActions([{ op: "skip", dim: "symbol", key: "BTCUSDT" }], ctx)).toBe(false);
    expect(allowedByActions([{ op: "skip", dim: "symbol", key: "ETHUSDT" }], ctx)).toBe(true);
    expect(allowedByActions([{ op: "only", dim: "symbol", key: "ETHUSDT" }], ctx)).toBe(false);
    expect(allowedByActions([{ op: "only", dim: "symbol", key: "ETHUSDT" }, { op: "only", dim: "symbol", key: "BTCUSDT" }], ctx)).toBe(true);
    expect(allowedByActions([{ op: "skip", dim: "weekday", key: "3" }], ctx)).toBe(false);
    expect(allowedByActions([{ op: "only", dim: "hour", key: "4" }], ctx)).toBe(true);
    expect(allowedByActions([{ op: "only", dim: "hour", key: "5" }], ctx)).toBe(false);
    expect(allowedByActions([{ op: "skip", dim: "direction", key: "LONG" }], ctx)).toBe(false);
    expect(allowedByActions([{ op: "maxPerDay", n: 3 }], ctx)).toBe(true); // esos topes se controlan aparte
  });

  it("topes: usa el más estricto", () => {
    expect(capOf([{ op: "maxPerDay", n: 5 }, { op: "maxPerDay", n: 2 }], "maxPerDay")).toBe(2);
    expect(capOf([], "stopAfterLosses")).toBeNull();
  });
});

describe("simulación del bot completo", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  /** Mercado con tendencias que cambian de signo: genera muchas señales. */
  function market(seed: number, n = 3000): Bar[] {
    const r = rng(seed);
    let p = 100, drift = 0.0008;
    const bars: Bar[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 400 === 0) drift = -drift * (r() > 0.4 ? 1 : -1);
      const o = p;
      let c = o, h = o, l = o;
      for (let k = 0; k < 4; k++) {
        c *= 1 + drift / 4 + gauss(r) * 0.004;
        h = Math.max(h, c);
        l = Math.min(l, c);
      }
      bars.push({ t: T0 + i * BAR_MS, o, h, l, c });
      p = c;
    }
    return bars;
  }
  const data = { BTCUSDT: market(7), ETHUSDT: market(11) };
  const free = { symbols: ["BTCUSDT", "ETHUSDT"], maxOpen: 10, dailyLossR: 20, rules: [], timeZone: "UTC" };

  it("con un solo activo y sin límites da lo mismo que la prueba simple", () => {
    const one = simulate({ BTCUSDT: data.BTCUSDT }, { ...free, symbols: ["BTCUSDT"] });
    const plain = backtest(data.BTCUSDT);
    expect(one.trades.length).toBeGreaterThan(20);
    expect(one.trades.map((t) => t.t)).toEqual(plain.trades.map((t) => t.t));
    expect(one.trades.map((t) => +t.r.toFixed(9))).toEqual(plain.trades.map((t) => +t.r.toFixed(9)));
  });

  it("una regla «no operar» saca ese activo por completo", () => {
    const r = simulate(data, { ...free, rules: [{ op: "skip", dim: "symbol", key: "ETHUSDT" }] });
    expect(r.trades.length).toBeGreaterThan(10);
    expect(r.trades.every((t) => t.symbol === "BTCUSDT")).toBe(true);
  });

  it("«solo compras» no deja ninguna venta", () => {
    const r = simulate(data, { ...free, rules: [{ op: "only", dim: "direction", key: "LONG" }] });
    expect(r.trades.length).toBeGreaterThan(5);
    expect(r.trades.every((t) => t.direction === "LONG")).toBe(true);
  });

  it("un día de la semana vetado nunca abre operaciones ese día (en la zona de la persona)", () => {
    const tz = "America/Argentina/Buenos_Aires";
    const r = simulate(data, { ...free, timeZone: tz, rules: [{ op: "skip", dim: "weekday", key: "1" }] });
    expect(r.trades.length).toBeGreaterThan(10);
    for (const t of r.trades) expect(localParts(t.t + BAR_MS, tz).weekday).not.toBe(1);
  });

  it("el máximo de operaciones abiertas a la vez se respeta", () => {
    const r = simulate(data, { ...free, maxOpen: 1 });
    const sorted = [...r.trades].sort((a, b) => a.t - b.t);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].t + BAR_MS).toBeGreaterThanOrEqual(sorted[i - 1].closedAt);
  });

  it("el tope por día limita las aperturas en 24 h", () => {
    const r = simulate(data, { ...free, rules: [{ op: "maxPerDay", n: 1 }] });
    const opens = r.trades.map((t) => t.t + BAR_MS).sort((a, b) => a - b);
    for (let i = 1; i < opens.length; i++) expect(opens[i] - opens[i - 1]).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < opens.length; i++) expect(opens.filter((x) => x > opens[i] - 24 * 3_600_000 && x <= opens[i]).length).toBeLessThanOrEqual(1);
  });

  it("las reglas no pueden inventar más operaciones que sin reglas en la primera señal posible", () => {
    const base = simulate(data, free);
    const strict = simulate(data, { ...free, rules: [{ op: "only", dim: "symbol", key: "BTCUSDT" }, { op: "maxPerDay", n: 1 }] });
    expect(strict.trades.length).toBeLessThan(base.trades.length);
  });
});

describe("perfiles de estrategia", () => {
  it("hay cuatro perfiles distintos y el equilibrado es el de siempre", () => {
    expect(BOT_PROFILE_IDS).toEqual(["conservative", "balanced", "dynamic", "slow"]);
    expect(BOT_PROFILES.balanced).toEqual(DEFAULT_PARAMS);
    const keys = BOT_PROFILE_IDS.map((id) => JSON.stringify(BOT_PROFILES[id]));
    expect(new Set(keys).size).toBe(4);
  });

  it("el perfil lento es el equilibrado con velas de 4 horas", () => {
    expect(BOT_PROFILES.slow).toEqual({ ...BOT_PROFILES.balanced, tf: "4h" });
    expect(isProfileId("slow")).toBe(true);
    expect(paramsOf("slow").tf).toBe("4h");
    expect(describeParams(BOT_PROFILES.slow)).toContain("velas de 4 horas");
  });

  it("un perfil desconocido cae en el equilibrado", () => {
    expect(isProfileId("dynamic")).toBe(true);
    expect(isProfileId("agresivo")).toBe(false);
    expect(paramsOf("agresivo")).toEqual(DEFAULT_PARAMS);
    expect(paramsOf(undefined)).toEqual(DEFAULT_PARAMS);
    expect(paramsOf("conservative").lookback).toBe(40);
  });

  it("todos los perfiles son coherentes: el dinámico da más señales que el conservador", () => {
    const counts = Object.fromEntries(
      BOT_PROFILE_IDS.map((id) => {
        let n = 0;
        for (let seed = 1; seed <= 6; seed++) {
          let s = seed >>> 0;
          const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
          let p = 100;
          const bars: Bar[] = [];
          for (let i = 0; i < 3000; i++) {
            const o = p;
            let c = o, h = o, l = o;
            for (let k = 0; k < 4; k++) {
              c *= 1 + 0.0004 + Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()) * 0.004;
              h = Math.max(h, c);
              l = Math.min(l, c);
            }
            bars.push({ t: T0 + i * BAR_MS, o, h, l, c });
            p = c;
          }
          n += backtest(bars, BOT_PROFILES[id]).trades.length;
        }
        return [id, n];
      }),
    );
    expect(counts.dynamic).toBeGreaterThan(counts.balanced);
    expect(counts.balanced).toBeGreaterThan(counts.conservative);
  });

  it("describe la estrategia con sus números", () => {
    expect(describeParams(BOT_PROFILES.balanced)).toBe("ruptura de 20 velas a favor de la tendencia (EMA 50/200) · stop 1,5 ATR · objetivo 2R");
    expect(describeParams(BOT_PROFILES.dynamic)).toContain("ruptura de 10 velas");
  });
});

describe("velas de 4 horas y laboratorio", () => {
  it("pide velas de 4 horas a Binance y, si falla, a Bybit (interval 240)", async () => {
    const mk = (i: number) => [T0 + i * 4 * BAR_MS, "1", "2", "0.5", "1.5", "10"];
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.includes("binance")) return new Response("blocked", { status: 451 });
      return new Response(JSON.stringify({ result: { list: Array.from({ length: 400 }, (_, i) => mk(399 - i).map(String)) } }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchBars("BTCUSDT", 400, fetchFn, "4h");
    expect(calls[0]).toContain("interval=4h");
    expect(calls.find((c) => c.includes("bybit"))).toContain("interval=240");
    // sin indicar, sigue siendo 1 hora
    calls.length = 0;
    await fetchBars("BTCUSDT", 400, fetchFn);
    expect(calls[0]).toContain("interval=1h");
    expect(calls.find((c) => c.includes("bybit"))).toContain("interval=60");
  });

  it("una vela de 4 horas se considera cerrada recién a las 4 horas", () => {
    const bars = [bar(0, 1, 1, 1, 1)];
    const now = T0 + 2 * BAR_MS;
    expect(closedBars(bars, now)).toHaveLength(1);
    expect(closedBars(bars, now, barMsOf({ tf: "4h" }))).toHaveLength(0);
    expect(barMsOf({})).toBe(BAR_MS);
  });

  it("la nota de la operación dice cuando son velas de 4 horas", () => {
    expect(describeParams({ ...BOT_PROFILES.balanced, tf: "4h" })).toContain("ruptura de 20 velas de 4 horas");
    expect(describeParams(BOT_PROFILES.balanced)).not.toContain("4 horas");
  });

  function market4h(seed: number, n = 2600): Bar[] {
    let s = seed >>> 0;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let p = 100, drift = 0.002;
    const out: Bar[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 300 === 0) drift = -drift * (r() > 0.4 ? 1 : -1);
      const o = p;
      let c = o, h = o, l = o;
      for (let k = 0; k < 4; k++) {
        c *= 1 + drift / 4 + (r() - 0.5) * 0.012;
        h = Math.max(h, c);
        l = Math.min(l, c);
      }
      out.push({ t: T0 + i * 4 * BAR_MS, o, h, l, c });
      p = c;
    }
    return out;
  }

  it("la simulación con velas de 4 horas cierra siempre en un cierre de vela de 4 horas", () => {
    const bars = market4h(5);
    const r = simulate({ BTCUSDT: bars }, { symbols: ["BTCUSDT"], maxOpen: 3, dailyLossR: 20, rules: [], timeZone: "UTC" }, { ...BOT_PROFILES.balanced, tf: "4h" });
    expect(r.trades.length).toBeGreaterThan(5);
    for (const t of r.trades) expect((t.closedAt - T0) % (4 * BAR_MS)).toBe(0);
  });

  it("el laboratorio devuelve las variantes y las dos mitades suman el total", () => {
    const four = market4h(9);
    const one = four.flatMap((b, i) => Array.from({ length: 4 }, (_, k) => ({ ...b, t: T0 + (i * 4 + k) * BAR_MS }))); // mismas velas, 4 veces más seguidas
    const mid = T0 + (2600 * 4 * BAR_MS) / 2;
    const rows = runLab((tf) => ({ BTCUSDT: tf === "4h" ? four : one }), { symbols: ["BTCUSDT"], maxOpen: 3, dailyLossR: 20, timeZone: "UTC" }, mid);
    expect(rows.map((x) => x.id)).toEqual(LAB_VARIANTS.map((x) => x.id));
    expect(rows.map((x) => x.tf)).toEqual(["1h", "4h", "4h", "4h", "4h", "15m", "15m"]);
    for (const x of rows) expect(x.first.n + x.second.n).toBe(x.whole.n);
    expect(rows.find((x) => x.id === "h4-balanced")!.whole.n).toBeGreaterThan(0);
    expect(LAB_DAYS).toBe(360);
  });

  it("cada variante se parte por la mitad de su propio período", () => {
    const four = market4h(9);
    const rows = runLab(() => ({ BTCUSDT: four }), { symbols: ["BTCUSDT"], maxOpen: 3, dailyLossR: 20, timeZone: "UTC" }, (tf) => (tf === "15m" ? T0 : T0 + 1e12));
    const m15 = rows.find((r) => r.id === "m15-balanced")!;
    expect(m15.first.n).toBe(0); // la mitad se puso antes de todo: nada cae en la primera
    expect(m15.whole.n).toBeGreaterThan(0);
    expect(m15.second.n).toBe(m15.whole.n);
  });

  it("las variantes de 4 horas no tocan los perfiles del bot", () => {
    expect(BOT_PROFILES.balanced.tf).toBeUndefined();
    expect(LAB_VARIANTS.find((x) => x.id === "h1-balanced")!.params).toEqual(BOT_PROFILES.balanced);
  });
});

describe("escaneo del mercado", () => {
  const tk = (rows: Array<[string, number]>) => rows.map(([symbol, v]) => ({ symbol, quoteVolume: String(v) }));

  const info = (extra: Array<Record<string, unknown>> = []) => ({
    symbols: [
      ...["BTCUSDT", "ETHUSDT", "SOLUSDT", "1000PEPEUSDT", "USDCUSDT", "TINYUSDT"].map((symbol) => ({ symbol, status: "TRADING", contractType: "PERPETUAL", underlyingType: "COIN" })),
      { symbol: "BTCUSDT_261225", status: "TRADING", contractType: "CURRENT_QUARTER", underlyingType: "COIN" },
      { symbol: "XAUUSDT", status: "TRADING", contractType: "PERPETUAL", underlyingType: "COMMODITY" },
      { symbol: "NVDAUSDT", status: "TRADING", contractType: "PERPETUAL", underlyingType: "COIN", underlyingSubType: ["TradFi"] },
      { symbol: "OLDUSDT", status: "SETTLING", contractType: "PERPETUAL", underlyingType: "COIN" },
      ...extra,
    ],
  });
  const routed = (rows: Array<[string, number]>, infoBody: unknown = info()) =>
    (async (url: string) => (url.includes("exchangeInfo") ? new Response(JSON.stringify(infoBody)) : new Response(JSON.stringify(tk(rows))))) as unknown as typeof fetch;

  it("arma la lista por volumen y deja afuera stablecoins, vencimientos, poco volumen y lo que no es cripto", async () => {
    const fetchFn = routed([["ETHUSDT", 5e9], ["BTCUSDT", 9e9], ["USDCUSDT", 8e9], ["BTCUSDT_261225", 7e9], ["TINYUSDT", 1e6], ["1000PEPEUSDT", 6e8], ["BTCBUSD", 9e9], ["SOLUSDT", 2e9], ["XAUUSDT", 9e9], ["NVDAUSDT", 9e9], ["CLUSDT", 9e9], ["OLDUSDT", 9e9]]);
    expect(await fetchUniverse(3, fetchFn)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(await fetchUniverse(20, fetchFn)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT", "1000PEPEUSDT"]);
  });

  it("aunque Binance no diga el tipo, los tickers de petróleo, oro y acciones quedan afuera", async () => {
    const fetchFn = routed([["BTCUSDT", 9e9], ["ETHUSDT", 8e9], ["SOLUSDT", 7e9], ["SOXLUSDT", 6e9], ["SPCXUSDT", 6e9]], { symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "SOXLUSDT", "SPCXUSDT"].map((symbol) => ({ symbol, status: "TRADING", contractType: "PERPETUAL" })) });
    expect(await fetchUniverse(20, fetchFn)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });

  it("si Binance falla usa Bybit, y si fallan los dos avisa", async () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ symbol: `C${i}USDT`, turnover24h: String(1e9 - i * 1e6) }));
    const ok = (async (url: string) => (url.includes("binance") ? new Response("no", { status: 451 }) : new Response(JSON.stringify({ result: { list } })))) as unknown as typeof fetch;
    expect((await fetchUniverse(5, ok))[0]).toBe("C0USDT");
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchUniverse(5, bad)).rejects.toThrow("lista de activos");
  });

  it("valida los tamaños del escaneo y los símbolos", () => {
    expect([0, 20, 40, 7, "20", null, undefined, 999].map(scanSizeOf)).toEqual([0, 20, 40, 0, 20, 0, 0, 0]);
    expect(isTradableSymbol("DOGEUSDT")).toBe(true);
    expect(isTradableSymbol("BTCUSDT_261225")).toBe(false);
    expect(isTradableSymbol("btcusdt")).toBe(false);
    expect(isTradableSymbol("'; drop--")).toBe(false);
  });

  it("mapPool nunca corre más pedidos a la vez que el límite y los completa todos", async () => {
    let running = 0, peak = 0, done = 0;
    await mapPool(Array.from({ length: 30 }, (_, i) => i), 8, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      done++;
    });
    expect(done).toBe(30);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("con lugar para una sola operación, la simulación elige la señal más fuerte", () => {
    // Dos activos con el mismo recorrido; en uno la ruptura final es mucho más grande.
    const mk = (jump: number): Bar[] => {
      const bars: Bar[] = [];
      let p = 100;
      for (let i = 0; i < 300; i++) {
        const c = p + 0.1 + Math.sin(i / 3) * 0.08;
        bars.push({ t: T0 + i * BAR_MS, o: p, h: Math.max(p, c) + 0.3, l: Math.min(p, c) - 0.3, c });
        p = c;
      }
      const l = bars[bars.length - 1];
      bars[bars.length - 1] = { ...l, h: l.c + jump + 0.2, c: l.c + jump };
      bars.push({ t: T0 + 300 * BAR_MS, o: bars[299].c, h: bars[299].c + 30, l: bars[299].c - 0.1, c: bars[299].c + 20 }); // la vela siguiente toca el objetivo y cierra la operación
      return bars;
    };
    const data = { AAAUSDT: mk(1.5), BBBUSDT: mk(6) };
    const r = simulate(data, { symbols: ["AAAUSDT", "BBBUSDT"], maxOpen: 1, dailyLossR: 20, rules: [], timeZone: "UTC" });
    const first = [...r.trades].sort((a, b) => a.t - b.t).find((t) => t.t === T0 + 299 * BAR_MS);
    expect(first?.symbol).toBe("BBBUSDT");
  });
});

describe("variantes de 15 minutos", () => {
  it("la vela de 15 minutos dura un cuarto de hora y no es un perfil del bot", () => {
    expect(barMsOf({ tf: "15m" })).toBe(BAR_MS / 4);
    expect(barMsOf({ tf: "4h" })).toBe(4 * BAR_MS);
    expect(barMsOf({})).toBe(BAR_MS);
    expect(LAB_VARIANTS.filter((v) => v.params.tf === "15m").map((v) => v.id)).toEqual(["m15-balanced", "m15-wide"]);
    for (const id of BOT_PROFILE_IDS) expect(BOT_PROFILES[id].tf).not.toBe("15m");
  });
});

describe("costo de las pruebas con historial", () => {
  it("usa el costo real de Bitunix (0,12 % ida y vuelta de comisión + deslizamiento) en todos los perfiles y variantes", async () => {
    const m = await import("../supabase/functions/_shared/botStrategy");
    expect(m.ROUND_TRIP_COST_PCT).toBeGreaterThanOrEqual(0.12);
    for (const p of Object.values(m.BOT_PROFILES)) expect(p.feePct).toBe(m.ROUND_TRIP_COST_PCT);
    for (const v of m.LAB_VARIANTS) expect(v.params.feePct).toBe(m.ROUND_TRIP_COST_PCT);
  });
});

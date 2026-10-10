import { describe, expect, it } from "vitest";
import { DEFAULT_UNLOCK, bigUnlockAhead, cleanUnlock, unlockNote } from "../supabase/functions/_shared/unlockFilter";
import type { UnlockEvent, UnlockSettings } from "../supabase/functions/_shared/unlockFilter";
import { BAR_MS, indicators, signalAt, signalWithUnlock, simulate } from "../supabase/functions/_shared/botStrategy";
import type { Bar } from "../supabase/functions/_shared/botStrategy";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1, 12);
const cfg = (over: Partial<UnlockSettings> = {}): UnlockSettings => ({ ...DEFAULT_UNLOCK, mode: "careful", ...over });
const ev = (days: number, pct = 5, symbol = "ARBUSDT"): UnlockEvent => ({ symbol, at: NOW + days * DAY, pct });

describe("ajustes del filtro", () => {
  it("de fábrica está apagado y los valores raros se corrigen", () => {
    expect(DEFAULT_UNLOCK.mode).toBe("off");
    expect(cleanUnlock(null)).toEqual(DEFAULT_UNLOCK);
    expect(cleanUnlock({ mode: "inventado", windowDays: "x", minPct: null })).toEqual({ mode: "off", windowDays: 7, minPct: 2 });
    expect(cleanUnlock({ mode: "aggressive", windowDays: 400, minPct: 0 })).toEqual({ mode: "aggressive", windowDays: 30, minPct: 0.1 });
    expect(cleanUnlock({ mode: "careful", windowDays: 3.6, minPct: 99 })).toEqual({ mode: "careful", windowDays: 4, minPct: 50 });
  });
});

describe("desbloqueo grande cercano", () => {
  it("elige el más próximo dentro de la ventana y del tamaño mínimo", () => {
    const list = [ev(9), ev(5, 1), ev(4), ev(2), ev(-1)];
    expect(bigUnlockAhead(list, "ARBUSDT", NOW, cfg())?.at).toBe(NOW + 2 * DAY);
    expect(bigUnlockAhead(list, "ARBUSDT", NOW, cfg({ windowDays: 1 }))).toBeNull();
    expect(bigUnlockAhead([ev(2, 1.9)], "ARBUSDT", NOW, cfg({ minPct: 2 }))).toBeNull();
    expect(bigUnlockAhead([ev(2, 2)], "ARBUSDT", NOW, cfg({ minPct: 2 }))).not.toBeNull();
  });
  it("compara los activos sin importar el sufijo y no mezcla otros activos", () => {
    expect(bigUnlockAhead([ev(2)], "ARBUSDT.P", NOW, cfg())).not.toBeNull();
    expect(bigUnlockAhead([ev(2)], "OPUSDT", NOW, cfg())).toBeNull();
  });
  it("apagado nunca devuelve nada", () => {
    expect(bigUnlockAhead([ev(1)], "ARBUSDT", NOW, cfg({ mode: "off" }))).toBeNull();
  });
  it("la nota de la operación no revela datos de la fuente", () => {
    expect(unlockNote(cfg({ mode: "aggressive" }), true)).toContain("agresivo");
    expect(unlockNote(cfg(), false)).toContain("cuidadoso");
  });
});

// ─── La señal pasada por el filtro ──────────────────────────────────────────

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: Date.UTC(2026, 0, 1) + i * BAR_MS, o, h, l, c });

/** Tendencia bajista pareja y, al final, una vela que rompe el mínimo. */
function downtrendWithBreakdown(n = 260): Bar[] {
  const bars: Bar[] = [];
  let p = 300;
  for (let i = 0; i < n; i++) {
    const c = p - 0.1 + Math.sin(i / 3) * 0.08;
    bars.push(bar(i, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c));
    p = c;
  }
  const last = bars[bars.length - 1].c;
  bars.push(bar(n, last, last + 0.2, last - 5, last - 4.5));
  return bars;
}

/** Tendencia alcista pareja y, al final, una vela que rompe el máximo. */
function uptrendWithBreakout(n = 260): Bar[] {
  const bars: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const c = p + 0.1 + Math.sin(i / 3) * 0.08;
    bars.push(bar(i, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c));
    p = c;
  }
  const last = bars[bars.length - 1].c;
  bars.push(bar(n, last, last + 5, last - 0.2, last + 4.5));
  return bars;
}

describe("la señal con el filtro", () => {
  const near = [ev(2, 5, "ARBUSDT")];
  const far = [ev(20, 5, "ARBUSDT")];

  it("una compra se descarta ante un desbloqueo grande, pero pasa sin él", () => {
    const bars = uptrendWithBreakout();
    const ind = indicators(bars);
    const i = bars.length - 1;
    expect(signalAt(bars, ind, i)?.direction).toBe("LONG");
    for (const mode of ["careful", "aggressive"] as const) {
      expect(signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, near, cfg({ mode }))).toBeNull();
      expect(signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, far, cfg({ mode }))?.sig.direction).toBe("LONG");
    }
  });

  it("una venta pasa en los dos modos; en el agresivo se marca para ir primero", () => {
    const bars = downtrendWithBreakdown();
    const ind = indicators(bars);
    const i = bars.length - 1;
    expect(signalAt(bars, ind, i)?.direction).toBe("SHORT");
    const careful = signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, near, cfg({ mode: "careful" }));
    const aggressive = signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, near, cfg({ mode: "aggressive" }));
    expect(careful).toMatchObject({ nearUnlock: true, boosted: false });
    expect(aggressive).toMatchObject({ nearUnlock: true, boosted: true });
    expect(signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, far, cfg({ mode: "aggressive" }))).toMatchObject({ nearUnlock: false, boosted: false });
  });

  it("agresivo relaja la tendencia: acepta una ruptura bajista cuando la media rápida todavía no cruzó", () => {
    // Tendencia alcista que se da vuelta de golpe: la media rápida sigue por encima de la lenta pero el precio rompe hacia abajo.
    const bars: Bar[] = [];
    let p = 100;
    for (let i = 0; i < 250; i++) {
      const c = p + 0.1;
      bars.push(bar(i, p, c + 0.2, p - 0.2, c));
      p = c;
    }
    // cae por debajo de la media lenta (EMA 200) rompiendo el mínimo
    const last = bars[bars.length - 1].c;
    const lowBefore = Math.min(...bars.slice(-20).map((b) => b.l));
    bars.push(bar(250, last, last + 0.1, 40, 50));
    const ind = indicators(bars);
    const i = bars.length - 1;
    expect(lowBefore).toBeGreaterThan(50);
    expect(signalAt(bars, ind, i)).toBeNull(); // estricto: la rápida (EMA 50) todavía está arriba de la lenta
    expect(signalAt(bars, ind, i, undefined, { relaxShort: true })?.direction).toBe("SHORT");
    expect(signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, near, cfg({ mode: "careful" }))).toBeNull();
    expect(signalWithUnlock(bars, ind, i, undefined as any, "ARBUSDT", NOW, near, cfg({ mode: "aggressive" }))?.boosted).toBe(true);
  });
});

describe("la prueba con historial usa el mismo filtro", () => {
  const T0 = Date.UTC(2026, 0, 1);
  /** Mercado con vaivenes pseudoaleatorios (siempre iguales). */
  function market(seed: number): Bar[] {
    let x = seed;
    const r = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5);
    const bars: Bar[] = [];
    let p = 100;
    for (let i = 0; i < 2500; i++) {
      const o = p;
      let c = o, h = o, l = o;
      for (let k = 0; k < 4; k++) {
        c *= 1 + 0.0002 * Math.sin(i / 200) + r() * 0.01;
        h = Math.max(h, c);
        l = Math.min(l, c);
      }
      bars.push({ t: T0 + i * BAR_MS, o, h, l, c });
      p = c;
    }
    return bars;
  }
  const data = { ARBUSDT: market(5), OPUSDT: market(9) };
  const base = { symbols: ["ARBUSDT", "OPUSDT"], maxOpen: 10, dailyLossR: 50, rules: [], timeZone: "UTC" };
  // un desbloqueo grande cada 5 días en ARB
  const events: UnlockEvent[] = Array.from({ length: 20 }, (_, k) => ({ symbol: "ARBUSDT", at: T0 + (4 + k * 5) * DAY, pct: 5 }));

  it("apagado da exactamente lo mismo que sin filtro", () => {
    const a = simulate(data, base);
    const b = simulate(data, { ...base, unlock: { cfg: cfg({ mode: "off" }), events } });
    expect(b.trades).toEqual(a.trades);
  });
  it("cuidadoso: no hay compras en ARB cerca de un desbloqueo, el resto igual", () => {
    const a = simulate(data, base);
    const c = simulate(data, { ...base, unlock: { cfg: cfg({ mode: "careful", windowDays: 3 }), events } });
    expect(c.trades.length).toBeLessThan(a.trades.length);
    const opened = (t: { symbol: string; t: number }) => t.t + BAR_MS;
    const bad = c.trades.filter((t) => t.symbol === "ARBUSDT" && t.direction === "LONG" && events.some((e) => e.at > opened(t) && e.at <= opened(t) + 3 * DAY));
    expect(bad).toEqual([]);
    expect(c.trades.filter((t) => t.symbol === "OPUSDT").length).toBeGreaterThan(0);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PER_DAY, MIN_CLOSED, buildPrompt, coachReport, computeFacts } from "../supabase/functions/_shared/coach";
import type { CoachTrade } from "../supabase/functions/_shared/coach";
import { db, resetDb } from "./helpers/fake-supabase";

const TZ = "America/Argentina/Buenos_Aires"; // UTC−3
const NOW = Date.UTC(2026, 9, 10, 15, 0); // sábado 10/10/2026 12:00 hora local
const H = 3_600_000;
/** Hora local (UTC−3) del día `day` de octubre. */
const at = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 9, day, hour + 3, min)).toISOString();

let n = 0;
const trade = (day: number, hour: number, outcome: "TP" | "SL", extra: Partial<CoachTrade> = {}, holdMin = 60): CoachTrade => {
  const open = at(day, hour);
  return {
    symbol: "BTCUSDT",
    direction: "LONG",
    entry: 100,
    tp: 102,
    sl: 99,
    date: open,
    outcome,
    exit: null,
    closed_at: new Date(new Date(open).getTime() + holdMin * 60_000).toISOString(),
    notes: null,
    tags: [],
    ...extra,
  };
};
const profile = { timezone: TZ, lang: "es" };

/** 12 operaciones repartidas en varios días, con una mezcla razonable. */
const base = (): CoachTrade[] => {
  const out: CoachTrade[] = [];
  for (let i = 0; i < 12; i++) out.push(trade(1 + (i % 6), 9 + (i % 4), i % 3 === 0 ? "SL" : "TP"));
  return out;
};

describe("hechos del coach", () => {
  it("con menos de 10 operaciones cerradas no hay informe", () => {
    expect(computeFacts(base().slice(0, MIN_CLOSED - 1), profile, NOW)).toBeNull();
    expect(computeFacts(base(), profile, NOW)).not.toBeNull();
  });

  it("las abiertas y las muy viejas no cuentan", () => {
    const viejas = Array.from({ length: 12 }, () => trade(1, 10, "TP", { date: at(-200, 10), closed_at: at(-200, 11) }));
    expect(computeFacts(viejas, profile, NOW)).toBeNull();
    const abiertas = [...base().slice(0, 9), { ...trade(5, 10, "TP"), outcome: "ABIERTA", closed_at: null }];
    expect(computeFacts(abiertas, profile, NOW)).toBeNull(); // 9 cerradas
  });

  it("calcula acierto, R neto, R medio y profit factor", () => {
    // 8 ganadas (+2R) y 4 perdidas (−1R) → R neto +12, acierto 67 %, PF 4
    const t = [...Array(8)].map((_, i) => trade(1 + (i % 5), 10, "TP")).concat([...Array(4)].map((_, i) => trade(1 + i, 14, "SL")));
    const f = computeFacts(t, profile, NOW)!;
    expect(f.closed).toBe(12);
    expect(f.winRate).toBe(67);
    expect(f.netR).toBe(12);
    expect(f.avgR).toBe(1);
    expect(f.profitFactor).toBe(4);
    expect(f.avgWinR).toBe(2);
    expect(f.avgLossR).toBe(-1);
    expect(f.plannedRR).toBe(2);
  });

  it("detecta el mejor y el peor activo (con al menos 3 operaciones cada uno)", () => {
    const t = [
      ...Array(4).fill(0).map((_, i) => trade(1 + i, 10, "TP", { symbol: "ETHUSDT" })),
      ...Array(4).fill(0).map((_, i) => trade(1 + i, 11, "SL", { symbol: "SOLUSDT" })),
      ...Array(4).fill(0).map((_, i) => trade(1 + i, 12, "TP", { symbol: "BTCUSDT" })),
      trade(6, 10, "SL", { symbol: "XRPUSDT" }), // una sola: no se usa
    ];
    const f = computeFacts(t, profile, NOW)!;
    expect(f.bySymbol.best?.name).toBe("ETHUSDT");
    expect(f.bySymbol.worst?.name).toBe("SOLUSDT");
    expect(f.bySymbol.worst?.avgR).toBe(-1);
  });

  it("el día de la semana y la franja salen de la hora local, no de UTC", () => {
    // 22:30 locales del jueves 8/10 = viernes 01:30 UTC
    const noche = Array.from({ length: 4 }, (_, i) => trade(8, 22, "SL", { date: at(8, 22, 30 + i) }));
    const resto = Array.from({ length: 8 }, (_, i) => trade(5 + (i % 3), 10, "TP", { symbol: "ETHUSDT" })); // lunes a miércoles, de mañana
    const f = computeFacts([...noche, ...resto], profile, NOW)!;
    expect(f.byWeekday.worst?.name).toBe("jueves");
    expect(f.byDayPart.worst?.name).toBe("noche (18-24)");
    expect(f.byDayPart.best?.name).toBe("mañana (6-12)");
  });

  it("mide qué pasa en las operaciones abiertas hasta 60 min después de una pérdida", () => {
    const t = [
      trade(2, 9, "SL", {}, 30), // pierde y cierra 9:30
      trade(2, 10, "SL", {}, 30), // abre 10:00, 30 min después → cuenta
      trade(3, 9, "TP"),
      trade(3, 12, "TP"),
      trade(4, 9, "TP"),
      trade(4, 12, "TP"),
      trade(5, 9, "TP"),
      trade(5, 12, "TP"),
      trade(6, 9, "TP"),
      trade(6, 12, "TP"),
    ];
    const f = computeFacts(t, profile, NOW)!;
    expect(f.afterLoss.n).toBe(1);
    expect(f.afterLoss.avgR).toBe(-1);
    expect(f.afterLoss.vsOverall).toBeLessThan(0);
  });

  it("cuenta los días con más operaciones que el límite propio", () => {
    const t = [
      ...Array(5).fill(0).map((_, i) => trade(2, 9 + i, i < 3 ? "SL" : "TP")), // 5 un mismo día
      ...[3, 4, 5, 6, 7, 8].map((d) => trade(d, 10, "TP")),
    ];
    const f = computeFacts(t, { ...profile, daily_trade_limit: 3 }, NOW)!;
    expect(f.heavyDays.days).toBe(1);
    expect(f.heavyDays.limit).toBe(3);
    expect(f.heavyDays.avgR).toBeCloseTo((-1 * 3 + 2 * 2) / 5, 1);
  });

  it("compara el resultado con y sin notas", () => {
    const t = [
      ...Array(6).fill(0).map((_, i) => trade(1 + (i % 5), 10, "TP", { notes: "seguí el plan" })),
      ...Array(6).fill(0).map((_, i) => trade(1 + (i % 5), 14, "SL")),
    ];
    const f = computeFacts(t, profile, NOW)!;
    expect(f.withNotes.pct).toBe(50);
    expect(f.withNotes.avgRWith).toBe(2);
    expect(f.withNotes.avgRWithout).toBe(-1);
  });
});

describe("mensaje para la IA", () => {
  const facts = computeFacts(base(), profile, NOW)!;
  it("incluye las reglas de no inventar cifras y de no dar consejos de inversión, y los hechos en JSON", () => {
    const { system, user } = buildPrompt(facts, "es");
    expect(system).toContain("SOLO los números de los hechos");
    expect(system).toContain("Nunca des señales");
    expect(user).toContain(`"closed":${facts.closed}`);
    expect(buildPrompt(facts, "en").system).toContain("Never give trade signals");
  });
});

describe("informe con caché y límites", () => {
  const calls: Array<{ system: string; user: string }> = [];
  let answer: string | null = "Informe de prueba";
  let fail = false;
  const deps = (hasKey = true) => ({
    supabase: undefined as any,
    hasKey,
    ask: async (system: string, user: string) => {
      calls.push({ system, user });
      if (fail) throw new Error("caído");
      return answer;
    },
  });
  let client: any;

  beforeEach(async () => {
    calls.length = 0;
    answer = "Informe de prueba";
    fail = false;
    n = 0;
    resetDb({
      profiles: [{ id: "u1", timezone: TZ, lang: "es" }],
      trades: base().map((t) => ({ ...t, user_id: "u1" })),
      coach_reports: [],
    });
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    client = createClient("x", "y");
  });
  const run = (hasKey = true, now = NOW) => coachReport({ ...deps(hasKey), supabase: client }, "u1", now);

  it("con pocas operaciones avisa cuántas faltan y no gasta una consulta", async () => {
    db.tables.trades.length = 5;
    const r = await run();
    expect(r).toMatchObject({ ok: false, reason: "not_enough_data", needed: MIN_CLOSED });
    expect(calls).toHaveLength(0);
  });

  it("sin clave de la IA lo dice y no llama", async () => {
    expect(await run(false)).toMatchObject({ ok: false, reason: "no_key" });
    expect(calls).toHaveLength(0);
  });

  it("arma el informe, lo guarda y lo reutiliza si el diario no cambió", async () => {
    const r1 = await run();
    expect(r1).toMatchObject({ ok: true, cached: false, text: "Informe de prueba" });
    expect(calls).toHaveLength(1);
    expect(db.tables.coach_reports).toHaveLength(1);
    const r2 = await run(true, NOW + H);
    expect(r2).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1); // no volvió a llamar
  });

  it("si el diario cambió, genera uno nuevo", async () => {
    await run();
    db.tables.trades.push({ ...trade(7, 10, "TP"), user_id: "u1" });
    const r = await run(true, NOW + H);
    expect(r).toMatchObject({ ok: true, cached: false });
    expect(calls).toHaveLength(2);
  });

  it("pasadas 6 horas genera uno nuevo aunque no haya cambios", async () => {
    await run();
    const r = await run(true, NOW + 7 * H);
    expect(r).toMatchObject({ ok: true, cached: false });
  });

  it(`límite de ${MAX_PER_DAY} informes por día`, async () => {
    for (let i = 0; i < MAX_PER_DAY; i++) {
      db.tables.trades.push({ ...trade(7, 10, "TP"), user_id: "u1" });
      expect(await run(true, NOW + i * 60_000)).toMatchObject({ ok: true, cached: false });
    }
    db.tables.trades.push({ ...trade(7, 11, "TP"), user_id: "u1" });
    const r = await run(true, NOW + 10 * 60_000);
    expect(r).toMatchObject({ ok: false, reason: "limit" });
    expect((r as any).text).toBe("Informe de prueba"); // devuelve el último
    expect(calls).toHaveLength(MAX_PER_DAY);
  });

  it("si la IA falla o se niega no guarda nada", async () => {
    fail = true;
    expect(await run()).toMatchObject({ ok: false, reason: "unavailable" });
    fail = false;
    answer = null;
    expect(await run()).toMatchObject({ ok: false, reason: "refused" });
    expect(db.tables.coach_reports).toHaveLength(0);
  });

  it("le manda a la IA solo datos calculados, no operaciones sueltas", async () => {
    await run();
    expect(calls[0].user).toContain('"closed":12');
    expect(calls[0].user).not.toContain("BTCUSDT\",\"direction"); // no se envía el diario crudo
    expect(calls[0].user).not.toContain("u1");
  });

  it("usa el idioma del perfil", async () => {
    db.tables.profiles[0].lang = "en";
    await run();
    expect(calls[0].system).toContain("discipline coach");
  });
});

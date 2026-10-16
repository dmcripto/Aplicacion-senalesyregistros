import { describe, expect, it } from "vitest";
import { BOT_MAX_PER_DAY, BOT_MIN_CLOSED, botCoachReport, buildBotPrompt, computeBotFacts, netUsdtOf, profileOf } from "../supabase/functions/_shared/botCoach";
import type { BotTrade } from "../supabase/functions/_shared/botCoach";
import { db, resetDb } from "./helpers/fake-supabase";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const H = 3_600_000;
const NOTE = "🤖 Bot simulado (perfil lento con objetivo amplio, velas de 4 horas) · ruptura de 30 velas";

const sim = (i: number, outcome: "TP" | "SL", over: Partial<BotTrade> = {}): BotTrade => ({
  symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 103, sl: 99, date: new Date(NOW - (i + 2) * H).toISOString(), outcome, exit: null,
  closed_at: new Date(NOW - (i + 1) * H).toISOString(), source: "bot", notes: NOTE, tags: ["Bot simulado"], ...over,
});
const real = (i: number, net: string, over: Partial<BotTrade> = {}): BotTrade => ({
  symbol: "TRUMPUSDT", direction: "SHORT", entry: 1.791, tp: 1.7557, sl: 1.8263, date: new Date(NOW - (i + 2) * H).toISOString(), outcome: "MANUAL", exit: 1.818,
  closed_at: new Date(NOW - (i + 1) * H).toISOString(), source: "bitunix", notes: `🤖 Bot real · Bitunix · resultado neto ${net} USDT`, tags: ["Bot real"], ...over,
});

describe("resumen del bot con IA: los números", () => {
  it("lee el perfil y el resultado neto de las notas", () => {
    expect(profileOf(NOTE)).toBe("lento con objetivo amplio");
    expect(profileOf("sin perfil")).toBeNull();
    expect(netUsdtOf("… resultado neto −0.11 USDT · …")).toBeCloseTo(-0.11);
    expect(netUsdtOf("… resultado neto +1.25 USDT")).toBeCloseTo(1.25);
    expect(netUsdtOf("nada")).toBeNull();
  });

  it("con pocas operaciones cerradas no hay resumen", () => {
    expect(computeBotFacts([sim(1, "TP"), sim(2, "SL")], NOW)).toBeNull();
  });

  it("separa perfil elegido, prueba paralela y corredor, y calcula R, aciertos y mejor activo", () => {
    const trades: BotTrade[] = [
      ...[1, 2, 3].map((i) => sim(i, "TP", { symbol: "ETHUSDT" })), // +3R cada una
      sim(4, "SL", { symbol: "ETHUSDT" }),
      sim(5, "SL", { symbol: "SOLUSDT" }),
      sim(6, "TP", { tags: ["Bot simulado", "Filtro 4h"] }),
      sim(7, "SL", { tags: ["Bot simulado", "Corredor"] }),
      sim(8, "TP", { closed_at: new Date(NOW - 30 * 24 * H).toISOString(), date: new Date(NOW - 31 * 24 * H).toISOString() }), // fuera de la semana
      sim(9, "TP", { outcome: "ABIERTA", closed_at: null }),
    ];
    const f = computeBotFacts(trades, NOW)!;
    expect(f.chosen).toEqual({ n: 5, wins: 3, winRate: 60, netR: 7, avgR: 1.4 });
    expect(f.filtered).toMatchObject({ n: 1, wins: 1, netR: 3 });
    expect(f.runner).toMatchObject({ n: 1, wins: 0, netR: -1 });
    expect(f.openBot).toBe(1);
    expect(f.profileName).toBe("lento con objetivo amplio");
    expect(f.bySymbol.best).toEqual({ symbol: "ETHUSDT", n: 4, avgR: 2 });
    expect(f.bySymbol.worst).toBeNull(); // SOL tiene una sola operación
  });

  it("compara cada operación real con su copia simulada y dice dónde difieren", () => {
    const t = (i: number, o: "TP" | "SL", sym: string) => sim(i, o, { symbol: sym, direction: "SHORT", tp: 97, sl: 101, date: new Date(NOW - (i + 2) * H).toISOString() });
    const trades: BotTrade[] = [
      t(1, "SL", "TRUMPUSDT"), real(1, "−0.11", { symbol: "TRUMPUSDT" }), // las dos perdieron
      t(2, "TP", "OPUSDT"), real(2, "−0.10", { symbol: "OPUSDT" }), // simulada ganó, real perdió
      t(3, "SL", "BATUSDT"), t(4, "SL", "AAAUSDT"),
    ];
    const f = computeBotFacts(trades, NOW)!;
    expect(f.real).toEqual({ n: 2, wins: 0, netUsdt: -0.21, open: 0 });
    expect(f.realVsSim).toEqual({ pairs: 2, same: 1, different: [{ symbol: "OPUSDT", real: "perdió", sim: "ganó" }] });
  });

  it("el mensaje para la IA prohíbe inventar cifras y dar consejos, y lleva los hechos", () => {
    const f = computeBotFacts([1, 2, 3, 4, 5].map((i) => sim(i, "TP")), NOW)!;
    const es = buildBotPrompt(f, "es");
    expect(es.system).toContain("SOLO los números");
    expect(es.system).toContain("consejos de inversión");
    expect(es.user).toContain('"chosen"');
    expect(buildBotPrompt(f, "en").system).toContain("ONLY the numbers");
  });
});

describe("resumen del bot con IA: caché, límites y errores", () => {
  const setup = (extra: Array<Record<string, unknown>> = []) => {
    resetDb({ profiles: [{ id: "u1", lang: "es" }], trades: [], bot_coach_reports: extra });
    for (let i = 1; i <= BOT_MIN_CLOSED; i++) db.tables.trades.push({ ...sim(i, "TP"), user_id: "u1", date: new Date(Date.now() - (i + 2) * H).toISOString(), closed_at: new Date(Date.now() - (i + 1) * H).toISOString() });
  };

  it("pide el resumen a la IA, lo guarda y la segunda vez (sin cambios) lo devuelve sin gastar otra consulta", async () => {
    setup();
    const { createClient } = await import("./helpers/fake-supabase");
    const supabase = createClient("x", "y");
    const calls: string[] = [];
    const deps = { supabase, hasKey: true, ask: async (_s: string, u: string) => { calls.push(u); return "Resumen de prueba."; } };
    const a = await botCoachReport(deps, "u1", Date.now());
    expect(a).toMatchObject({ ok: true, text: "Resumen de prueba.", cached: false });
    const b = await botCoachReport(deps, "u1", Date.now() + 1000);
    expect(b).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1);
  });

  it("sin clave, con límite diario o si la IA falla, responde sin romper", async () => {
    setup();
    const { createClient } = await import("./helpers/fake-supabase");
    const supabase = createClient("x", "y");
    expect(await botCoachReport({ supabase, hasKey: false, ask: async () => "x" }, "u1")).toEqual({ ok: false, reason: "no_key" });
    expect(await botCoachReport({ supabase, hasKey: true, ask: async () => { throw new Error("caído"); } }, "u1")).toEqual({ ok: false, reason: "unavailable" });
    expect(await botCoachReport({ supabase, hasKey: true, ask: async () => null }, "u1")).toEqual({ ok: false, reason: "refused" });
    // límite: dos resúmenes ya hechos hoy con datos distintos
    db.tables.bot_coach_reports = Array.from({ length: BOT_MAX_PER_DAY }, (_, i) => ({ id: `r${i}`, user_id: "u1", text: "viejo", closed_count: 99, created_at: new Date(Date.now() - (i + 1) * H).toISOString() }));
    const lim = await botCoachReport({ supabase, hasKey: true, ask: async () => "nuevo" }, "u1");
    expect(lim).toMatchObject({ ok: false, reason: "limit", text: "viejo" });
  });

  it("con pocos datos lo dice", async () => {
    resetDb({ profiles: [{ id: "u1" }], trades: [], bot_coach_reports: [] });
    const { createClient } = await import("./helpers/fake-supabase");
    const r = await botCoachReport({ supabase: createClient("x", "y"), hasKey: true, ask: async () => "x" }, "u1");
    expect(r).toMatchObject({ ok: false, reason: "not_enough_data", needed: BOT_MIN_CLOSED });
  });
});

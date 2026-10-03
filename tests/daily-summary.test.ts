import { beforeEach, describe, expect, it } from "vitest";
import { buildSummaryMessage, buildSummaryPush, isSummaryTime, localDay, sendDailySummaries, summarize } from "../supabase/functions/_shared/dailySummary";
import type { SumProfile, SumTrade } from "../supabase/functions/_shared/dailySummary";
import { db, resetDb } from "./helpers/fake-supabase";

const TZ = "America/Argentina/Buenos_Aires"; // UTC−3, sin horario de verano
// 2026-10-03 22:10 hora de Buenos Aires = 2026-10-04 01:10 UTC
const NOW = Date.UTC(2026, 9, 4, 1, 10);
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour + 3)).toISOString(); // hora local (UTC−3); day 1 = 1 de octubre, 0 = 30 de septiembre, −1 = 29 de septiembre

const tp = (open: string, close: string): SumTrade => ({ direction: "LONG", entry: 100, tp: 102, sl: 99, date: open, outcome: "TP", exit: null, closed_at: close }); // +2R
const sl = (open: string, close: string): SumTrade => ({ direction: "LONG", entry: 100, tp: 102, sl: 99, date: open, outcome: "SL", exit: null, closed_at: close }); // −1R
const open = (when: string): SumTrade => ({ direction: "LONG", entry: 100, tp: 102, sl: 99, date: when, outcome: "ABIERTA", exit: null, closed_at: null });
const profile: SumProfile = { timezone: TZ, lang: "es" };

describe("zona horaria", () => {
  it("el día se cuenta en la zona de la persona, no en UTC", () => {
    expect(localDay(NOW, TZ)).toBe("2026-10-03"); // en UTC ya es el 4
    expect(localDay(NOW, "UTC")).toBe("2026-10-04");
  });
  it("el resumen sale a partir de las 21:00 locales", () => {
    expect(isSummaryTime(NOW, TZ)).toBe(true); // 22:10
    expect(isSummaryTime(Date.UTC(2026, 9, 3, 23, 59), TZ)).toBe(false); // 20:59
    expect(isSummaryTime(Date.UTC(2026, 9, 4, 0, 0), TZ)).toBe(true); // 21:00
    expect(isSummaryTime(NOW, null)).toBe(false);
    expect(isSummaryTime(NOW, "Zona/Inventada")).toBe(false);
  });
});

describe("resumen del día", () => {
  it("cuenta cerradas, ganadas, perdidas y el R neto de hoy", () => {
    const s = summarize([tp(at(3, 10), at(3, 12)), sl(at(3, 13), at(3, 15)), tp(at(3, 16), at(3, 18)), open(at(3, 19))], profile, NOW)!;
    expect(s.closed).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.netR).toBeCloseTo(3);
    expect(s.stillOpen).toBe(1);
    expect(s.opened).toBe(4);
  });

  it("una operación cerrada ayer no cuenta como de hoy", () => {
    const s = summarize([tp(at(2, 10), at(2, 12)), open(at(3, 9))], profile, NOW)!;
    expect(s.closed).toBe(0);
    expect(s.netR).toBe(0);
    expect(s.opened).toBe(1);
  });

  it("una operación de las 22:00 locales (ya es el día siguiente en UTC) cuenta como de hoy", () => {
    const s = summarize([open(at(3, 22))], profile, NOW)!;
    expect(s.opened).toBe(1);
    expect(s.activeStreak).toBe(1);
  });

  it("sin zona horaria no hay resumen", () => {
    expect(summarize([], { timezone: null }, NOW)).toBeNull();
  });
});

describe("rachas", () => {
  it("racha de registro: días seguidos con actividad, se corta con un día vacío", () => {
    const trades = [tp(at(3, 10), at(3, 11)), tp(at(2, 10), at(2, 11)), tp(at(1, 10), at(1, 11)), tp(at(-1, 10), at(-1, 11))];
    const s = summarize(trades, profile, NOW)!;
    // actividad el 1, 2 y 3 de octubre; el 30 de septiembre no hubo (y el 29 sí) → racha 3
    expect(s.activeStreak).toBe(3);
  });

  it("racha en verde: solo cuentan los días que cerraron con R positivo", () => {
    const trades = [tp(at(3, 10), at(3, 11)), sl(at(2, 10), at(2, 11)), tp(at(2, 12), at(2, 13)), tp(at(1, 10), at(1, 11))];
    // hoy +2, ayer −1 +2 = +1, antes de ayer +2 → 3 días en verde
    expect(summarize(trades, profile, NOW)!.greenStreak).toBe(3);
    // si ayer termina en rojo, la racha es solo hoy
    const rojo = [tp(at(3, 10), at(3, 11)), sl(at(2, 10), at(2, 11)), tp(at(1, 10), at(1, 11))];
    expect(summarize(rojo, profile, NOW)!.greenStreak).toBe(1);
  });

  it("hoy en rojo corta la racha en verde", () => {
    expect(summarize([sl(at(3, 10), at(3, 11)), tp(at(2, 10), at(2, 11))], profile, NOW)!.greenStreak).toBe(0);
  });

  it("disciplina: sin límites cargados no hay racha", () => {
    expect(summarize([tp(at(3, 10), at(3, 11))], profile, NOW)!.disciplineStreak).toBeNull();
  });

  it("disciplina: los días sin operar no la cortan, romper un límite sí", () => {
    const p = { ...profile, daily_loss_limit: 3, daily_trade_limit: 3 };
    const trades = [
      tp(at(3, 10), at(3, 11)), // hoy: ok
      tp(at(1, 10), at(1, 11)), // el 2 no operó, el 1 ok
      sl(at(-1, 10), at(-1, 11)), sl(at(-1, 12), at(-1, 13)), sl(at(-1, 14), at(-1, 15)), // el 29/09: −3R = rompió el límite (el 30 no operó)
    ];
    expect(summarize(trades, p, NOW)!.disciplineStreak).toBe(2);
  });

  it("disciplina: más operaciones que el máximo del día rompen la racha", () => {
    const p = { ...profile, daily_trade_limit: 2 };
    const trades = [tp(at(3, 10), at(3, 11)), tp(at(2, 10), at(2, 11)), tp(at(2, 12), at(2, 13)), tp(at(2, 14), at(2, 15))];
    expect(summarize(trades, p, NOW)!.disciplineStreak).toBe(1); // ayer abrió 3 con máximo 2
  });
});

describe("mensaje", () => {
  const s = summarize([tp(at(3, 10), at(3, 11)), tp(at(2, 10), at(2, 11)), open(at(3, 12))], profile, NOW)!;

  it("en español muestra resultado, racha y cierre", () => {
    const m = buildSummaryMessage(s, profile, "es");
    expect(m).toContain("Resumen de hoy");
    expect(m).toContain("+2.0R");
    expect(m).toContain("Registrás hace <b>2 días</b> seguidos");
    expect(m).toContain("Siguen abiertas: 1");
  });

  it("en inglés usa los textos en inglés", () => {
    const m = buildSummaryMessage(s, { ...profile, lang: "en" }, "en");
    expect(m).toContain("Today's summary");
    expect(m).toContain("Logging for <b>2 days</b> in a row");
  });

  it("muestra el dinero si cargó capital y riesgo", () => {
    const m = buildSummaryMessage(s, { ...profile, capital: 1000, risk_pct: 1, currency: "USD" }, "es");
    expect(m).toContain("+$20.00"); // 2R × $10
  });

  it("no muestra rachas de un solo día", () => {
    const solo = summarize([tp(at(3, 10), at(3, 11))], profile, NOW)!;
    expect(buildSummaryMessage(solo, profile, "es")).not.toContain("seguidos");
  });

  it("la notificación es corta", () => {
    const p = buildSummaryPush(s, "es");
    expect(p.title).toContain("Resumen de hoy");
    expect(p.body).toContain("+2.0R");
    expect(p.body).toContain("2 días");
  });
});

describe("envío", () => {
  const sentTelegram: Array<{ chat: number; text: string }> = [];
  const sentPush: any[] = [];
  const deps = () => ({
    supabase: undefined as any,
    telegram: async (chat: number, text: string) => {
      sentTelegram.push({ chat, text });
      return { ok: true };
    },
    push: async (m: any[]) => {
      sentPush.push(...m);
    },
  });

  beforeEach(async () => {
    sentTelegram.length = 0;
    sentPush.length = 0;
    resetDb({
      profiles: [{ id: "u1", timezone: TZ, lang: "es", daily_summary: true }],
      telegram_links: [{ user_id: "u1", chat_id: 555 }],
      trades: [{ user_id: "u1", direction: "LONG", entry: 100, tp: 102, sl: 99, date: at(3, 10), outcome: "TP", exit: null, closed_at: at(3, 11) }],
      device_tokens: [{ user_id: "u1", expo_push_token: "ExponentPushToken[abc]" }],
    });
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    (deps as any).client = createClient("x", "y");
  });

  const run = async (now: number) => sendDailySummaries({ ...deps(), supabase: (deps as any).client }, now);

  it("manda el resumen por Telegram y como notificación, una sola vez por día", async () => {
    expect(await run(NOW)).toBe(1);
    expect(sentTelegram).toHaveLength(1);
    expect(sentTelegram[0].chat).toBe(555);
    expect(sentPush).toHaveLength(1);
    expect(db.tables.profiles[0].last_summary_date).toBe("2026-10-03");
    expect(await run(NOW + 600_000)).toBe(0); // 10 minutos después: no repite
    expect(sentTelegram).toHaveLength(1);
  });

  it("antes de las 21:00 locales no manda nada", async () => {
    expect(await run(Date.UTC(2026, 9, 3, 23, 0))).toBe(0); // 20:00
    expect(sentTelegram).toHaveLength(0);
  });

  it("respeta el interruptor apagado", async () => {
    db.tables.profiles[0].daily_summary = false;
    expect(await run(NOW)).toBe(0);
  });

  it("si hoy no hubo actividad no manda nada", async () => {
    db.tables.trades.length = 0;
    expect(await run(NOW)).toBe(0);
    expect(sentTelegram).toHaveLength(0);
    expect(db.tables.profiles[0].last_summary_date).toBe("2026-10-03"); // igual se marca para no revisar cada 10 minutos
  });

  it("sin zona horaria guardada no manda nada", async () => {
    db.tables.profiles[0].timezone = null;
    expect(await run(NOW)).toBe(0);
  });

  it("si Telegram dice que bloquearon al bot, borra la vinculación", async () => {
    const blocked = { ...deps(), telegram: async () => ({ ok: false, error_code: 403 }), supabase: (deps as any).client };
    await sendDailySummaries(blocked, NOW);
    expect(db.tables.telegram_links).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";
import {
  calcMessage, calcPosition, exposureNotice, fundingAlert, isWeeklyTime, levelsMessage, moveAlert, morningMessage, parseCalcArgs,
  parseSymbolList, postMarketAlerts, postMarketMorning, postWeeklyRanking, sendExposureNotice, streakMessage, streaks, trendOf,
  wantsSymbol, weekKey, weeklyMessage, weeklyRanking,
} from "../supabase/functions/_shared/communityTools";
import { castVote, parseVote, voteKeyboard } from "../supabase/functions/_shared/votes";

const T0 = Date.parse("2026-10-11T23:30:00Z"); // domingo
const closed = (symbol: string, outcome: "TP" | "SL", daysAgo: number, extra: object = {}) => ({
  symbol, direction: "LONG" as const, entry: 100, tp: 110, sl: 95, date: new Date(T0 - (daysAgo + 1) * 86_400_000).toISOString(),
  outcome, exit: null, closed_at: new Date(T0 - daysAgo * 86_400_000).toISOString(), ...extra,
});

describe("ranking semanal", () => {
  it("suma R, acierto, mejor y peor", () => {
    const w = weeklyRanking([closed("BTCUSDT", "TP", 1), closed("ETHUSDT", "SL", 2), closed("SOLUSDT", "TP", 3), closed("XRPUSDT", "TP", 20)], T0 - 7 * 86_400_000, T0 + 1)!;
    expect(w.closed).toBe(3);
    expect(w.winrate).toBe(67);
    expect(w.netR).toBeCloseTo(3, 5); // +2 −1 +2
    expect(w.best?.symbol).toBe("BTCUSDT");
    expect(w.worst?.symbol).toBe("ETHUSDT");
    expect(weeklyMessage(w, "es")).toContain("+3.0R");
    expect(weeklyMessage(null, "en")).toContain("No trades were closed");
  });
  it("sin cierres devuelve null; las abiertas no cuentan", () => {
    expect(weeklyRanking([], 0, T0)).toBeNull();
    expect(weeklyRanking([{ ...closed("BTCUSDT", "TP", 1), outcome: "ABIERTA", closed_at: null }], 0, T0)).toBeNull();
  });
  it("domingo desde las 20:00 y una marca por semana", () => {
    expect(isWeeklyTime(T0, "UTC")).toBe(true);
    expect(isWeeklyTime(Date.parse("2026-10-11T12:00:00Z"), "UTC")).toBe(false);
    expect(isWeeklyTime(Date.parse("2026-10-12T22:00:00Z"), "UTC")).toBe(false); // lunes
    expect(weekKey(T0, "UTC")).toBe(weekKey(Date.parse("2026-10-07T10:00:00Z"), "UTC"));
    expect(weekKey(T0, "UTC")).not.toBe(weekKey(Date.parse("2026-10-12T10:00:00Z"), "UTC"));
  });
});

describe("publicación programada", () => {
  const sends: Array<{ chat: number; html: string; thread: number | null }> = [];
  const send = async (chat: number, html: string, thread: number | null) => { sends.push({ chat, html, thread }); return { ok: true }; };
  beforeEach(() => {
    sends.length = 0;
    resetDb({
      profiles: [{ id: "u1", lang: "es", timezone: "UTC" }],
      telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100, thread_id: 7, news_enabled: true, news_thread_id: 9 }],
      economic_posts: [],
      trades: [{ id: "t1", user_id: "u1", ...closed("BTCUSDT", "TP", 1), source: null, notes: null }, { id: "t2", user_id: "u1", ...closed("ETHUSDT", "TP", 2), source: "bot", notes: null }],
    });
  });

  it("el domingo publica el ranking una sola vez, en el tema de señales, sin las del bot simulado", async () => {
    expect(await postWeeklyRanking({ supabase: createC(), send }, T0)).toBe(1);
    expect(await postWeeklyRanking({ supabase: createC(), send }, T0 + 60_000)).toBe(0);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ chat: -100, thread: 7 });
    expect(sends[0].html).toContain("Cerradas: <b>1</b>");
  });
  it("otro día no publica", async () => {
    expect(await postWeeklyRanking({ supabase: createC(), send }, Date.parse("2026-10-08T21:00:00Z"))).toBe(0);
  });
  it("si Telegram falla se reintenta (se libera la marca)", async () => {
    expect(await postWeeklyRanking({ supabase: createC(), send: async () => ({ ok: false, error_code: 500 }) }, T0)).toBe(0);
    expect(await postWeeklyRanking({ supabase: createC(), send }, T0)).toBe(1);
  });

  it("resumen de la mañana: una vez por día, en Noticias", async () => {
    vi.stubGlobal("fetch", async (url: any) => {
      const u = String(url);
      if (u.includes("premiumIndex")) return new Response(JSON.stringify({ lastFundingRate: "0.0001" }));
      return new Response(JSON.stringify({ lastPrice: "100", priceChangePercent: "1.5" }));
    });
    const now = Date.parse("2026-10-12T09:00:00Z");
    expect(await postMarketMorning({ supabase: createC(), send }, now)).toBe(1);
    expect(await postMarketMorning({ supabase: createC(), send }, now + 300_000)).toBe(0);
    expect(sends[0].thread).toBe(9);
    expect(sends[0].html).toContain("Mercado de la mañana");
    expect(sends[0].html).toContain("funding 0.010%");
    expect(await postMarketMorning({ supabase: createC(), send }, Date.parse("2026-10-13T03:00:00Z"))).toBe(0); // de madrugada no
  });

  it("avisos de funding extremo y de movimiento fuerte, sin repetirse", async () => {
    vi.stubGlobal("fetch", async (url: any) => {
      const u = String(url);
      if (u.includes("premiumIndex")) return new Response(JSON.stringify({ lastFundingRate: u.includes("BTCUSDT") ? "0.0015" : "0.0001" }));
      if (u.includes("klines")) return new Response(JSON.stringify([[0, "100", "0", "0", "100", "0"], [0, "100", "0", "0", u.includes("ETHUSDT") ? "94" : "101", "0"]]));
      return new Response("{}", { status: 404 });
    });
    expect(await postMarketAlerts({ supabase: createC(), send }, T0)).toBe(2);
    expect(sends.map((s) => s.html).join("\n")).toContain("Funding extremo");
    expect(sends.map((s) => s.html).join("\n")).toContain("Movimiento fuerte");
    expect(await postMarketAlerts({ supabase: createC(), send }, T0 + 60_000)).toBe(0);
  });
});

import { createClient } from "./helpers/fake-supabase";
function createC() { return createClient() as any; }

describe("/calc", () => {
  it("entiende los números y calcula tamaño, apalancamiento y R:R", () => {
    const i = parseCalcArgs(["BTC", "65000", "64500", "1000", "1%", "67000"])!;
    expect(i).toMatchObject({ entry: 65000, sl: 64500, capital: 1000, riskPct: 1, tp: 67000 });
    const c = calcPosition(i);
    expect(c.riskUsd).toBe(10);
    expect(c.qty).toBeCloseTo(0.02, 6);
    expect(c.notional).toBeCloseTo(1300, 4);
    expect(c.leverage).toBeCloseTo(1.3, 4);
    expect(c.direction).toBe("LONG");
    expect(c.rr).toBeCloseTo(4, 5);
    expect(calcMessage(i, "es")).toContain("Tamaño de la posición");
  });
  it("SHORT cuando el stop está arriba; usa los valores del perfil si faltan", () => {
    expect(calcPosition(parseCalcArgs(["100", "105", "500", "2"])!).direction).toBe("SHORT");
    expect(parseCalcArgs(["100", "95"], { capital: 1000, riskPct: 1 })).toMatchObject({ capital: 1000, riskPct: 1 });
  });
  it("rechaza datos incompletos o absurdos", () => {
    expect(parseCalcArgs(["100"])).toBeNull();
    expect(parseCalcArgs(["100", "100", "1000", "1"])).toBeNull();
    expect(parseCalcArgs(["100", "95"])).toBeNull(); // sin capital ni perfil
    expect(parseCalcArgs(["100", "95", "1000", "150"])).toBeNull();
  });
});

describe("/niveles y textos de mercado", () => {
  it("tendencia por medias", () => {
    expect(trendOf(110, 105, 100)).toBe("up");
    expect(trendOf(90, 95, 100)).toBe("down");
    expect(trendOf(100, 105, 95)).toBe("side");
    expect(trendOf(100, null, null)).toBeNull();
  });
  it("arma el mensaje con RSI y señales abiertas", () => {
    const html = levelsMessage({ symbol: "BTCUSDT", price: 65000, change: 1.2, rsi1h: 72, rsi4h: 28, ema20: 64000, ema50: 63000, open: [{ direction: "LONG", entry: 64500, tp: 66000, sl: 63800 }] }, "es");
    expect(html).toContain("BTC");
    expect(html).toContain("Alcista");
    expect(html).toContain("72 🔥");
    expect(html).toContain("28 🧊");
    expect(html).toContain("Señales abiertas");
  });
  it("mañana, funding y movimiento", () => {
    expect(morningMessage([], "es")).toBeNull();
    expect(morningMessage([{ symbol: "XAUUSDT", price: 2400, change: -0.5, funding: 0.0002 }], "en")).toContain("funding 0.020%");
    expect(fundingAlert("BTCUSDT", 0.0015, "es")).toContain("largos");
    expect(fundingAlert("BTCUSDT", -0.0015, "en")).toContain("shorts");
    expect(moveAlert("ETHUSDT", -6, 3000, "es")).toContain("6.0%");
  });
});

describe("rachas", () => {
  it("cuenta ganadoras seguidas y la mejor racha", () => {
    const s = streaks([closed("A", "SL", 6), closed("A", "TP", 5), closed("A", "TP", 4), closed("A", "TP", 3), closed("A", "SL", 2), closed("A", "TP", 1)]);
    expect(s).toMatchObject({ winStreak: 1, lossStreak: 0, bestWinStreak: 3, closed: 6 });
    expect(streakMessage(s, "es")).toContain("Mejor racha: <b>3</b>");
    const l = streaks([closed("A", "TP", 4), closed("A", "SL", 3), closed("A", "SL", 2), closed("A", "SL", 1)]);
    expect(l.lossStreak).toBe(3);
    expect(streakMessage(l, "es")).toContain("frená");
    expect(streakMessage(streaks([]), "es")).toContain("Todavía no");
  });
});

describe("votación", () => {
  beforeEach(() => resetDb({ signal_votes: [] }));
  it("botones y lectura del dato", () => {
    const k = voteKeyboard("abc12345-6789", { up: 3, down: 1 }, "es");
    expect(k.inline_keyboard[0][0]).toMatchObject({ text: "👍 La tomo · 3", callback_data: "v:u:abc12345-6789" });
    expect(parseVote("v:d:abc12345-6789")).toEqual({ kind: "d", tradeId: "abc12345-6789" });
    expect(parseVote("ok:123")).toBeNull();
    expect("v:u:".length + 36).toBeLessThan(64);
  });
  it("cuenta, cambia y quita el voto", async () => {
    const sb = createC();
    expect(await castVote(sb, "t1", 1, "u")).toEqual({ up: 1, down: 0 });
    expect(await castVote(sb, "t1", 2, "u")).toEqual({ up: 2, down: 0 });
    expect(await castVote(sb, "t1", 2, "d")).toEqual({ up: 1, down: 1 });
    expect(await castVote(sb, "t1", 1, "u")).toEqual({ up: 0, down: 1 }); // repetir lo quita
  });
});

describe("exposición", () => {
  it("avisa con muchas abiertas o con mucho riesgo sumado", () => {
    const six = Array.from({ length: 6 }, () => ({ direction: "LONG" }));
    expect(exposureNotice(six.slice(0, 2), null, "es")).toBeNull();
    expect(exposureNotice(six, null, "es")).toContain("6");
    expect(exposureNotice(six.slice(0, 4), 2, "es")).toContain("8.0%"); // 4 × 2 %
    expect(exposureNotice(six.slice(0, 3), 2, "es")).toBeNull(); // 6 % no supera el tope
    expect(exposureNotice(six, 1, "en")).toBeNull(); // 6 % exacto
    expect(exposureNotice(six, null, "en")).toContain("go the same way");
  });
  it("sendExposureNotice respeta el interruptor y manda a lo sumo uno por hora", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", async (_u: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true })); });
    (globalThis as any).Deno = { env: { get: (k: string) => (k === "TELEGRAM_BOT_TOKEN" ? "T" : undefined) } };
    resetDb({
      profiles: [{ id: "u1", lang: "es", risk_pct: 2, risk_reminder: true }],
      telegram_links: [{ user_id: "u1", chat_id: 555 }],
      economic_posts: [],
      trades: [1, 2, 3, 4].map((n) => ({ id: `t${n}`, user_id: "u1", outcome: "ABIERTA", direction: "LONG", source: null })).concat([{ id: "b", user_id: "u1", outcome: "ABIERTA", direction: "LONG", source: "bot" }]),
    });
    expect(await sendExposureNotice(createC(), "u1", T0)).toBe(true);
    expect(calls[0].text).toContain("8.0%"); // las del bot simulado no cuentan
    expect(await sendExposureNotice(createC(), "u1", T0 + 60_000)).toBe(false);
    db.tables.profiles[0].risk_reminder = false;
    expect(await sendExposureNotice(createC(), "u1", T0 + 7_200_000)).toBe(false);
  });
});

describe("filtro de activos", () => {
  it("entiende la lista", () => {
    expect(parseSymbolList("btc, ETH xau BTC")).toEqual(["BTCUSDT", "ETHUSDT", "XAUUSDT"]);
    expect(parseSymbolList("solusdt")).toEqual(["SOLUSDT"]);
    expect(parseSymbolList("!!! ???")).toEqual([]);
  });
  it("sin lista recibe todo; con lista, solo esos", () => {
    expect(wantsSymbol(null, "BTCUSDT")).toBe(true);
    expect(wantsSymbol("", "BTCUSDT")).toBe(true);
    expect(wantsSymbol("BTCUSDT,ETHUSDT", "BTCUSDT.P")).toBe(true);
    expect(wantsSymbol("BTCUSDT,ETHUSDT", "SOLUSDT")).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createClient, resetDb } from "./helpers/fake-supabase";
import { dueSessions, postSessionAlerts, sessionMessage, MARKET_SESSIONS, zonedMs } from "../supabase/functions/_shared/sessions";
import { chartSvg, chEma, normalizeInterval, normalizeSymbol, parseChartArgs } from "../supabase/functions/_shared/chartImage";
import type { Ohlc } from "../supabase/functions/_shared/chartImage";

const at = (iso: string) => Date.parse(iso);

describe("horarios de bolsas", () => {
  it("usa el horario de verano real: Nueva York abre 13:30 UTC en octubre y 14:30 UTC en invierno", () => {
    expect(zonedMs(2026, 10, 7, 9, 30, "America/New_York")).toBe(at("2026-10-07T13:30:00Z"));
    expect(zonedMs(2026, 12, 8, 9, 30, "America/New_York")).toBe(at("2026-12-08T14:30:00Z"));
    expect(zonedMs(2026, 10, 7, 9, 0, "Asia/Tokyo")).toBe(at("2026-10-07T00:00:00Z"));
  });

  it("coincide con los avisos que mostró la persona (hora Argentina): NY abre 10:30, Londres cierra 12:30, NY cierra 17:00, Tokio abre 21:00", () => {
    expect(dueSessions(at("2026-10-07T13:31:00Z")).map((d) => `${d.session.id} ${d.kind}`)).toEqual(["newyork open"]);
    expect(dueSessions(at("2026-10-07T15:31:00Z")).map((d) => `${d.session.id} ${d.kind}`)).toEqual(["london close"]);
    expect(dueSessions(at("2026-10-07T20:01:00Z")).map((d) => `${d.session.id} ${d.kind}`)).toEqual(["newyork close"]);
    expect(dueSessions(at("2026-10-08T00:01:00Z")).map((d) => `${d.session.id} ${d.kind}`)).toEqual(["tokyo open"]);
  });

  it("no avisa fines de semana ni mucho después de la hora", () => {
    expect(dueSessions(at("2026-10-10T13:31:00Z"))).toEqual([]); // sábado
    expect(dueSessions(at("2026-10-07T14:00:00Z"))).toEqual([]); // 30 min tarde
  });

  it("el mensaje lleva bandera y nombre en el idioma de la cuenta", () => {
    const ny = MARKET_SESSIONS.find((s) => s.id === "newyork")!;
    expect(sessionMessage(ny, "open", "es")).toBe("🔔 <i>Abre</i> 🇺🇸 <b>Nueva York</b>");
    expect(sessionMessage(ny, "close", "en")).toBe("🔕 <i>Closes</i> 🇺🇸 <b>New York</b>");
  });
});

describe("postSessionAlerts", () => {
  const supabase = createClient();
  let calls: Array<{ chat: number; html: string; thread: number | null }>;
  const send = async (chat: number, html: string, thread: number | null) => {
    calls.push({ chat, html, thread });
    return { ok: true };
  };
  beforeEach(() => {
    calls = [];
    resetDb({
      profiles: [{ id: "u1", lang: "es" }],
      telegram_communities: [
        { id: "c1", user_id: "u1", chat_id: -100, news_enabled: true, news_thread_id: 12 },
        { id: "c2", user_id: "u1", chat_id: -200, news_enabled: false, news_thread_id: null },
      ],
      economic_posts: [],
    });
  });

  it("publica en el tema de noticias, solo una vez y solo donde está activado", async () => {
    expect(await postSessionAlerts({ supabase, send }, at("2026-10-07T13:31:00Z"))).toBe(1);
    expect(await postSessionAlerts({ supabase, send }, at("2026-10-07T13:32:00Z"))).toBe(0);
    expect(calls).toEqual([{ chat: -100, html: "🔔 <i>Abre</i> 🇺🇸 <b>Nueva York</b>", thread: 12 }]);
  });
});

describe("comando /grafico", () => {
  it("entiende monedas e intervalos de varias formas", () => {
    expect(normalizeSymbol("btc")).toBe("BTCUSDT");
    expect(normalizeSymbol("BINANCE:ETHUSDT.P")).toBe("ETHUSDT");
    expect(normalizeSymbol("sol/usdt")).toBe("SOLUSDT");
    expect(normalizeInterval("4H")).toBe("4h");
    expect(normalizeInterval("D")).toBe("1d");
    expect(normalizeInterval("7m")).toBeNull();
    expect(parseChartArgs(["BTCUSDT", "4h"])).toEqual({ symbol: "BTCUSDT", interval: "4h", ema: false, liq: false });
    expect(parseChartArgs(["1d", "eth", "ema"])).toEqual({ symbol: "ETHUSDT", interval: "1d", ema: true, liq: false });
    expect(parseChartArgs(["sol"])).toEqual({ symbol: "SOLUSDT", interval: "1h", ema: false, liq: false });
    expect(parseChartArgs(["btc", "4h", "liq"])).toEqual({ symbol: "BTCUSDT", interval: "4h", ema: false, liq: true });
    expect(parseChartArgs([])).toBeNull();
  });

  it("dibuja velas, volumen y las dos EMA", () => {
    const bars: Ohlc[] = Array.from({ length: 60 }, (_, i) => ({ t: 1_700_000_000_000 + i * 3_600_000, o: 100 + i, h: 105 + i, l: 98 + i, c: 102 + i, v: 10 + i }));
    const svg = chartSvg({ symbol: "BTCUSDT", interval: "1h", ema: true, liq: false }, bars, "Binance", "es");
    expect(svg.match(/<rect /g)!.length).toBeGreaterThan(120);
    expect(svg).toContain("EMA 20");
    expect(svg).not.toContain("CH_");
    expect(svg).toMatch(/ H <tspan/);
    expect(svg).toContain("BTCUSDT");
    const withLiq = chartSvg({ symbol: "BTCUSDT", interval: "1h", ema: false, liq: true }, bars, "Binance", "es", [{ side: "long", price: 120, usd: 5e7, pct: -2 }, { side: "short", price: 9999, usd: 1e7, pct: 5 }]);
    expect(withLiq).toContain("Liq. largos $50.0M");
    expect(withLiq).not.toContain("Liq. cortos");
    expect(chEma([1, 2, 3], 2)).toHaveLength(3);
  });
});

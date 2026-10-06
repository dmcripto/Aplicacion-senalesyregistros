import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";
import { BAR_MS } from "../supabase/functions/_shared/botStrategy";

let handler: (req: Request) => Promise<Response>;
const SECRET = "secreto-de-segundo-plano-123";

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", EXCHANGE_CRON_SECRET: SECRET, TELEGRAM_BOT_TOKEN: "123:ABC" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/bot/index");
});

const hour = () => Math.floor(Date.now() / BAR_MS) * BAR_MS; // apertura de la vela en curso

/** Velas de 1 h que terminan con la vela en curso. Tendencia alcista con ruido; si `breakout`, la última CERRADA rompe el máximo. */
function series(n: number, breakout: boolean, opts: { formingHigh?: number } = {}) {
  const rows: number[][] = [];
  let p = 100;
  const start = hour() - (n - 1) * BAR_MS;
  for (let i = 0; i < n - 1; i++) {
    const c = p + 0.1 + Math.sin(i / 3) * 0.08;
    rows.push([start + i * BAR_MS, p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c]);
    p = c;
  }
  if (breakout) {
    const last = rows.length - 1;
    const prev = rows[last - 1][4];
    rows[last] = [rows[last][0], prev, prev + 5, prev - 0.2, prev + 4.5];
  }
  const c = rows[rows.length - 1][4];
  rows.push([hour(), c, opts.formingHigh ?? c + 0.1, c - 0.1, c]); // vela en curso
  return rows;
}

let klines: number[][] = [];
let tickers: Array<{ symbol: string; quoteVolume: string }> = [];
let sent: { telegram: any[]; push: any[] } = { telegram: [], push: [] };
beforeEach(() => {
  resetDb({ bot_settings: [], bot_signals: [], trades: [] });
  klines = series(285, true);
  tickers = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT", "USDCUSDT", "BTCUSDT_261225", "TINYUSDT"].map((symbol, i) => ({ symbol, quoteVolume: String(symbol === "TINYUSDT" ? 1e6 : 9e9 - i * 1e8) }));
  sent = { telegram: [], push: [] };
  vi.stubGlobal("fetch", async (url: any, init?: any) => {
    const u = new URL(String(url));
    if (u.hostname === "api.telegram.org") {
      sent.telegram.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ ok: true }));
    }
    if (u.hostname === "exp.host") {
      sent.push.push(...JSON.parse(String(init?.body ?? "[]")));
      return new Response("{}");
    }
    if (u.hostname === "fapi.binance.com" && u.pathname.endsWith("/ticker/24hr")) return new Response(JSON.stringify(tickers));
    if (u.hostname === "fapi.binance.com") return new Response(JSON.stringify(klines.map((r) => [...r.map(String), "0"])));
    return new Response("{}", { status: 404 });
  });
});

const tick = () => handler(new Request("http://x/functions/v1/bot", { method: "POST", headers: { "x-cron-secret": SECRET }, body: "{}" })).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
const enable = (over: Record<string, unknown> = {}) => db.tables.bot_settings.push({ user_id: "u1", enabled: true, symbols: ["BTCUSDT"], max_open: 3, daily_loss_r: 3, ...over });

describe("función bot · corrida periódica", () => {
  it("rechaza pedidos sin el secreto", async () => {
    const bad = await handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "otro" }, body: "{}" }));
    expect(bad.status).toBe(401);
  });

  it("anota una operación simulada cuando la última vela cerrada rompe a favor de la tendencia", async () => {
    enable();
    const r = await tick();
    expect(r.body.opened).toBe(1);
    const t = db.tables.trades[0];
    expect(t).toMatchObject({ user_id: "u1", symbol: "BTCUSDT", direction: "LONG", source: "bot", tags: ["Bot simulado"] });
    expect(t.sl).toBeLessThan(t.entry);
    expect(t.tp).toBeGreaterThan(t.entry);
    expect(t.notes).toContain("No se operó en ningún exchange");
    expect(db.tables.bot_signals).toHaveLength(1);
    expect(db.tables.bot_signals[0].trade_id).toBe(t.id);
  });

  it("no duplica la operación si la corrida se repite", async () => {
    enable();
    await tick();
    await tick();
    expect(db.tables.trades).toHaveLength(1);
    expect(db.tables.bot_signals).toHaveLength(1);
  });

  it("con el bot apagado no hace nada", async () => {
    enable({ enabled: false });
    const r = await tick();
    expect(r.body.opened).toBe(0);
    expect(db.tables.trades).toHaveLength(0);
  });

  it("no anota si no hubo señal", async () => {
    klines = series(285, false);
    enable();
    expect((await tick()).body.opened).toBe(0);
  });

  it("respeta el máximo de operaciones abiertas", async () => {
    enable({ max_open: 1 });
    db.tables.trades.push({ id: "x", user_id: "u1", symbol: "ETHUSDT", source: "bot", outcome: "ABIERTA", direction: "LONG", entry: 1, sl: 0.9, tp: 1.2 });
    const r = await tick();
    expect(r.body.opened).toBe(0);
  });

  it("no abre otra operación del mismo activo mientras haya una abierta", async () => {
    enable();
    db.tables.trades.push({ id: "x", user_id: "u1", symbol: "BTCUSDT", source: "bot", outcome: "ABIERTA", direction: "LONG", entry: 1, sl: 0.9, tp: 1.2 });
    expect((await tick()).body.opened).toBe(0);
  });

  it("frena por hoy si se alcanzó la pérdida máxima diaria", async () => {
    enable({ daily_loss_r: 2 });
    const now = new Date().toISOString();
    for (let i = 0; i < 2; i++) db.tables.trades.push({ id: `l${i}`, user_id: "u1", symbol: "SOLUSDT", source: "bot", outcome: "SL", entry: 10, sl: 9, tp: 12, closed_at: now });
    expect((await tick()).body.opened).toBe(0);
  });

  it("cierra la operación simulada cuando una vela posterior toca el objetivo", async () => {
    // una operación abierta hace 3 velas cuyo objetivo se alcanza en una vela posterior
    const rows = series(285, false);
    const signalT = rows[rows.length - 5][0];
    const entry = rows[rows.length - 5][4];
    rows[rows.length - 2] = [rows[rows.length - 2][0], entry, entry + 3, entry - 0.1, entry + 2.5]; // toca tp = entry + 2
    klines = rows;
    db.tables.trades.push({ id: "t1", user_id: "u1", symbol: "BTCUSDT", source: "bot", outcome: "ABIERTA", direction: "LONG", entry, sl: entry - 1, tp: entry + 2 });
    db.tables.bot_signals.push({ id: "s1", user_id: "u1", symbol: "BTCUSDT", candle_time: new Date(signalT).toISOString(), trade_id: "t1" });
    const r = await tick();
    expect(r.body.closed).toBe(1);
    expect(db.tables.trades.find((t) => t.id === "t1")).toMatchObject({ outcome: "TP", auto_closed: true });
  });

  it("sigue cerrando operaciones aunque la persona haya apagado el bot", async () => {
    const rows = series(285, false);
    const signalT = rows[rows.length - 5][0];
    const entry = rows[rows.length - 5][4];
    rows[rows.length - 2] = [rows[rows.length - 2][0], entry, entry + 0.1, entry - 3, entry - 2.5]; // toca el stop
    klines = rows;
    enable({ enabled: false });
    db.tables.trades.push({ id: "t1", user_id: "u1", symbol: "BTCUSDT", source: "bot", outcome: "ABIERTA", direction: "LONG", entry, sl: entry - 1, tp: entry + 2 });
    db.tables.bot_signals.push({ id: "s1", user_id: "u1", symbol: "BTCUSDT", candle_time: new Date(signalT).toISOString(), trade_id: "t1" });
    await tick();
    expect(db.tables.trades.find((t) => t.id === "t1")?.outcome).toBe("SL");
  });
});

describe("función bot · reglas elegidas desde la estrategia sugerida", () => {
  it("no opera un activo que la persona decidió evitar", async () => {
    enable({ rules: [{ op: "skip", dim: "symbol", key: "BTCUSDT" }] });
    expect((await tick()).body.opened).toBe(0);
    expect(db.tables.trades).toHaveLength(0);
  });

  it("«solo compras» deja pasar una señal de compra y bloquea las ventas", async () => {
    enable({ rules: [{ op: "only", dim: "direction", key: "LONG" }] });
    expect((await tick()).body.opened).toBe(1);
    resetDb({ bot_settings: [], bot_signals: [], trades: [] });
    enable({ rules: [{ op: "only", dim: "direction", key: "SHORT" }] });
    expect((await tick()).body.opened).toBe(0);
  });

  it("respeta el día y la franja en la zona horaria de la persona", async () => {
    // la señal sale ahora: se bloquea justo el día y la franja actuales en esa zona
    const tz = "America/Argentina/Buenos_Aires";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
    const block = Math.floor(Number(parts.find((p) => p.type === "hour")!.value) / 3);
    db.tables.profiles.push({ id: "u1", timezone: tz });
    enable({ rules: [{ op: "skip", dim: "weekday", key: String(weekday) }] });
    expect((await tick()).body.opened).toBe(0);
    resetDb({ bot_settings: [], bot_signals: [], trades: [], profiles: [{ id: "u1", timezone: tz }] });
    enable({ rules: [{ op: "skip", dim: "hour", key: String(block) }] });
    expect((await tick()).body.opened).toBe(0);
    resetDb({ bot_settings: [], bot_signals: [], trades: [], profiles: [{ id: "u1", timezone: tz }] });
    enable({ rules: [{ op: "only", dim: "weekday", key: String(weekday) }, { op: "only", dim: "hour", key: String(block) }] });
    expect((await tick()).body.opened).toBe(1);
  });

  it("tope de operaciones por día", async () => {
    enable({ symbols: ["BTCUSDT"], rules: [{ op: "maxPerDay", n: 1 }] });
    db.tables.trades.push({ id: "p", user_id: "u1", symbol: "ETHUSDT", source: "bot", outcome: "SL", entry: 10, sl: 9, tp: 12, date: new Date(Date.now() - 3 * 36e5).toISOString(), closed_at: new Date(Date.now() - 2 * 36e5).toISOString() });
    expect((await tick()).body.opened).toBe(0);
  });

  it("frena tras pérdidas seguidas", async () => {
    enable({ rules: [{ op: "stopAfterLosses", n: 2 }] });
    for (let i = 0; i < 2; i++) db.tables.trades.push({ id: `l${i}`, user_id: "u1", symbol: "SOLUSDT", source: "bot", outcome: "SL", entry: 10, sl: 9, tp: 12, date: new Date(Date.now() - (5 - i) * 36e5).toISOString(), closed_at: new Date(Date.now() - (4 - i) * 36e5).toISOString() });
    expect((await tick()).body.opened).toBe(0);
    // si la última fue ganadora, la racha se corta y puede operar
    resetDb({ bot_settings: [], bot_signals: [], trades: [] });
    enable({ rules: [{ op: "stopAfterLosses", n: 2 }] });
    const t0 = Date.now();
    db.tables.trades.push({ id: "a", user_id: "u1", symbol: "SOLUSDT", source: "bot", outcome: "SL", entry: 10, sl: 9, tp: 12, date: new Date(t0 - 6 * 36e5).toISOString(), closed_at: new Date(t0 - 5 * 36e5).toISOString() });
    db.tables.trades.push({ id: "b", user_id: "u1", symbol: "SOLUSDT", source: "bot", outcome: "SL", entry: 10, sl: 9, tp: 12, date: new Date(t0 - 5 * 36e5).toISOString(), closed_at: new Date(t0 - 4 * 36e5).toISOString() });
    db.tables.trades.push({ id: "c", user_id: "u1", symbol: "SOLUSDT", source: "bot", outcome: "TP", entry: 10, sl: 9, tp: 12, date: new Date(t0 - 4 * 36e5).toISOString(), closed_at: new Date(t0 - 3 * 36e5).toISOString() });
    expect((await tick()).body.opened).toBe(1);
  });

  it("ignora reglas mal formadas en lugar de romperse", async () => {
    enable({ rules: [{ op: "skip", dim: "symbol", key: "XXX" }, "basura", { op: "maxPerDay", n: -3 }] });
    expect((await tick()).body.opened).toBe(1);
  });
});

describe("función bot · avisos de cada operación", () => {
  const withChannels = () => {
    db.tables.telegram_links = [{ user_id: "u1", chat_id: 777 }];
    db.tables.device_tokens = [{ user_id: "u1", expo_push_token: "ExponentPushToken[abc]" }];
    db.tables.profiles = [{ id: "u1", lang: "es" }];
  };

  it("avisa por la app y por Telegram cuando abre una operación, aclarando que es simulada", async () => {
    withChannels();
    enable();
    await tick();
    expect(sent.push).toHaveLength(1);
    expect(sent.push[0].title).toContain("BTCUSDT");
    expect(sent.push[0].title).toContain("simulado");
    expect(sent.push[0].data.tradeId).toBe(db.tables.trades[0].id);
    expect(sent.telegram).toHaveLength(1);
    expect(sent.telegram[0].chat_id).toBe(777);
    expect(sent.telegram[0].text).toContain("BTC/USD");
    expect(sent.telegram[0].text).toContain("Bot simulado");
    expect(sent.telegram[0].text).toContain("no se operó en ningún exchange");
  });

  it("no repite el aviso si la corrida se repite", async () => {
    withChannels();
    enable();
    await tick();
    await tick();
    expect(sent.push).toHaveLength(1);
    expect(sent.telegram).toHaveLength(1);
  });

  it("respeta el interruptor de avisos", async () => {
    withChannels();
    enable({ notify: false });
    await tick();
    expect(db.tables.trades).toHaveLength(1); // opera igual
    expect(sent.push).toHaveLength(0);
    expect(sent.telegram).toHaveLength(0);
  });

  it("avisa también cuando la operación se cierra, con el resultado", async () => {
    withChannels();
    const rows = series(285, false);
    const signalT = rows[rows.length - 5][0];
    const entry = rows[rows.length - 5][4];
    rows[rows.length - 2] = [rows[rows.length - 2][0], entry, entry + 3, entry - 0.1, entry + 2.5]; // toca el objetivo (2 de ganancia por 1 de riesgo)
    klines = rows;
    enable({ enabled: false }); // aunque haya apagado el bot, se avisa del cierre de lo que quedó abierto
    db.tables.trades.push({ id: "t1", user_id: "u1", symbol: "BTCUSDT", source: "bot", outcome: "ABIERTA", direction: "LONG", entry, sl: entry - 1, tp: entry + 2 });
    db.tables.bot_signals.push({ id: "s1", user_id: "u1", symbol: "BTCUSDT", candle_time: new Date(signalT).toISOString(), trade_id: "t1" });
    await tick();
    expect(sent.push).toHaveLength(1);
    expect(sent.push[0].title).toContain("TP alcanzado");
    expect(sent.push[0].body).toContain("+2.0R");
    expect(sent.telegram[0].text).toContain("TP ALCANZADO");
  });

  it("en inglés para quien lo tiene configurado", async () => {
    withChannels();
    db.tables.profiles = [{ id: "u1", lang: "en" }];
    enable();
    await tick();
    expect(sent.push[0].title).toContain("BUY");
    expect(sent.push[0].title).toContain("simulated");
    expect(sent.telegram[0].text).toContain("NEW SIGNAL");
    expect(sent.telegram[0].text).toContain("nothing was traded on any exchange");
  });

  it("nunca publica en comunidades: solo el chat de la propia persona", async () => {
    withChannels();
    db.tables.telegram_communities = [{ user_id: "u1", chat_id: -1001, enabled: true }];
    enable();
    await tick();
    expect(sent.telegram.every((m) => m.chat_id === 777)).toBe(true);
  });

  it("si Telegram o la app fallan, la operación se anota igual", async () => {
    withChannels();
    enable();
    vi.stubGlobal("fetch", async (url: any) => {
      const u = new URL(String(url));
      if (u.hostname === "fapi.binance.com") return new Response(JSON.stringify(klines.map((r) => [...r.map(String), "0"])));
      throw new Error("sin red");
    });
    const r = await tick();
    expect(r.body.opened).toBe(1);
    expect(db.tables.trades).toHaveLength(1);
  });
});

describe("función bot · perfiles de estrategia", () => {
  /** Ruptura reciente por encima de los últimos 20 máximos pero NO por encima de un máximo viejo (hace ~38 velas). */
  function nearBreakout() {
    const rows = series(285, false);
    const n = rows.length; // la última fila es la vela en curso
    const last = n - 2; // última cerrada
    rows[last - 38][2] += 40; // máximo viejo y alto (solo el canal de 40 velas lo ve)
    const prev = rows[last - 1][4];
    rows[last] = [rows[last][0], prev, prev + 3, prev - 0.2, prev + 2.8];
    return rows;
  }

  it("el perfil dinámico abre una señal que el conservador deja pasar", async () => {
    klines = nearBreakout();
    enable({ profile: "conservative" });
    expect((await tick()).body.opened).toBe(0);
    resetDb({ bot_settings: [], bot_signals: [], trades: [] });
    enable({ profile: "dynamic" });
    const r = await tick();
    expect(r.body.opened).toBe(1);
    expect(db.tables.trades[0].notes).toContain("perfil dinámico");
    expect(db.tables.trades[0].notes).toContain("ruptura de 10 velas");
  });

  it("sin perfil o con uno inválido usa el equilibrado", async () => {
    klines = nearBreakout();
    enable({ profile: "inventado" });
    const r = await tick();
    expect(r.body.opened).toBe(1);
    expect(db.tables.trades[0].notes).toContain("perfil equilibrado");
  });

  it("la prueba con historial compara los tres perfiles y marca el de la persona", async () => {
    klines = series(3000, true);
    db.tables.bot_settings.push({ user_id: "u1", enabled: true, symbols: ["BTCUSDT"], max_open: 3, daily_loss_r: 3, profile: "dynamic" });
    const r = await (async () => {
      const res = await handler(new Request("http://x/functions/v1/bot", { method: "POST", headers: { Authorization: "Bearer good" }, body: JSON.stringify({ action: "backtest", symbols: ["BTCUSDT"] }) }));
      return { body: (await res.json()) as any };
    })();
    expect(r.body.profile).toBe("dynamic");
    expect(r.body.byProfile.map((x: any) => x.id)).toEqual(["conservative", "balanced", "dynamic"]);
    expect(r.body.byProfile.filter((x: any) => x.current).map((x: any) => x.id)).toEqual(["dynamic"]);
  });
});

describe("función bot · muchas personas", () => {
  it("revisa primero a quienes hace más que no se revisan y avisa si deja gente para la próxima", async () => {
    // 3 personas con el bot encendido; la que nunca se revisó va primero
    for (const [id, last] of [["a", "2026-10-06T10:00:00Z"], ["b", null], ["c", "2026-10-06T09:00:00Z"]] as const) db.tables.bot_settings.push({ user_id: id, enabled: true, symbols: ["BTCUSDT"], max_open: 3, daily_loss_r: 3, last_tick_at: last });
    klines = series(285, true);
    const r = await tick();
    expect(r.body.users).toBe(3);
    expect(r.body.opened).toBe(3);
    expect(r.body.deferred).toBe(0);
  });
});

describe("función bot · prueba con historial", () => {
  const call = async (body: unknown, token = "good") => {
    const r = await handler(new Request("http://x/functions/v1/bot", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    return { status: r.status, body: (await r.json()) as any };
  };

  it("pide sesión", async () => {
    expect((await call({ action: "backtest" }, "malo")).status).toBe(401);
  });

  it("valida los activos", async () => {
    expect((await call({ action: "backtest", symbols: ["DOGEUSDT"] })).status).toBe(400);
    expect((await call({ action: "otra" })).status).toBe(400);
  });

  it("compara el bot sin reglas y con las reglas guardadas de la persona", async () => {
    klines = series(3000, true);
    db.tables.bot_settings.push({ user_id: "u1", enabled: true, symbols: ["BTCUSDT"], max_open: 3, daily_loss_r: 3, rules: [{ op: "skip", dim: "symbol", key: "BTCUSDT" }, { op: "skip", dim: "weekday", key: "9" }] });
    const r = await call({ action: "backtest", symbols: ["BTCUSDT"], days: 120 });
    expect(r.body.rulesApplied).toBe(1); // la regla mal formada se descarta
    expect(r.body.withRules.n).toBe(0); // sin BTC no queda ninguna operación
    expect(r.body.total.n).toBeGreaterThanOrEqual(r.body.withRules.n);
  });

  it("sin reglas guardadas no hay comparación", async () => {
    klines = series(3000, true);
    const r = await call({ action: "backtest", symbols: ["BTCUSDT"] });
    expect(r.body.withRules).toBeNull();
    expect(r.body.rulesApplied).toBe(0);
  });

  it("devuelve estadísticas por activo y totales", async () => {
    klines = series(3000, true);
    const r = await call({ action: "backtest", symbols: ["BTCUSDT"], days: 120 });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.symbols[0].symbol).toBe("BTCUSDT");
    expect(typeof r.body.total.n).toBe("number");
    expect(r.body.params.rr).toBe(2);
  });
});

describe("función bot · laboratorio de variantes", () => {
  const call = async (body: unknown, token = "good") => {
    const r = await handler(new Request("http://x/functions/v1/bot", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    return { status: r.status, body: (await r.json()) as any };
  };

  it("pide sesión y valida los activos", async () => {
    expect((await call({ action: "lab" }, "malo")).status).toBe(401);
    expect((await call({ action: "lab", symbols: ["DOGEUSDT"] })).status).toBe(400);
  });

  it("devuelve las cinco variantes con año completo y mitades", async () => {
    klines = series(3000, true);
    const r = await call({ action: "lab", symbols: ["BTCUSDT"] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.days).toBe(360);
    expect(r.body.variants.map((v: any) => v.id)).toEqual(["h1-balanced", "h4-balanced", "h4-conservative", "h4-wide", "h4-fast"]);
    for (const v of r.body.variants) expect(v.first.n + v.second.n).toBe(v.whole.n);
  });

  it("si no se pueden bajar los precios lo dice", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    const r = await call({ action: "lab", symbols: ["ETHUSDT"] }); // otro activo: los de la prueba anterior quedan en la memoria de 30 minutos
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toContain("precios");
  });
});

describe("función bot · escaneo del mercado", () => {
  const call = async (body: unknown) => {
    const r = await handler(new Request("http://x/functions/v1/bot", { method: "POST", headers: { Authorization: "Bearer good" }, body: JSON.stringify(body) }));
    return { status: r.status, body: (await r.json()) as any };
  };

  it("sin escaneo solo mira los activos de la persona", async () => {
    enable({ scan_top: 0, symbols: ["BTCUSDT"] });
    const r = await tick();
    expect(r.body.opened).toBe(1);
    expect(db.tables.trades.map((t: any) => t.symbol)).toEqual(["BTCUSDT"]);
  });

  it("con escaneo mira los más operados, respeta el máximo abierto y no repite activo", async () => {
    enable({ scan_top: 20, symbols: ["BTCUSDT"], max_open: 3 });
    const r = await tick();
    expect(r.body.opened).toBe(3);
    const syms = db.tables.trades.map((t: any) => t.symbol);
    expect(new Set(syms).size).toBe(3);
    expect(syms.every((x: string) => ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"].includes(x))).toBe(true); // nada de stablecoins, vencimientos ni activos de poco volumen
  });

  it("si no se puede bajar la lista del mercado sigue con los activos elegidos", async () => {
    enable({ scan_top: 40, symbols: ["BTCUSDT"] });
    const real = (globalThis as any).fetch;
    vi.stubGlobal("fetch", async (url: any, init?: any) => (String(url).includes("ticker") || String(url).includes("tickers") ? new Response("no", { status: 500 }) : real(url, init)));
    const r = await tick();
    expect(r.body.opened).toBe(1);
    expect(db.tables.trades[0].symbol).toBe("BTCUSDT");
    expect(r.body.failed.some((x: string) => x.startsWith("mercado"))).toBe(true);
  });

  it("un valor raro en scan_top se trata como sin escaneo", async () => {
    enable({ scan_top: 999, symbols: ["BTCUSDT"] });
    const r = await tick();
    expect(db.tables.trades.map((t: any) => t.symbol)).toEqual(["BTCUSDT"]);
    expect(r.body.opened).toBe(1);
  });

  it("la prueba con historial con escaneo cuenta los activos y muestra los 10 con más operaciones", async () => {
    klines = series(3000, true);
    db.tables.bot_settings.push({ user_id: "u1", enabled: true, symbols: ["BTCUSDT"], max_open: 3, daily_loss_r: 3, scan_top: 20 });
    const r = await call({ action: "backtest", symbols: ["BTCUSDT"], days: 120 });
    expect(r.body.scanned).toBe(6);
    expect(r.body.symbols.length).toBeLessThanOrEqual(10);
    expect(r.body.symbols.length).toBe(6);
  });

  it("sin escaneo la prueba no marca activos escaneados", async () => {
    klines = series(3000, true);
    const r = await call({ action: "backtest", symbols: ["BTCUSDT"], days: 120 });
    expect(r.body.scanned).toBe(0);
  });
});

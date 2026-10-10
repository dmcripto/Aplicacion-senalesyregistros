import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
type Sent = { method: string; payload: any };
let sent: Sent[] = [];

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SIGNAL_IMAGES: "off", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN", TELEGRAM_WEBHOOK_SECRET: "SECRET" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/telegram-bot/index");
});

beforeEach(() => {
  resetDb({
    profiles: [{ id: "u1", lang: "es", capital: 1000, risk_pct: 1, currency: "USD", risk_reminder: true }],
    telegram_links: [{ user_id: "u1", chat_id: 555 }], telegram_link_codes: [], telegram_pending: [],
    telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100 }], signal_votes: [], economic_posts: [], trades: [],
  });
  sent = [];
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      sent.push({ method: u.split("/").pop()!, payload: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true }));
    }
    if (u.includes("ticker/24hr")) return new Response(JSON.stringify({ lastPrice: "65000", priceChangePercent: "1.2" }));
    if (u.includes("klines")) {
      const rows = Array.from({ length: 120 }, (_, i) => [0, "0", "0", "0", String(60000 + i * 40), "0", 1]);
      return new Response(JSON.stringify(rows));
    }
    return new Response("{}", { status: 404 });
  });
});

let uid = 0;
const update = (body: unknown) => handler(new Request("http://x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "SECRET" }, body: JSON.stringify(body) }));
const priv = (text: string) => update({ update_id: ++uid, message: { message_id: 1, chat: { id: 555, type: "private" }, from: { id: 555, language_code: "es" }, text } });
const group = (text: string) => update({ update_id: ++uid, message: { message_id: 1, chat: { id: -100, type: "supergroup" }, from: { id: 9, language_code: "es" }, text } });
const lastText = () => [...sent].reverse().find((s) => s.method === "sendMessage")?.payload.text as string;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("/calc", () => {
  it("en privado toma capital y riesgo del perfil", async () => {
    await priv("/calc 65000 64500");
    expect(lastText()).toContain("Tamaño de la posición");
    expect(lastText()).toContain("$10.00"); // 1 % de 1000
  });
  it("en el grupo pide los datos completos", async () => {
    await group("/calc 65000 64500");
    expect(lastText()).toContain("Usá");
    await tick();
    await group("/calc 65000 64500 2000 2");
    expect(lastText()).toContain("$40.00");
  });
  it("un grupo no conectado no recibe respuesta", async () => {
    db.tables.telegram_communities = [];
    await group("/calc 65000 64500 1000 1");
    expect(sent).toHaveLength(0);
  });
});

describe("/niveles", () => {
  it("responde con precio, RSI, tendencia y las señales abiertas de ese activo", async () => {
    db.tables.trades.push({ id: "t1", user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 64000, tp: 66000, sl: 63000, outcome: "ABIERTA", source: null });
    db.tables.trades.push({ id: "t2", user_id: "u1", symbol: "ETHUSDT", direction: "LONG", entry: 3000, tp: 3300, sl: 2900, outcome: "ABIERTA", source: null });
    await group("/niveles btc");
    await tick();
    const html = lastText();
    expect(html).toContain("niveles clave");
    expect(html).toContain("Alcista");
    expect(html).toContain("entrada 64000");
    expect(html).not.toContain("entrada 3000");
  });
  it("sin moneda explica cómo usarlo", async () => {
    await priv("/niveles");
    expect(lastText()).toContain("/niveles BTC");
  });
});

describe("/semana, /racha, /activos, /riesgo", () => {
  it("/semana arma el ranking de la cuenta", async () => {
    const now = Date.now();
    db.tables.trades.push({ id: "t1", user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 110, sl: 95, date: new Date(now - 3e6).toISOString(), outcome: "TP", exit: null, closed_at: new Date(now - 1e6).toISOString(), source: null });
    await priv("/semana");
    expect(lastText()).toContain("Ranking semanal");
    expect(lastText()).toContain("+2.0R");
  });
  it("/racha", async () => {
    await priv("/racha");
    expect(lastText()).toContain("Todavía no");
  });
  it("/activos guarda, muestra y borra la lista", async () => {
    await priv("/activos btc eth xau");
    expect(db.tables.profiles[0].signal_symbols).toBe("BTCUSDT,ETHUSDT,XAUUSDT");
    await priv("/activos");
    expect(lastText()).toContain("BTC, ETH, XAU");
    await priv("/activos todos");
    expect(db.tables.profiles[0].signal_symbols).toBeNull();
    await priv("/activos ¿¿¿");
    expect(lastText()).toContain("No entendí");
  });
  it("/riesgo apaga y prende el aviso", async () => {
    await priv("/riesgo off");
    expect(db.tables.profiles[0].risk_reminder).toBe(false);
    await priv("/riesgo on");
    expect(db.tables.profiles[0].risk_reminder).toBe(true);
    await priv("/riesgo");
    expect(lastText()).toContain("/riesgo on");
  });
});

describe("votar una señal en el grupo", () => {
  const vote = (data: string, from = 9) =>
    update({ update_id: ++uid, callback_query: { id: "cb", data, from: { id: from, language_code: "es" }, message: { message_id: 77, chat: { id: -100, type: "supergroup" } } } });
  it("cuenta el voto y actualiza los botones del mensaje", async () => {
    await vote("v:u:trade-1234");
    await vote("v:u:trade-1234", 10);
    await vote("v:d:trade-1234", 11);
    const edit = [...sent].reverse().find((s) => s.method === "editMessageReplyMarkup")!;
    expect(edit.payload.message_id).toBe(77);
    expect(edit.payload.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(["👍 La tomo · 2", "👎 Paso · 1"]);
    expect(db.tables.signal_votes).toHaveLength(3);
  });
  it("un chat que no es una comunidad conectada no suma votos", async () => {
    db.tables.telegram_communities = [];
    await vote("v:u:trade-1234");
    expect(db.tables.signal_votes).toHaveLength(0);
  });
});

describe("aviso de exposición al registrar", () => {
  it("al confirmar una señal con muchas abiertas, avisa", async () => {
    for (let n = 0; n < 6; n++) db.tables.trades.push({ id: `o${n}`, user_id: "u1", symbol: "BTCUSDT", direction: "LONG", outcome: "ABIERTA", source: null, entry: 1, tp: 2, sl: 0.5 });
    db.tables.profiles[0].risk_pct = null;
    db.tables.telegram_pending.push({ id: "p1", user_id: "u1", chat_id: 555, trades: [{ symbol: "SOLUSDT", direction: "LONG", entry: 100, tp: 110, sl: 95 }] });
    await update({ update_id: ++uid, callback_query: { id: "cb", data: "ok:p1", from: { id: 555 }, message: { message_id: 5, chat: { id: 555, type: "private" } } } });
    await tick();
    expect(sent.some((s) => s.method === "sendMessage" && String(s.payload.text).includes("Mucha exposición"))).toBe(true);
  });
});

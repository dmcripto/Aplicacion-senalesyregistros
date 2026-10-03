import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
let calls: Array<{ url: string; body: any }> = [];
let telegramBlocked = false;
let token: string | undefined = "TOKEN";

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => (({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" } as Record<string, string | undefined>)[k] ?? (k === "TELEGRAM_BOT_TOKEN" ? token : undefined)) },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/tradingview-webhook/index");
});

const WEBHOOK = "5bb21911-8f42-49a2-9fc7-8b18a7be8278";
const post = (body: string, tok = WEBHOOK) => handler(new Request(`http://x/functions/v1/tradingview-webhook/${tok}`, { method: "POST", body }));

beforeEach(() => {
  token = "TOKEN";
  telegramBlocked = false;
  calls = [];
  resetDb({
    profiles: [{ id: "u1", webhook_token: WEBHOOK, lang: "es" }],
    device_tokens: [{ user_id: "u1", expo_push_token: "ExponentPushToken[abc]" }],
    telegram_links: [{ user_id: "u1", chat_id: 555 }],
    telegram_communities: [],
  });
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes("api.telegram.org") && telegramBlocked) return new Response(JSON.stringify({ ok: false, error_code: 403 }));
    return new Response(JSON.stringify({ ok: true }));
  });
});

const telegramCalls = () => calls.filter((c) => c.url.includes("api.telegram.org"));

describe("webhook de TradingView", () => {
  it("guarda la señal, avisa por push y por Telegram", async () => {
    const r = await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    expect(r.status).toBe(201);
    expect(db.tables.trades).toEqual([expect.objectContaining({ user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 65000 })]);
    expect(calls.some((c) => c.url.includes("exp.host"))).toBe(true);
    const tg = telegramCalls();
    expect(tg).toHaveLength(1);
    expect(tg[0].body).toMatchObject({ chat_id: 555, parse_mode: "HTML" });
    expect(tg[0].body.text).toMatch(/Nueva señal/);
    expect(tg[0].body.text).toMatch(/BTCUSDT/);
  });

  it("publica la señal en la comunidad conectada, además del aviso privado", async () => {
    db.tables.telegram_communities = [{ id: "c1", user_id: "u1", chat_id: -1001 }];
    expect((await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500")).status).toBe(201);
    const posted = telegramCalls().filter((c) => c.body.chat_id === -1001);
    expect(posted).toHaveLength(1);
    expect(posted[0].body.text).toMatch(/Nueva señal/);
    expect(posted[0].body.text).toMatch(/no es asesoramiento financiero/);
    expect(telegramCalls().filter((c) => c.body.chat_id === 555)).toHaveLength(1); // el aviso privado sigue
  });

  it("una comunidad caída no impide guardar la señal", async () => {
    db.tables.telegram_communities = [{ id: "c1", user_id: "u1", chat_id: -1001 }];
    telegramBlocked = true;
    expect((await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500")).status).toBe(201);
    expect(db.tables.trades).toHaveLength(1);
  });

  it("avisa en el idioma del usuario", async () => {
    db.tables.profiles[0].lang = "en";
    await post("VELTRIX|ETHUSDT|VENTA|3000|2900|3050");
    expect(telegramCalls()[0].body.text).toMatch(/New signal/);
    expect(telegramCalls()[0].body.text).toMatch(/SELL/);
  });

  it("sin chat vinculado o sin bot configurado no envía nada y la señal igual se guarda", async () => {
    db.tables.telegram_links.length = 0;
    expect((await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500")).status).toBe(201);
    expect(telegramCalls()).toHaveLength(0);

    db.tables.telegram_links.push({ user_id: "u1", chat_id: 555 });
    token = undefined;
    expect((await post("VELTRIX|BTCUSDT|COMPRA|65100|66500|64500")).status).toBe(201);
    expect(telegramCalls()).toHaveLength(0);
    expect(db.tables.trades).toHaveLength(2);
  });

  it("si el usuario bloqueó al bot se borra la vinculación, sin afectar la señal", async () => {
    telegramBlocked = true;
    expect((await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500")).status).toBe(201);
    expect(db.tables.telegram_links).toHaveLength(0);
    expect(db.tables.trades).toHaveLength(1);
  });

  it("token desconocido y mensajes inválidos", async () => {
    expect((await post("x", "00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await post("hola")).status).toBe(422);
  });

  it("ignora la misma alerta repetida dentro de un minuto", async () => {
    await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    const r = await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    expect((await r.json()).duplicate).toBe(true);
    expect(db.tables.trades).toHaveLength(1);
    expect(telegramCalls()).toHaveLength(1);
  });
});

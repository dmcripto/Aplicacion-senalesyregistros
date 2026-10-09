import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
let sent: Array<{ method: string; path: string; body: any; host: string }> = [];
let positionsOpen = 0;
let reject = false;

const CRON = "secreto-de-segundo-plano-123";
beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", EXCHANGE_ENC_KEY: "una-clave-maestra-larga-de-prueba", EXCHANGE_CRON_SECRET: CRON } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/trade/index");
});

const call = async (body: unknown, opts: { token?: string; cron?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (opts.cron !== undefined) headers["x-cron-secret"] = opts.cron;
  else headers.Authorization = `Bearer ${opts.token ?? "good"}`;
  const r = await handler(new Request("http://x/functions/v1/trade", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as any };
};

const live = (o: Record<string, unknown> = {}) => ({ user_id: "u1", exchange: "mexc", enabled: true, dry_run: true, verified: false, max_margin_usdt: 4, risk_usdt: 0.1, max_leverage: 10, max_open: 1, daily_loss_usdt: 0.5, errors: 0, last_error: null, ...o });
const trade = (o: Record<string, unknown> = {}) => ({ id: "t1", user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 85000, sl: 84150, tp: 86700, source: "bot", outcome: "ABIERTA", ...o });
const orders = (kind?: string) => db.tables.live_orders.filter((o) => !kind || o.kind === kind);
const creates = () => sent.filter((s) => s.path === "/api/v1/private/order/create");

async function setupKey() {
  const r = await call({ action: "connect_key", exchange: "mexc", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
  expect(r.status).toBe(200);
  db.tables.bot_live[0] = { ...live(), ...db.tables.bot_live[0] };
  sent = [];
}

beforeEach(() => {
  sent = [];
  positionsOpen = 0;
  reject = false;
  resetDb({
    profiles: [{ id: "u1", bot_beta: true }],
    bot_live: [], trade_keys: [], live_orders: [], trades: [], device_tokens: [],
  });
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.hostname === "fapi.binance.com") return new Response(JSON.stringify({ price: "85000" }));
    if (u.hostname === "exp.host") return new Response("{}");
    if (u.hostname !== "contract.mexc.com") return new Response("{}", { status: 404 });
    const body = init?.body ? JSON.parse(init.body) : null;
    sent.push({ method: init?.method ?? "GET", path: u.pathname, body, host: u.hostname });
    const ok = (data: unknown) => new Response(JSON.stringify({ success: true, code: 0, data }));
    switch (u.pathname) {
      case "/api/v1/private/account/asset/USDT": return ok({ currency: "USDT", availableBalance: 4 });
      case "/api/v1/contract/detail": return ok({ symbol: "BTC_USDT", contractSize: 0.0001, minVol: 1, volUnit: 1, priceScale: 1, maxLeverage: 125 });
      case "/api/v1/private/position/open_positions": return ok(positionsOpen ? [{ positionId: 5, symbol: "BTC_USDT", positionType: 1, holdVol: 1 }] : []);
      case "/api/v1/private/order/create":
        if (reject) return new Response(JSON.stringify({ success: false, code: 2005, message: "Insufficient balance" }));
        positionsOpen = body.side === 1 || body.side === 3 ? 1 : 0;
        return ok({ orderId: "o1" });
      case "/api/v1/private/order/cancel_all":
      case "/api/v1/private/stoporder/cancel_all": return ok({});
    }
    return new Response("{}", { status: 404 });
  });
});

describe("bot real con MEXC: clave y exchange", () => {
  it("conectar con exchange mexc guarda la clave de MEXC y deja todo apagado, en seco y sin verificar", async () => {
    const r = await call({ action: "connect_key", exchange: "mexc", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
    expect(r.body).toMatchObject({ ok: true, available: 4, keyHint: "1234", exchange: "mexc" });
    expect(db.tables.trade_keys[0]).toMatchObject({ exchange: "mexc", api_key: "KEYKEYKEY1234" });
    expect(db.tables.trade_keys[0].secret_enc).not.toContain("SECRETSECRET");
    expect(db.tables.bot_live[0]).toMatchObject({ exchange: "mexc", enabled: false, dry_run: true, verified: false });
    const st = await call({ action: "status" });
    expect(st.body).toMatchObject({ ok: true, exchange: "mexc", hasKey: true, keyHint: "1234", keys: { mexc: "1234" } });
    expect(st.body.exchanges).toEqual(["bitunix", "mexc"]);
    expect(JSON.stringify(st.body)).not.toContain("SECRETSECRET");
  });

  it("un exchange que no existe se rechaza", async () => {
    const r = await call({ action: "connect_key", exchange: "kraken", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
    expect(r.status).toBe(400);
    expect(db.tables.trade_keys).toHaveLength(0);
  });

  it("una clave que MEXC rechaza no se guarda", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false, code: 602, message: "Signature verification failed" })));
    const r = await call({ action: "connect_key", exchange: "mexc", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("MEXC");
    expect(db.tables.trade_keys).toHaveLength(0);
  });

  it("cambiar a un exchange con clave guardada deja el bot apagado, en seco y sin verificar; sin clave no deja", async () => {
    await setupKey();
    db.tables.bot_live[0] = { ...db.tables.bot_live[0], exchange: "mexc", enabled: true, verified: true, dry_run: false };
    expect((await call({ action: "use_exchange", exchange: "bitunix" })).status).toBe(400);
    db.tables.trade_keys.push({ user_id: "u1", exchange: "bitunix", key_hint: "9999", api_key: "x", secret_enc: "y" });
    const r = await call({ action: "use_exchange", exchange: "bitunix" });
    expect(r.status).toBe(200);
    expect(db.tables.bot_live[0]).toMatchObject({ exchange: "bitunix", enabled: false, dry_run: true, verified: false });
  });

  it("borrar la clave de otro exchange no apaga el bot del exchange activo", async () => {
    await setupKey();
    db.tables.bot_live[0].enabled = true;
    db.tables.trade_keys.push({ user_id: "u1", exchange: "bitunix", key_hint: "9999", api_key: "x", secret_enc: "y" });
    expect((await call({ action: "disconnect_key", exchange: "bitunix" })).status).toBe(200);
    expect(db.tables.trade_keys.map((k) => k.exchange)).toEqual(["mexc"]);
    expect(db.tables.bot_live[0].enabled).toBe(true);
  });
});

describe("bot real con MEXC: orden de prueba", () => {
  it("sin confirmar muestra la orden en contratos y no envía nada", async () => {
    await setupKey();
    const r = await call({ action: "test_order" });
    expect(r.body).toMatchObject({ ok: true, preview: true });
    expect(r.body.request).toMatchObject({ symbol: "BTC_USDT", side: 1, type: 5, openType: 1 });
    expect(Number.isInteger(r.body.request.vol) && r.body.request.vol >= 1).toBe(true);
    expect(creates()).toHaveLength(0);
  });

  it("la orden real de prueba abre, confirma la posición, la cierra a mercado y recién ahí queda verificada", async () => {
    await setupKey();
    const r = await call({ action: "test_order", confirm: true });
    expect(r.body).toMatchObject({ ok: true, verified: true });
    const c = creates();
    expect(c).toHaveLength(2);
    expect(c[0].body.side).toBe(1); // abrir compra
    expect(c[1].body).toMatchObject({ side: 4, symbol: "BTC_USDT", vol: 1 }); // cerrar compra
    expect(db.tables.bot_live[0].verified).toBe(true);
  });

  it("si MEXC rechaza la orden no se habilita nada", async () => {
    await setupKey();
    reject = true;
    const r = await call({ action: "test_order", confirm: true });
    expect(r.body.ok).toBe(false);
    expect(db.tables.bot_live[0].verified).toBe(false);
  });
});

describe("bot real con MEXC: operaciones del bot y apagado", () => {
  it("en seco arma la orden, la anota y no manda nada", async () => {
    await setupKey();
    db.tables.bot_live[0].enabled = true;
    db.tables.trades.push(trade());
    const r = await call({ action: "execute", userId: "u1", tradeId: "t1" }, { cron: CRON });
    expect(r.body).toMatchObject({ ok: true, status: "dry_run" });
    expect(creates()).toHaveLength(0);
    expect(orders("bot")[0]).toMatchObject({ exchange: "mexc", status: "dry_run" });
  });

  it("enviando de verdad abre la orden con stop y objetivo, y respeta el máximo de posiciones", async () => {
    await setupKey();
    db.tables.bot_live[0] = { ...db.tables.bot_live[0], enabled: true, verified: true, dry_run: false };
    db.tables.trades.push(trade());
    const r = await call({ action: "execute", userId: "u1", tradeId: "t1" }, { cron: CRON });
    expect(r.body.status).toBe("sent");
    expect(creates()[0].body).toMatchObject({ side: 1, stopLossPrice: 84150, takeProfitPrice: 86700 });
    db.tables.trades.push(trade({ id: "t2" }));
    const r2 = await call({ action: "execute", userId: "u1", tradeId: "t2" }, { cron: CRON });
    expect(r2.body.status).toBe("skipped"); // ya hay una posición abierta (máximo 1)
    expect(creates()).toHaveLength(1);
  });

  it("el botón de pánico apaga el bot, cancela pendientes y cierra la posición con una orden contraria", async () => {
    await setupKey();
    db.tables.bot_live[0].enabled = true;
    positionsOpen = 1;
    const r = await call({ action: "panic" });
    expect(r.body.ok).toBe(true);
    expect(db.tables.bot_live[0]).toMatchObject({ enabled: false, dry_run: true });
    expect(sent.some((s) => s.path.endsWith("/order/cancel_all"))).toBe(true);
    expect(creates()[0].body).toMatchObject({ side: 4, vol: 1 });
  });
});

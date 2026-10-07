import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, db, resetDb } from "./helpers/fake-supabase";
import { bitunixSign } from "../supabase/functions/_shared/exchanges";

let handler: (req: Request) => Promise<Response>;
let sent: Array<{ method: string; path: string; body: any }> = [];
let bitunixDown = false;
let reject = false;
let positionsOpen = 0;
let closeWorks = true;

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

const live = (o: Record<string, unknown> = {}) => ({ user_id: "u1", enabled: true, dry_run: true, verified: false, max_margin_usdt: 4, risk_usdt: 0.1, max_leverage: 10, max_open: 1, daily_loss_usdt: 0.5, errors: 0, last_error: null, ...o });
const trade = (o: Record<string, unknown> = {}) => ({ id: "t1", user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 85000, sl: 84150, tp: 86700, source: "bot", outcome: "ABIERTA", ...o });
const orders = (kind?: string) => db.tables.live_orders.filter((o) => !kind || o.kind === kind);

async function setupKey() {
  const r = await call({ action: "connect_key", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
  expect(r.status).toBe(200);
  // la base real pone los valores de fábrica de las columnas que la función no escribe
  db.tables.bot_live[0] = { ...live(), ...db.tables.bot_live[0] };
  sent = [];
}

beforeEach(() => {
  sent = [];
  bitunixDown = false;
  reject = false;
  positionsOpen = 0;
  closeWorks = true;
  resetDb({
    profiles: [{ id: "u1", bot_beta: true }, { id: "u2", bot_beta: false }],
    bot_live: [], trade_keys: [], live_orders: [], trades: [], device_tokens: [{ user_id: "u1", expo_push_token: "ExponentPushToken[abc]" }],
  });
  db.users.nobeta = { id: "u2" };
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.hostname === "fapi.binance.com") return new Response(JSON.stringify({ price: "85000" }));
    if (u.hostname === "exp.host") return new Response("{}");
    if (u.hostname !== "fapi.bitunix.com") return new Response("{}", { status: 404 });
    if (bitunixDown) throw new Error("down");
    const body = init?.body ? JSON.parse(init.body) : null;
    sent.push({ method: init?.method ?? "GET", path: u.pathname, body });
    const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, msg: "Success", data }));
    switch (u.pathname) {
      case "/api/v1/futures/account": return ok({ marginCoin: "USDT", available: "4", margin: "0" });
      case "/api/v1/futures/market/trading_pairs": return ok([{ symbol: "BTCUSDT", minTradeVolume: "0.0001", basePrecision: 4, quotePrecision: 1, maxLeverage: 125 }]);
      case "/api/v1/futures/position/get_pending_positions": return ok(positionsOpen ? [{ positionId: "p1", symbol: "BTCUSDT", qty: "0.0001", side: "BUY" }] : []);
      case "/api/v1/futures/account/change_margin_mode":
      case "/api/v1/futures/account/change_leverage": return ok({});
      case "/api/v1/futures/trade/place_order":
        if (reject) return new Response(JSON.stringify({ code: 20003, msg: "Insufficient balance" }));
        positionsOpen = 1;
        return ok({ orderId: "o1" });
      case "/api/v1/futures/trade/flash_close_position":
        if (closeWorks) positionsOpen = 0;
        return closeWorks ? ok({}) : new Response(JSON.stringify({ code: 9, msg: "fail" }));
      case "/api/v1/futures/trade/cancel_all_orders": return ok({});
    }
    return new Response("{}", { status: 404 });
  });
});

describe("función trade: acceso y clave", () => {
  it("rechaza sesiones inválidas y cuentas sin la llave beta", async () => {
    expect((await call({ action: "status" }, { token: "malo" })).status).toBe(401);
    expect((await call({ action: "status" }, { token: "nobeta" })).status).toBe(403);
  });

  it("el secreto compartido solo sirve para «execute»", async () => {
    expect((await call({ action: "execute", userId: "u1", tradeId: "t1" }, { cron: "incorrecto-incorrecto" })).status).toBe(401);
    expect((await call({ action: "panic" }, { cron: CRON })).status).toBe(400);
  });

  it("conectar valida la clave, la guarda cifrada y deja todo apagado y en seco", async () => {
    const r = await call({ action: "connect_key", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
    expect(r.body).toMatchObject({ ok: true, available: 4, keyHint: "1234" });
    const k = db.tables.trade_keys[0];
    expect(k.api_key).toBe("KEYKEYKEY1234");
    expect(k.secret_enc).not.toContain("SECRETSECRET");
    expect(db.tables.bot_live[0]).toMatchObject({ enabled: false, dry_run: true, verified: false });
    const st = await call({ action: "status" });
    expect(st.body).toMatchObject({ ok: true, hasKey: true, keyHint: "1234" });
    expect(JSON.stringify(st.body)).not.toContain("SECRETSECRET");
  });

  it("una clave que Bitunix rechaza no se guarda", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: 10003, msg: "Invalid key" })));
    const r = await call({ action: "connect_key", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
    expect(r.status).toBe(400);
    expect(db.tables.trade_keys).toHaveLength(0);
  });

  it("con 2FA activo y sin código reciente no deja conectar ni desconectar", async () => {
    db.rpcs.mfa_step_ok = () => ({ data: false });
    const a = await call({ action: "connect_key", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("mfa_required");
    db.tables.trade_keys = [{ user_id: "u1", exchange: "bitunix" }];
    expect((await call({ action: "disconnect_key" })).status).toBe(403);
    expect(db.tables.trade_keys).toHaveLength(1);
  });

  it("desconectar borra la clave y apaga todo", async () => {
    await setupKey();
    db.tables.bot_live[0].enabled = true;
    db.tables.bot_live[0].verified = true;
    expect((await call({ action: "disconnect_key" })).status).toBe(200);
    expect(db.tables.trade_keys).toHaveLength(0);
    expect(db.tables.bot_live[0]).toMatchObject({ enabled: false, dry_run: true, verified: false });
  });
});

describe("función trade: orden de prueba", () => {
  it("sin confirmar solo muestra lo que enviaría y no manda ninguna orden", async () => {
    await setupKey();
    const r = await call({ action: "test_order" });
    expect(r.body).toMatchObject({ ok: true, preview: true });
    expect(r.body.request).toMatchObject({ symbol: "BTCUSDT", side: "BUY", orderType: "MARKET" });
    expect(sent.some((s) => s.path.endsWith("place_order"))).toBe(false);
  });

  it("si el precio es alto y con ±1 % no entra en tus topes, prueba con ±0,5 %", async () => {
    await setupKey();
    db.tables.bot_live[0].risk_usdt = 0.05; // con el stop a 850 el tamaño no llega al mínimo; a 425 sí
    const r = await call({ action: "test_order" });
    expect(r.body).toMatchObject({ ok: true, preview: true });
    const sl = Number(r.body.request.slPrice);
    expect(sl).toBeGreaterThan(84500); // ~0,5 % por debajo de 85.000
  });

  it("confirmada: abre, comprueba la posición, la cierra y recién ahí habilita (verified)", async () => {
    await setupKey();
    const r = await call({ action: "test_order", confirm: true });
    expect(r.body.ok).toBe(true);
    expect(r.body.verified).toBe(true);
    expect(sent.map((s) => s.path.split("/").pop())).toEqual(expect.arrayContaining(["place_order", "flash_close_position"]));
    expect(db.tables.bot_live[0].verified).toBe(true);
    expect(orders("test").some((o) => o.status === "sent")).toBe(true);
  });

  it("si no se puede confirmar el cierre, NO queda verificada y avisa que cierre a mano", async () => {
    await setupKey();
    closeWorks = false;
    const r = await call({ action: "test_order", confirm: true });
    expect(r.body.ok).toBe(false);
    expect(r.body.steps.join(" ")).toMatch(/CERRALA A MANO/);
    expect(db.tables.bot_live[0].verified).toBe(false);
  });

  it("si Bitunix rechaza la orden de prueba, no se habilita nada", async () => {
    await setupKey();
    reject = true;
    const r = await call({ action: "test_order", confirm: true });
    expect(r.body.ok).toBe(false);
    expect(db.tables.bot_live[0].verified).toBe(false);
    expect(orders("test").at(-1)?.status).toBe("rejected");
  });

  it("confirmar la orden real exige el código de 2FA", async () => {
    await setupKey();
    db.rpcs.mfa_step_ok = () => ({ data: false });
    expect((await call({ action: "test_order", confirm: true })).status).toBe(403);
    expect(sent.some((s) => s.path.endsWith("place_order"))).toBe(false);
  });
});

describe("función trade: órdenes del bot", () => {
  beforeEach(async () => {
    await setupKey();
    db.tables.trades = [trade()];
  });
  const exec = (id = "t1") => call({ action: "execute", userId: "u1", tradeId: id }, { cron: CRON });
  const placed = () => sent.filter((s) => s.path.endsWith("place_order"));

  it("apagado: no hace nada", async () => {
    db.tables.bot_live[0].enabled = false;
    expect((await exec()).body.status).toBe("off");
    expect(sent).toHaveLength(0);
  });

  it("en seco: arma la orden, la anota y NO la envía", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: true });
    const r = await exec();
    expect(r.body.status).toBe("dry_run");
    expect(placed()).toHaveLength(0);
    expect(orders("bot")[0]).toMatchObject({ status: "dry_run", symbol: "BTCUSDT", side: "BUY", trade_id: "t1" });
    expect(orders("bot")[0].request).toMatchObject({ qty: "0.0001", slPrice: "84150", tpPrice: "86700" });
  });

  it("real: prepara margen y apalancamiento, envía la orden con stop y objetivo y la anota", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    const r = await exec();
    expect(r.body.status).toBe("sent");
    const paths = sent.map((s) => s.path.split("/").pop());
    expect(paths.indexOf("change_leverage")).toBeLessThan(paths.indexOf("place_order"));
    expect(placed()[0].body).toMatchObject({ symbol: "BTCUSDT", side: "BUY", tradeSide: "OPEN", orderType: "MARKET", slPrice: "84150", tpPrice: "86700" });
    expect(Number(placed()[0].body.qty)).toBeLessThanOrEqual(0.0002);
    expect(orders("bot")[0].status).toBe("sent");
  });

  it("no procesa dos veces la misma operación", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    await exec();
    positionsOpen = 0;
    expect((await exec()).body.status).toBe("skipped");
    expect(placed()).toHaveLength(1);
  });

  it("no envía si ya hay la cantidad máxima de posiciones abiertas", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    positionsOpen = 1;
    const r = await exec();
    expect(r.body.status).toBe("skipped");
    expect(placed()).toHaveLength(0);
  });

  it("tope diario: la pérdida máxima posible del día no pasa el límite", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true, daily_loss_usdt: 0.25, risk_usdt: 0.1 });
    db.tables.live_orders = [1, 2].map((i) => ({ id: `o${i}`, user_id: "u1", kind: "bot", status: "sent", created_at: new Date().toISOString() }));
    const r = await exec();
    expect(r.body.status).toBe("skipped");
    expect(placed()).toHaveLength(0);
  });

  it("si la operación ya no está abierta o es de otra persona, no hace nada", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    db.tables.trades = [trade({ outcome: "SL" })];
    expect((await exec()).body.status).toBe("skipped");
    db.tables.trades = [trade({ user_id: "u2" })];
    expect((await exec()).body.status).toBe("skipped");
    expect(placed()).toHaveLength(0);
  });

  it("si el par no se puede leer, no se opera", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    const f = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: any, init: any) => (String(url).includes("trading_pairs") ? new Response(JSON.stringify({ code: 0, data: [] })) : f(url, init)));
    expect((await exec()).body.status).toBe("skipped");
    expect(placed()).toHaveLength(0);
  });

  it("tras 3 rechazos seguidos el bot real se apaga solo", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    reject = true;
    for (const id of ["t1", "t2", "t3"]) {
      db.tables.trades.push(trade({ id }));
      await exec(id);
      positionsOpen = 0;
    }
    expect(db.tables.bot_live[0].enabled).toBe(false);
    expect(db.tables.bot_live[0].errors).toBeGreaterThanOrEqual(3);
  });

  it("el precio ya movido no se persigue", async () => {
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    db.tables.trades = [trade({ entry: 84000, sl: 83200, tp: 85700 })]; // el precio actual (85000) ya se fue +1,2 %
    expect((await exec()).body.status).toBe("skipped");
    expect(placed()).toHaveLength(0);
  });
});

describe("función trade: apagado total", () => {
  it("apaga primero, cancela órdenes y cierra las posiciones", async () => {
    await setupKey();
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    positionsOpen = 1;
    const r = await call({ action: "panic" });
    expect(r.body.ok).toBe(true);
    expect(db.tables.bot_live[0]).toMatchObject({ enabled: false, dry_run: true });
    expect(sent.map((s) => s.path.split("/").pop())).toEqual(expect.arrayContaining(["cancel_all_orders", "flash_close_position"]));
  });

  it("aunque Bitunix no responda, el bot real queda apagado y se avisa qué revisar a mano", async () => {
    await setupKey();
    db.tables.bot_live[0] = live({ enabled: true, dry_run: false, verified: true });
    bitunixDown = true;
    const r = await call({ action: "panic" });
    expect(db.tables.bot_live[0].enabled).toBe(false);
    expect(r.body.ok).toBe(false);
    expect(r.body.steps.join(" ")).toMatch(/a mano/);
  });

  it("no pide el código de 2FA (es una emergencia)", async () => {
    await setupKey();
    db.rpcs.mfa_step_ok = () => ({ data: false });
    expect((await call({ action: "panic" })).status).toBe(200);
  });
});

import { describe, expect, it } from "vitest";
import { bitunixSign } from "../supabase/functions/_shared/exchanges";
import { bxBalance, bxCall, bxPair, bxPositions, bxSetup, orderBody, planOrder } from "../supabase/functions/_shared/bitunixTrade";
import type { BxCfg, BxPair, BxSignal } from "../supabase/functions/_shared/bitunixTrade";

const CFG: BxCfg = { risk_usdt: 0.1, max_margin_usdt: 4, max_leverage: 10 };
const BTC: BxPair = { symbol: "BTCUSDT", minQty: 0.0001, qtyDecimals: 4, maxLeverage: 125 };
const sig = (o: Partial<BxSignal> = {}): BxSignal => ({ symbol: "BTCUSDT", direction: "LONG", entry: 85000, sl: 84150, tp: 86700, ...o });

describe("tamaño de la orden real", () => {
  it("el tamaño sale del riesgo fijo y respeta los topes", () => {
    const p = planOrder(sig(), 85000, BTC, CFG);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.qty).toBe(0.0001); // 0,1 / 850 = 0,000117 → se redondea hacia abajo
    expect(p.risk).toBeLessThanOrEqual(CFG.risk_usdt);
    expect(p.margin).toBeLessThanOrEqual(CFG.max_margin_usdt);
    expect(p.leverage).toBeGreaterThanOrEqual(1);
    expect(p.leverage).toBeLessThanOrEqual(CFG.max_leverage);
    expect(p.notional).toBeCloseTo(8.5, 5);
  });

  it("nunca sube el riesgo para llegar al mínimo del exchange", () => {
    const p = planOrder(sig({ entry: 85000, sl: 80000 }), 85000, BTC, CFG); // stop lejos: 0,1/5000 = 0,00002 < mínimo
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/mínimo/);
  });

  it("un SHORT calcula la distancia al revés y pide venta", () => {
    const s = sig({ direction: "SHORT", sl: 85850, tp: 83300 });
    const p = planOrder(s, 85000, BTC, CFG);
    expect(p.ok).toBe(true);
    expect(orderBody(s, 0.0001, "c1")).toMatchObject({ side: "SELL", tradeSide: "OPEN", orderType: "MARKET", slPrice: "85850", tpPrice: "83300" });
  });

  it("redondea stop y objetivo a los decimales del precio cuando el exchange los informa", () => {
    expect(orderBody(sig({ sl: 84392.654, tp: 86950.126 }), 0.0001, "c", 1)).toMatchObject({ slPrice: "84392.7", tpPrice: "86950.1" });
    expect(orderBody(sig({ sl: 84392.654 }), 0.0001, "c")).toMatchObject({ slPrice: "84392.654" });
  });

  it("el margen nunca supera el tope aunque haya mucho riesgo permitido", () => {
    const big: BxCfg = { risk_usdt: 1, max_margin_usdt: 4, max_leverage: 10 };
    const p = planOrder(sig({ sl: 84900 }), 85000, BTC, big); // stop muy cerca: pediría un tamaño enorme
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.notional).toBeLessThanOrEqual(4 * 10 + 1e-6);
    expect(p.margin).toBeLessThanOrEqual(4 + 1e-9);
  });

  it("no persigue una señal que ya se movió o que ya pasó el stop o el objetivo", () => {
    expect(planOrder(sig(), 85600, BTC, CFG).ok).toBe(false); // +0,7 %
    expect(planOrder(sig({ sl: 85200 }), 85000, BTC, CFG).ok).toBe(false); // el stop ya quedó del otro lado
    expect(planOrder(sig({ tp: 84900 }), 85000, BTC, CFG).ok).toBe(false);
    expect(planOrder(sig(), 0, BTC, CFG).ok).toBe(false);
  });

  it("el stop tiene que quedar lejos de la liquidación", () => {
    const tight: BxCfg = { risk_usdt: 1, max_margin_usdt: 4, max_leverage: 20 };
    const p = planOrder(sig({ sl: 80750, tp: 95000 }), 85000, BTC, tight); // stop a 5 %: con ese tamaño exigiría mucho apalancamiento
    if (p.ok) expect(5 / 100 <= 0.6 / p.leverage).toBe(true);
  });

  it("sin topes válidos no se opera", () => {
    expect(planOrder(sig(), 85000, BTC, { risk_usdt: NaN, max_margin_usdt: 4, max_leverage: 10 }).ok).toBe(false);
    expect(planOrder(sig(), 85000, BTC, { risk_usdt: 0.1, max_margin_usdt: 0, max_leverage: 10 }).ok).toBe(false);
    expect(planOrder(sig(), 85000, { ...BTC, minQty: 0 }, CFG).ok).toBe(false);
  });

  it("usa el menor entre tu tope y el del par", () => {
    const p = planOrder(sig(), 85000, { ...BTC, maxLeverage: 3 }, { ...CFG, max_leverage: 10 });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.leverage).toBeLessThanOrEqual(3);
  });
});

describe("pedidos firmados a Bitunix", () => {
  const key = "KEYKEYKEY1234";
  const secret = "SECRETSECRET";

  it("un POST firma el cuerpo JSON compacto y lo manda tal cual", async () => {
    let seen: { url: string; init: any } | null = null;
    const fetchFn = (async (url: any, init: any) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ code: 0, msg: "Success", data: { orderId: "1" } }));
    }) as typeof fetch;
    const body = { symbol: "BTCUSDT", qty: "0.0001", side: "BUY" };
    const r = await bxCall(fetchFn, "POST", "/api/v1/futures/trade/place_order", {}, body, key, secret);
    expect(r.ok).toBe(true);
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.body).toBe(JSON.stringify(body));
    const h = seen!.init.headers;
    expect(h["sign"]).toBe(await bitunixSign(h.nonce, h.timestamp, key, {}, secret, JSON.stringify(body)));
    expect(h["api-key"]).toBe(key);
    expect(seen!.url.endsWith("/place_order")).toBe(true);
  });

  it("un GET firma los parámetros ordenados y no lleva cuerpo", async () => {
    let seen: { url: string; init: any } | null = null;
    const fetchFn = (async (url: any, init: any) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ code: 0, data: [] }));
    }) as typeof fetch;
    await bxCall(fetchFn, "GET", "/api/v1/futures/account", { marginCoin: "USDT", a: "1" }, null, key, secret);
    expect(seen!.init.body).toBeUndefined();
    expect(seen!.url).toContain("?marginCoin=USDT&a=1");
    const h = seen!.init.headers;
    expect(h.sign).toBe(await bitunixSign(h.nonce, h.timestamp, key, { marginCoin: "USDT", a: "1" }, secret));
  });

  it("los errores del exchange y de red se devuelven, no se lanzan", async () => {
    const bad = (async () => new Response(JSON.stringify({ code: 10003, msg: "Invalid key" }), { status: 200 })) as typeof fetch;
    const r1 = await bxCall(bad, "GET", "/x", {}, null, key, secret);
    expect(r1).toMatchObject({ ok: false, code: 10003, msg: "Invalid key" });
    const down = (async () => { throw new Error("red"); }) as typeof fetch;
    const r2 = await bxCall(down, "POST", "/x", {}, { a: 1 }, key, secret);
    expect(r2).toMatchObject({ ok: false, status: 0 });
  });

  it("lee el par, el saldo y las posiciones; si el par no se entiende, devuelve null (no se opera)", async () => {
    const routes: Record<string, unknown> = {
      "/api/v1/futures/market/trading_pairs": { code: 0, data: [{ symbol: "BTCUSDT", minTradeVolume: "0.0001", basePrecision: 4, maxLeverage: 125 }] },
      "/api/v1/futures/account": { code: 0, data: { marginCoin: "USDT", available: "3.5", margin: "0.5" } },
      "/api/v1/futures/position/get_pending_positions": { code: 0, data: [{ positionId: "p1", symbol: "BTCUSDT", qty: "0.0001", side: "BUY" }] },
    };
    const fetchFn = (async (url: any) => new Response(JSON.stringify(routes[new URL(String(url)).pathname] ?? { code: 1, msg: "no" }))) as typeof fetch;
    expect(await bxPair(fetchFn, key, secret, "BTCUSDT")).toEqual({ symbol: "BTCUSDT", minQty: 0.0001, qtyDecimals: 4, maxLeverage: 125, priceDecimals: null });
    expect(await bxPair(fetchFn, key, secret, "ETHUSDT")).toBeNull();
    expect((await bxBalance(fetchFn, key, secret)).available).toBeCloseTo(4, 9);
    expect(await bxPositions(fetchFn, key, secret)).toEqual([{ positionId: "p1", symbol: "BTCUSDT", qty: 0.0001, side: "BUY" }]);
    routes["/api/v1/futures/market/trading_pairs"] = { code: 0, data: [{ symbol: "BTCUSDT" }] }; // sin los datos que hacen falta
    expect(await bxPair(fetchFn, key, secret, "BTCUSDT")).toBeNull();
  });

  it("la preparación avisa lo que no se pudo cambiar", async () => {
    const fetchFn = (async (url: any) => new Response(JSON.stringify(String(url).includes("leverage") ? { code: 0 } : { code: 5, msg: "has position" }))) as typeof fetch;
    expect(await bxSetup(fetchFn, key, secret, "BTCUSDT", 5)).toEqual(["margen aislado: has position"]);
  });
});

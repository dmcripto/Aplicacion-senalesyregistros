import { describe, expect, it } from "vitest";
import { mexcSign } from "../supabase/functions/_shared/exchanges";
import { fromMexcSymbol, mexcCall, mexcOrderBody, mexcPairFromDetail, mexcSymbol, mxBalance, mxPositions } from "../supabase/functions/_shared/mexcTrade";
import { planOrder } from "../supabase/functions/_shared/bitunixTrade";
import type { BxCfg, BxSignal } from "../supabase/functions/_shared/bitunixTrade";

const CFG: BxCfg = { risk_usdt: 0.1, max_margin_usdt: 4, max_leverage: 10 };
const sig = (o: Partial<BxSignal> = {}): BxSignal => ({ symbol: "BTCUSDT", direction: "LONG", entry: 85000, sl: 84150, tp: 86700, ...o });
const DETAIL = { symbol: "BTC_USDT", contractSize: 0.0001, minVol: 1, volUnit: 1, priceScale: 1, maxLeverage: 200 };

describe("símbolos de MEXC", () => {
  it("BTCUSDT ↔ BTC_USDT", () => {
    expect(mexcSymbol("BTCUSDT")).toBe("BTC_USDT");
    expect(mexcSymbol("SOLUSDC")).toBe("SOL_USDC");
    expect(mexcSymbol("BTC_USDT")).toBe("BTC_USDT");
    expect(fromMexcSymbol("BTC_USDT")).toBe("BTCUSDT");
  });
});

describe("reglas del par y tamaño en contratos", () => {
  it("el mínimo y el paso salen del valor del contrato", () => {
    const p = mexcPairFromDetail(DETAIL, "BTCUSDT")!;
    expect(p).toMatchObject({ minQty: 0.0001, qtyStep: 0.0001, qtyDecimals: 4, priceDecimals: 1, maxLeverage: 200, contractSize: 0.0001 });
  });

  it("sin el valor del contrato no se opera", () => {
    expect(mexcPairFromDetail({ minVol: 1 }, "BTCUSDT")).toBeNull();
    expect(mexcPairFromDetail(null, "BTCUSDT")).toBeNull();
  });

  it("el tamaño es siempre un múltiplo entero de contratos y nunca sube el riesgo", () => {
    const pair = mexcPairFromDetail({ ...DETAIL, contractSize: 0.001, volUnit: 1 }, "BTCUSDT")!; // 1 contrato = 0,001 BTC
    const plan = planOrder(sig(), 85000, pair, { risk_usdt: 0.9, max_margin_usdt: 10, max_leverage: 10 });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(Math.round(plan.qty / 0.001)).toBeCloseTo(plan.qty / 0.001, 6); // contratos enteros
      expect(plan.risk).toBeLessThanOrEqual(0.9 * 1.001);
      expect(plan.margin).toBeLessThanOrEqual(10);
    }
  });

  it("si con tus topes no llega a un contrato, se omite en vez de subir el riesgo", () => {
    const pair = mexcPairFromDetail({ ...DETAIL, contractSize: 0.01 }, "BTCUSDT")!; // 1 contrato = 0,01 BTC ≈ 850 USDT
    const plan = planOrder(sig(), 85000, pair, CFG);
    expect(plan.ok).toBe(false);
  });
});

describe("la orden de MEXC", () => {
  const pair = mexcPairFromDetail(DETAIL, "BTCUSDT")!;

  it("compra: abre long (1), a mercado (5), margen aislado (1), con stop y objetivo y tamaño en contratos", () => {
    const b = mexcOrderBody(sig(), 0.0003, "vx abc-123", pair, 7);
    expect(b).toMatchObject({ symbol: "BTC_USDT", vol: 3, leverage: 7, side: 1, type: 5, openType: 1, externalOid: "vxabc123", stopLossPrice: 84150, takeProfitPrice: 86700 });
  });

  it("venta: abre short (3)", () => {
    const b = mexcOrderBody(sig({ direction: "SHORT", sl: 85850, tp: 83300 }), 0.0001, "id", pair, 5);
    expect(b).toMatchObject({ side: 3, vol: 1, stopLossPrice: 85850, takeProfitPrice: 83300 });
  });

  it("redondea stop y objetivo a los decimales del precio", () => {
    const b = mexcOrderBody(sig({ sl: 84150.123456, tp: 86700.987 }), 0.0001, "id", pair, 5);
    expect(b.stopLossPrice).toBe(84150.1);
    expect(b.takeProfitPrice).toBe(86701);
  });
});

describe("pedidos firmados a MEXC", () => {
  const key = "KEYKEYKEY1234";
  const secret = "SECRETSECRET";

  it("un POST firma el cuerpo JSON compacto y lo manda tal cual", async () => {
    let seen: { url: string; init: any } | null = null;
    const f = (async (url: any, init: any) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ success: true, code: 0, data: { orderId: "1" } }));
    }) as typeof fetch;
    const body = { symbol: "BTC_USDT", vol: 1, side: 1 };
    const r = await mexcCall(f, "POST", "/api/v1/private/order/create", {}, body, key, secret);
    expect(r.ok).toBe(true);
    expect(seen!.init.body).toBe(JSON.stringify(body));
    const h = seen!.init.headers;
    expect(h.Signature).toBe(await mexcSign(key, h["Request-Time"], JSON.stringify(body), secret));
    expect(h.ApiKey).toBe(key);
  });

  it("un GET firma los parámetros ordenados", async () => {
    let seen: { url: string; init: any } | null = null;
    const f = (async (url: any, init: any) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ success: true, code: 0, data: [] }));
    }) as typeof fetch;
    await mexcCall(f, "GET", "/api/v1/x", { b: 2, a: 1 }, null, key, secret);
    expect(seen!.url.endsWith("/api/v1/x?a=1&b=2")).toBe(true);
    const h = seen!.init.headers;
    expect(h.Signature).toBe(await mexcSign(key, h["Request-Time"], "a=1&b=2", secret));
  });

  it("si la primera dirección no conoce la ruta (404) prueba la otra; un envío que pudo salir nunca se repite", async () => {
    const hosts: string[] = [];
    const f404 = (async (url: any) => {
      hosts.push(new URL(String(url)).hostname);
      return hosts.length === 1 ? new Response("not found", { status: 404 }) : new Response(JSON.stringify({ success: true, code: 0, data: {} }));
    }) as typeof fetch;
    const r = await mexcCall(f404, "GET", "/api/v1/x", {}, null, key, secret);
    expect(r.ok).toBe(true);
    expect(hosts).toEqual(["contract.mexc.com", "api.mexc.com"]);

    let calls = 0;
    const fDown = (async () => {
      calls++;
      throw new Error("down");
    }) as typeof fetch;
    const p = await mexcCall(fDown, "POST", "/api/v1/private/order/create", {}, { a: 1 }, key, secret);
    expect(p.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("los errores del exchange se devuelven, no se lanzan", async () => {
    const f = (async () => new Response(JSON.stringify({ success: false, code: 602, message: "Signature verification failed" }))) as typeof fetch;
    const r = await mexcCall(f, "GET", "/api/v1/x", {}, null, key, secret);
    expect(r).toMatchObject({ ok: false, code: 602 });
    expect(r.msg).toContain("Signature");
  });

  it("lee el saldo y convierte las posiciones de contratos a moneda base", async () => {
    const f = (async (url: any) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/account/asset/USDT")) return new Response(JSON.stringify({ success: true, code: 0, data: { currency: "USDT", availableBalance: 12.5 } }));
      if (u.pathname.endsWith("/position/open_positions")) return new Response(JSON.stringify({ success: true, code: 0, data: [{ positionId: 77, symbol: "BTC_USDT", positionType: 2, holdVol: 3 }] }));
      if (u.pathname.endsWith("/contract/detail")) return new Response(JSON.stringify({ success: true, code: 0, data: DETAIL }));
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    expect(await mxBalance(f, key, secret)).toMatchObject({ ok: true, available: 12.5 });
    const pos = await mxPositions(f, key, secret);
    expect(pos).toEqual([{ positionId: "77", symbol: "BTCUSDT", contractSymbol: "BTC_USDT", qty: 0.0003, vol: 3, side: "SHORT" }]);
  });
});

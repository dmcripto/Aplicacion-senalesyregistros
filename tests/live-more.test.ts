import { describe, expect, it } from "vitest";
import { LV_ADAPTERS, LV_PASS_SEP, lvSplit } from "../supabase/functions/_shared/liveMore";
import { LIVE_EXCHANGES, liveEx } from "../supabase/functions/_shared/liveExchange";
import type { BxSignal } from "../supabase/functions/_shared/bitunixTrade";

const sig = (o: Partial<BxSignal> = {}): BxSignal => ({ symbol: "BTCUSDT", direction: "LONG", entry: 85000, sl: 84150, tp: 86700, ...o });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

interface Call { method: string; url: URL; body: string; headers: Record<string, string> }
function fake(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { method: String(init.method ?? "GET"), url: new URL(url), body: String(init.body ?? ""), headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(c);
    return handler(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("registro de exchanges del bot real", () => {
  it("los 9 exchanges están registrados y cada uno devuelve su propio adaptador", () => {
    expect(LIVE_EXCHANGES).toEqual(["bitunix", "mexc", "binance", "bybit", "okx", "bitget", "bingx", "gate", "kucoin"]);
    for (const id of LIVE_EXCHANGES) expect(liveEx(id).id).toBe(id);
    expect(liveEx("kraken").id).toBe("bitunix");
  });
  it("la contraseña de la API viaja pegada a la secreta y se separa", () => {
    expect(lvSplit(`abc${LV_PASS_SEP}pw`)).toEqual(["abc", "pw"]);
    expect(lvSplit("abc")).toEqual(["abc", ""]);
  });
});

describe("cuerpos de orden", () => {
  const pair = { symbol: "BTCUSDT", minQty: 0.001, qtyDecimals: 3, maxLeverage: 20, priceDecimals: 1, contractSize: 0.01 };
  it("Bybit: mercado con stop y objetivo en la misma orden", () => {
    const b: any = LV_ADAPTERS.bybit.order(sig(), 0.003, "vx123", pair, 5);
    expect(b).toMatchObject({ side: "Buy", orderType: "Market", qty: "0.003", stopLoss: "84150", takeProfit: "86700", slTriggerBy: "MarkPrice" });
  });
  it("OKX: tamaño en contratos y stop/objetivo adjuntos", () => {
    const b: any = LV_ADAPTERS.okx.order(sig({ direction: "SHORT", sl: 86000, tp: 83000 }), 0.03, "vx1", pair, 5);
    expect(b).toMatchObject({ instId: "BTC-USDT-SWAP", side: "sell", sz: "3", tdMode: "isolated" });
    expect(b.attachAlgoOrds[0]).toMatchObject({ slTriggerPx: "86000", tpTriggerPx: "83000" });
  });
  it("Bitget y BingX llevan stop y objetivo junto con la orden", () => {
    const g: any = LV_ADAPTERS.bitget.order(sig(), 0.003, "vx1", pair, 5);
    expect(g).toMatchObject({ side: "buy", tradeSide: "open", presetStopLossPrice: "84150", presetStopSurplusPrice: "86700" });
    const x: any = LV_ADAPTERS.bingx.order(sig(), 0.003, "vx1", pair, 5);
    expect(x).toMatchObject({ symbol: "BTC-USDT", positionSide: "LONG", side: "BUY" });
    expect(JSON.parse(x.stopLoss).stopPrice).toBe(84150);
  });
  it("Gate: contratos con signo y dos órdenes de disparador aparte", () => {
    const b: any = LV_ADAPTERS.gate.order(sig({ direction: "SHORT", sl: 86000, tp: 83000 }), 0.03, "vx1", pair, 5);
    expect(b.size).toBe(-3);
    expect(b._after).toHaveLength(2);
    expect(b._after[0].trigger.rule).toBe(1); // stop de una venta: sube
  });
});

describe("si el stop no se puede colocar, la posición se cierra", () => {
  it("Gate", async () => {
    const { f, calls } = fake((c) => {
      if (c.url.pathname.endsWith("/orders")) return json({ id: 1 });
      if (c.url.pathname.endsWith("/price_orders")) return json({ label: "INVALID_PARAM", message: "mal" }, 400);
      return json({});
    });
    const body: any = LV_ADAPTERS.gate.order(sig(), 0.03, "vx1", { symbol: "BTCUSDT", minQty: 0.01, qtyDecimals: 2, maxLeverage: 20, priceDecimals: 1, contractSize: 0.01 }, 5);
    const r = await LV_ADAPTERS.gate.place(f, "K", "S", body);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("se cerró la posición");
    const closing = calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/orders")).map((c) => JSON.parse(c.body));
    expect(closing.at(-1)).toMatchObject({ size: 0, close: true });
  });
  it("Binance", async () => {
    const { f, calls } = fake((c) => {
      if (c.url.pathname === "/fapi/v1/order" && c.method === "POST") return json({ orderId: 1 });
      if (c.url.pathname === "/fapi/v1/algoOrder") return json({ code: -4120, msg: "mal" }, 400);
      return json({});
    });
    const body = LV_ADAPTERS.binance.order(sig(), 0.003, "vx1", { symbol: "BTCUSDT", minQty: 0.001, qtyDecimals: 3, maxLeverage: 20, priceDecimals: 1 }, 5);
    const r = await LV_ADAPTERS.binance.place(f, "K", "S", body);
    expect(r.ok).toBe(false);
    const closing = calls.find((c) => c.url.pathname === "/fapi/v1/order" && c.url.searchParams.get("reduceOnly") === "true");
    expect(closing?.url.searchParams.get("side")).toBe("SELL");
  });
});

describe("KuCoin", () => {
  const pair = { symbol: "BTCUSDT", minQty: 0.001, qtyDecimals: 3, maxLeverage: 20, priceDecimals: 1, contractSize: 0.001 };
  it("BTC se llama XBT, el tamaño va en lotes y el stop es una orden condicional", () => {
    const b: any = LV_ADAPTERS.kucoin.order(sig(), 0.003, "vx1", pair, 5);
    expect(b).toMatchObject({ symbol: "XBTUSDTM", side: "buy", size: 3, leverage: 5, marginMode: "ISOLATED" });
    expect(b._after[0]).toMatchObject({ stop: "down", stopPrice: "84150", closeOrder: true, side: "sell" });
    expect(b._after[1]).toMatchObject({ stop: "up", stopPrice: "86700" });
  });
  it("la contraseña se firma y el stop fallido cierra la posición", async () => {
    const { f, calls } = fake((c) => (c.body.includes('"stop"') ? json({ code: "400100", msg: "mal" }) : json({ code: "200000", data: {} })));
    const body = LV_ADAPTERS.kucoin.order(sig(), 0.003, "vx1", pair, 5);
    const r = await LV_ADAPTERS.kucoin.place(f, "K", `S${LV_PASS_SEP}PW`, body);
    expect(r.ok).toBe(false);
    expect(calls[0].headers["KC-API-KEY-VERSION"]).toBe("2");
    expect(calls[0].headers["KC-API-PASSPHRASE"]).not.toBe("PW");
    expect(calls.some((c) => c.body.includes('"closeOrder":true') && !c.body.includes('"stop"'))).toBe(true);
  });
});

describe("firmas y lectura básica", () => {
  it("Binance firma la consulta y lee el saldo", async () => {
    const { f, calls } = fake(() => json([{ asset: "USDT", availableBalance: "12.5" }]));
    const r = await LV_ADAPTERS.binance.balance(f, "KEY", "SECRET");
    expect(r).toMatchObject({ ok: true, available: 12.5 });
    expect(calls[0].url.searchParams.get("signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0].headers["X-MBX-APIKEY"]).toBe("KEY");
  });
  it("OKX usa el dominio europeo y prueba el global si la clave no es de ese entorno", async () => {
    const { f, calls } = fake((c) => (c.url.hostname === "eea.okx.com" ? json({ code: "50101", msg: "env" }) : json({ code: "0", data: [{ details: [{ ccy: "USDT", availBal: "7" }] }] })));
    const r = await LV_ADAPTERS.okx.balance(f, "KEY", `SEC${LV_PASS_SEP}PW`);
    expect(r).toMatchObject({ ok: true, available: 7 });
    expect(calls.map((c) => c.url.hostname)).toEqual(["eea.okx.com", "www.okx.com"]);
    expect(calls[0].headers["OK-ACCESS-PASSPHRASE"]).toBe("PW");
  });
  it("Bybit lee reglas del par", async () => {
    const { f } = fake(() => json({ retCode: 0, result: { list: [{ lotSizeFilter: { minOrderQty: "0.001", qtyStep: "0.001" }, priceFilter: { tickSize: "0.10" }, leverageFilter: { maxLeverage: "100.00" } }] } }));
    const p = await LV_ADAPTERS.bybit.pair(f, "K", "S", "BTCUSDT");
    expect(p).toMatchObject({ minQty: 0.001, qtyStep: 0.001, qtyDecimals: 3, priceDecimals: 1, maxLeverage: 100 });
  });
  it("sin conexión nunca lanza", async () => {
    const f = (async () => { throw new Error("red"); }) as unknown as typeof fetch;
    for (const a of Object.values(LV_ADAPTERS)) expect((await a.balance(f, "K", "S")).ok).toBe(false);
  });
});

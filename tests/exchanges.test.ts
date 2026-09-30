import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as ex from "../supabase/functions/_shared/exchanges";
import { resultR } from "../packages/core/src/trading";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("firmas", () => {
  it("Binance: ejemplo oficial de su documentación", async () => {
    const q = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    expect(await ex.binanceSign(q, secret)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });
  it("Bybit v5: timestamp + apiKey + recvWindow + query", async () => {
    const sig = await ex.bybitSign("1658384314791", "KEY", "5000", "category=linear&limit=100", "secret123");
    expect(sig).toBe(createHmac("sha256", "secret123").update("1658384314791KEY5000category=linear&limit=100").digest("hex"));
  });
});

describe("cifrado de la clave secreta", () => {
  it("ida y vuelta, y falla con otra clave maestra", async () => {
    const packed = await ex.encryptSecret("mi-secreto-👍", "clave-maestra-larga");
    expect(packed).not.toContain("mi-secreto");
    expect(await ex.decryptSecret(packed, "clave-maestra-larga")).toBe("mi-secreto-👍");
    await expect(ex.decryptSecret(packed, "otra-clave")).rejects.toBeTruthy();
  });
  it("cada cifrado usa un valor aleatorio distinto", async () => {
    expect(await ex.encryptSecret("x", "clave-maestra-larga")).not.toBe(await ex.encryptSecret("x", "clave-maestra-larga"));
  });
});

const f = (id: number, time: number, side: "BUY" | "SELL", price: number, qty: number, realizedPnl = 0, positionSide = "BOTH") =>
  ({ id, symbol: "BTCUSDT", side, positionSide, price, qty, realizedPnl, commission: 0.1, commissionAsset: "USDT", time });

describe("posiciones de Binance desde las ejecuciones", () => {
  it("largo con promedio de entrada y comisiones", () => {
    const [p] = ex.buildPositions([f(1, 1, "BUY", 100, 1), f(2, 2, "BUY", 110, 1), f(3, 3, "SELL", 120, 2, 30)]);
    expect(p).toMatchObject({ direction: "LONG", entry: 105, exit: 120, qty: 2, externalId: "BTCUSDT:BOTH:3" });
    expect(p.pnl).toBeCloseTo(29.7);
  });
  it("corto con cierre parcial", () => {
    const [p] = ex.buildPositions([f(1, 1, "SELL", 200, 2), f(2, 2, "BUY", 190, 1, 10), f(3, 3, "BUY", 180, 1, 20)]);
    expect(p).toMatchObject({ direction: "SHORT", exit: 185 });
  });
  it("cruce de cero: cierra el largo y abre un corto", () => {
    const p = ex.buildPositions([f(1, 1, "BUY", 100, 1), f(2, 2, "SELL", 110, 3, 10), f(3, 3, "BUY", 105, 2, 10)]);
    expect(p.map((x) => x.direction)).toEqual(["LONG", "SHORT"]);
    expect(p[1]).toMatchObject({ entry: 110, qty: 2 });
  });
  it("ignora cierres de posiciones anteriores al período y posiciones aún abiertas", () => {
    expect(ex.buildPositions([f(1, 1, "SELL", 120, 1, 15), f(2, 2, "BUY", 100, 1), f(3, 3, "BUY", 101, 1)])).toHaveLength(0);
  });
  it("modo cobertura: dos posiciones independientes", () => {
    const p = ex.buildPositions([f(1, 1, "BUY", 100, 1, 0, "LONG"), f(2, 2, "SELL", 50, 1, 0, "SHORT"), f(3, 3, "SELL", 110, 1, 10, "LONG"), f(4, 4, "BUY", 45, 1, 5, "SHORT")]);
    expect(p.map((x) => x.direction).sort()).toEqual(["LONG", "SHORT"]);
  });
});

describe("Bybit y conversión a R", () => {
  it("interpreta el lado de la orden que cierra", () => {
    const [p] = ex.parseBybitClosed([{ symbol: "XRPUSDT", side: "Sell", orderId: "o1", closedPnl: "-0.0005", avgEntryPrice: "0.6045", avgExitPrice: "0.605", closedSize: "3", createdTime: "1", updatedTime: "2" }]);
    expect(p).toMatchObject({ direction: "LONG", externalId: "XRPUSDT:o1" });
    expect(ex.parseBybitClosed([{ symbol: "X", side: "Buy", avgEntryPrice: "0", avgExitPrice: "1", closedSize: "1" }])).toHaveLength(0);
  });

  it("el R del diario coincide con el dinero neto real", () => {
    const cases: Array<[ex.ClosedPosition, number]> = [
      [{ externalId: "a", symbol: "btcusdt", direction: "LONG", qty: 0.5, entry: 65000, exit: 66000, pnl: 480, openedAt: 1e12, closedAt: 1e12 + 36e5 }, 100],
      [{ externalId: "b", symbol: "ETHUSDT", direction: "SHORT", qty: 2, entry: 3000, exit: 3050, pnl: -101, openedAt: 1e12, closedAt: 1e12 + 36e5 }, 50],
    ];
    for (const [pos, unit] of cases) {
      const row = ex.toTradeRow(pos, "bybit", unit);
      const r = resultR({ id: "x", symbol: row.symbol, direction: row.direction, entry: row.entry, tp: row.tp, sl: row.sl, date: row.date, outcome: "MANUAL", exit: row.exit, closedAt: row.closed_at });
      expect(r).toBeCloseTo(pos.pnl / unit, 6);
      expect(row.source).toBe("bybit");
    }
  });
});

describe("verificación de claves y flujo con un exchange simulado", () => {
  const fake = (async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.pathname === "/v5/user/query-api") return json({ retCode: 0, result: { readOnly: 1 } });
    if (u.pathname === "/v5/position/closed-pnl") {
      expect(init.headers["X-BAPI-SIGN"]).toBeTruthy();
      return json({ retCode: 0, result: { nextPageCursor: "", list: [{ symbol: "XRPUSDT", side: "Buy", orderId: "o1", closedPnl: "5", avgEntryPrice: "0.6", avgExitPrice: "0.59", closedSize: "50", createdTime: "1712717265566", updatedTime: "1712717265572" }] } });
    }
    if (u.pathname === "/sapi/v1/account/apiRestrictions") return json({ enableReading: true });
    if (u.pathname === "/fapi/v2/balance") return json([]);
    if (u.pathname === "/fapi/v1/income") return json([{ symbol: "BTCUSDT" }]);
    if (u.pathname === "/fapi/v1/userTrades") {
      expect(u.searchParams.get("signature")).toBeTruthy();
      return json([
        { id: 1, symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: "100", qty: "1", realizedPnl: "0", commission: "0.1", commissionAsset: "USDT", time: Date.now() - 36e5 },
        { id: 2, symbol: "BTCUSDT", side: "SELL", positionSide: "BOTH", price: "110", qty: "1", realizedPnl: "10", commission: "0.1", commissionAsset: "USDT", time: Date.now() - 18e5 },
      ]);
    }
    return json({ code: -2015 }, 401);
  }) as unknown as typeof fetch;

  it("claves de solo lectura se aceptan y se traen las operaciones", async () => {
    expect(await ex.checkKey("bybit", "K", "S", fake)).toEqual({ ok: true });
    expect((await ex.checkKey("binance", "K", "S", fake)).ok).toBe(true);
    const by = await ex.fetchClosed("bybit", "K", "S", Date.now() - 3 * 864e5, undefined, fake);
    expect(by).toHaveLength(1);
    const bn = await ex.fetchClosed("binance", "K", "S", Date.now() - 3 * 864e5, undefined, fake);
    expect(bn[0].pnl).toBeCloseTo(9.8);
  });

  it("rechaza claves que permiten operar o retirar", async () => {
    const withdraw = (async () => json({ enableWithdrawals: true })) as unknown as typeof fetch;
    expect((await ex.checkKey("binance", "K", "S", withdraw)).ok).toBe(false);
    const trading = (async () => json({ retCode: 0, result: { readOnly: 0 } })) as unknown as typeof fetch;
    const r = await ex.checkKey("bybit", "K", "S", trading);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SOLO LECTURA/);
  });

  it("errores de red, región y clave se explican en español", async () => {
    expect((await ex.checkKey("binance", "K", "S", (async () => json({ code: -2015 }, 401)) as unknown as typeof fetch)).error).toMatch(/rechazó la clave/);
    expect((await ex.checkKey("bybit", "K", "S", (async () => new Response("x", { status: 403 })) as unknown as typeof fetch)).error).toMatch(/bloqueo/);
    expect((await ex.checkKey("bybit", "K", "S", (async () => { throw new Error("red"); }) as unknown as typeof fetch)).error).toMatch(/No se pudo conectar/);
  });

  it("clave de solo lectura sin permiso de billetera: cae al chequeo de posiciones con aviso", async () => {
    const noWallet = (async (url: any) => (new URL(String(url)).pathname === "/v5/user/query-api" ? json({ retCode: 10005, retMsg: "Permission denied" }) : json({ retCode: 0, result: { list: [] } }))) as unknown as typeof fetch;
    const r = await ex.checkKey("bybit", "K", "S", noWallet);
    expect(r.ok).toBe(true);
    expect(r.warning).toBeTruthy();
  });

  it("las consultas se reparten en ventanas de 7 días", () => {
    expect(ex.windows(0, 20 * 864e5)).toHaveLength(3);
  });
});

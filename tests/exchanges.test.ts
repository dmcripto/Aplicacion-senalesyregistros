import { createHash, createHmac } from "node:crypto";
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

describe("Bitunix", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  it("firma: doble sha256 con parámetros ordenados como clave+valor", async () => {
    const sig = await ex.bitunixSign("N0NCE", "1700000000000", "KEY", { skip: 0, limit: 100, endTime: 5, startTime: 1 }, "SECRET");
    expect(sig).toBe(sha(sha("N0NCE" + "1700000000000" + "KEY" + "endTime5limit100skip0startTime1") + "SECRET"));
  });

  const list = [
    { positionId: "p1", symbol: "BTCUSDT", maxQty: "0.5", entryPrice: "65000", closePrice: "66000", side: "LONG", fee: "1.5", funding: "-0.5", realizedPNL: "500", ctime: "1712717265566", mtime: "1712720865566" },
    { positionId: "p2", symbol: "ETHUSDT", maxQty: "2", entryPrice: "3000", closePrice: "3050", side: "SHORT", fee: "-1", funding: "0", realizedPNL: "-100", ctime: "1712717265566", mtime: "1712720865566" },
    { positionId: "p3", symbol: "XRPUSDT", maxQty: "0", entryPrice: "1", closePrice: "1", side: "LONG", realizedPNL: "0", mtime: "1" },
  ];

  it("toma el realizedPNL tal cual, que ya viene neto de comisiones", () => {
    const rows = ex.parseBitunixClosed(list);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ externalId: "BTCUSDT:p1", direction: "LONG", qty: 0.5, entry: 65000, exit: 66000, pnl: 500, closedAt: 1712720865566, openedAt: 1712717265566 });
    expect(rows[1]).toMatchObject({ direction: "SHORT", pnl: -100 });
    expect(ex.toTradeRow(rows[0], "bitunix", 10).notes).toMatch(/Bitunix informó: realizedPNL 500 · fee 1.5 · funding -0.5/);
  });

  it("operación real de Bitunix: precio −0,2088 y comisiones 0,1555 dan −0,3643", () => {
    const [p] = ex.parseBitunixClosed([{ positionId: "r1", symbol: "BTCUSDT", maxQty: "0.0015", entryPrice: "86318.1", closePrice: "86457.3", side: "SHORT", fee: "0.15549786", funding: "0", realizedPNL: "-0.36429786", ctime: "1759604928000", mtime: "1759608520000" }]);
    expect(p.pnl).toBeCloseTo(-0.36429786, 8);
    // coincide con el dinero real: −(86457,3 − 86318,1) × 0,0015 − comisiones
    expect(p.pnl).toBeCloseTo(-(86457.3 - 86318.1) * 0.0015 - 0.15549786, 6);
  });

  it("verifica la clave, pide por páginas y avisa que no puede confirmar permisos", async () => {
    const seen: string[] = [];
    const fake = (async (url: any, init: any) => {
      const u = new URL(String(url));
      expect(u.origin + u.pathname).toBe("https://fapi.bitunix.com/api/v1/futures/position/get_history_positions");
      expect(init.headers["api-key"]).toBe("KEY");
      expect(init.headers.nonce).toHaveLength(32);
      seen.push(u.searchParams.get("skip") ?? "-");
      const skip = Number(u.searchParams.get("skip") ?? 0);
      const many = Array.from({ length: 100 }, (_, i) => ({ ...list[0], positionId: `a${skip + i}` }));
      return json({ code: 0, msg: "Success", data: { positionList: skip === 0 && u.searchParams.has("startTime") ? many : [list[1]] } });
    }) as unknown as typeof fetch;
    const check = await ex.checkKey("bitunix", "KEY", "SECRET", fake);
    expect(check.ok).toBe(true);
    expect(check.warning).toMatch(/SOLO LECTURA/);
    const got = await ex.fetchClosed("bitunix", "KEY", "SECRET", Date.now() - 864e5, undefined, fake);
    expect(got).toHaveLength(101);
    expect(seen.slice(-2)).toEqual(["0", "100"]);
  });

  it("explica los errores en español", async () => {
    const err = (code: number, status = 200) => (async () => json({ code, msg: "x" }, status)) as unknown as typeof fetch;
    expect((await ex.checkKey("bitunix", "K", "S", err(10007))).error).toMatch(/no aceptó la clave/);
    expect((await ex.checkKey("bitunix", "K", "S", err(10004))).error).toMatch(/restricción de IP/);
    expect((await ex.checkKey("bitunix", "K", "S", err(10006))).error).toMatch(/limitó/);
  });
});

describe("MEXC", () => {
  it("firma: HMAC-SHA256 de apiKey + timestamp + parámetros", async () => {
    expect(await ex.mexcSign("KEY", "1700000000000", "page_num=1&page_size=100", "SECRET")).toBe(
      createHmac("sha256", "SECRET").update("KEY1700000000000page_num=1&page_size=100").digest("hex"),
    );
  });

  // Ejemplo con la forma real de la respuesta de MEXC (tamaño en contratos).
  const rvn = { positionId: "390281084", symbol: "RVN_USDT", positionType: "1", state: "3", closeVol: "1141", openAvgPrice: "0.03491", closeAvgPrice: "0.03494", realised: "0.1829", closeProfitLoss: "0.3423", fee: "0.1594", createTime: "1711512408000", updateTime: "1711512553000" };

  it("convierte contratos a moneda base y toma el resultado neto", () => {
    const [p] = ex.parseMexcClosed([rvn], { RVN_USDT: 10 });
    expect(p).toMatchObject({ externalId: "RVN_USDT:390281084", symbol: "RVNUSDT", direction: "LONG", qty: 11410, entry: 0.03491, exit: 0.03494, pnl: 0.1829, closedAt: 1711512553000 });
  });

  it("si no se conoce el valor del contrato, deduce el tamaño del resultado bruto", () => {
    const [p] = ex.parseMexcClosed([rvn], {});
    expect(p.qty).toBeCloseTo(11410, 0);
  });

  it("ignora posiciones abiertas y las de lado desconocido", () => {
    expect(ex.parseMexcClosed([{ ...rvn, state: "1" }, { ...rvn, positionType: "9" }], { RVN_USDT: 10 })).toHaveLength(0);
    expect(ex.parseMexcClosed([{ ...rvn, positionType: "2", closeAvgPrice: "0.0349" }], { RVN_USDT: 10 })[0].direction).toBe("SHORT");
  });

  const fake = (async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/v1/contract/detail") return json({ success: true, code: 0, data: { symbol: u.searchParams.get("symbol"), contractSize: 10 } });
    expect(u.pathname).toBe("/api/v1/private/position/list/history_positions");
    expect(init.headers.ApiKey).toBe("KEY");
    expect(init.headers["Request-Time"]).toBeTruthy();
    const ts = init.headers["Request-Time"];
    expect(init.headers.Signature).toBe(createHmac("sha256", "SECRET").update("KEY" + ts + u.search.slice(1)).digest("hex"));
    const old = { ...rvn, positionId: "old", updateTime: "1000", createTime: "500" };
    return json({ success: true, code: 0, data: [{ ...rvn, updateTime: String(Date.now() - 36e5), createTime: String(Date.now() - 72e5) }, old] });
  }) as unknown as typeof fetch;

  it("pide el historial, deja afuera lo anterior al período y pide el valor del contrato", async () => {
    const check = await ex.checkKey("mexc", "KEY", "SECRET", fake);
    expect(check.ok).toBe(true);
    expect(check.warning).toMatch(/SOLO LECTURA/);
    const got = await ex.fetchClosed("mexc", "KEY", "SECRET", Date.now() - 864e5, undefined, fake);
    expect(got).toHaveLength(1);
    expect(got[0].qty).toBe(11410);
  });

  it("explica los errores en español", async () => {
    const err = (code: number, status = 200) => (async () => json({ success: false, code, message: "x" }, status)) as unknown as typeof fetch;
    expect((await ex.checkKey("mexc", "K", "S", err(602))).error).toMatch(/no aceptó la clave/);
    expect((await ex.checkKey("mexc", "K", "S", err(10073))).error).toMatch(/reloj/);
    expect((await ex.checkKey("mexc", "K", "S", err(401, 401))).error).toMatch(/permiso para leer Futuros/);
  });

  it("el diario muestra el nombre del exchange y el R coincide con el dinero", () => {
    const [p] = ex.parseMexcClosed([rvn], { RVN_USDT: 10 });
    const row = ex.toTradeRow(p, "mexc", 0.5);
    expect(row.source).toBe("mexc");
    expect(row.notes).toMatch(/^MEXC · /);
    const r = resultR({ id: "x", symbol: row.symbol, direction: row.direction, entry: row.entry, tp: row.tp, sl: row.sl, date: row.date, outcome: "MANUAL", exit: row.exit, closedAt: row.closed_at });
    expect(r).toBeCloseTo(p.pnl / 0.5, 6);
  });
});

describe("Gate", () => {
  const sha512 = (s: string) => createHash("sha512").update(s).digest("hex");
  it("firma: HMAC-SHA512 de método, ruta, query, sha512 del cuerpo vacío y timestamp", async () => {
    const sig = await ex.gateSign("GET", "/api/v4/futures/usdt/position_close", "limit=100&offset=0", "1700000000", "SECRET");
    expect(sig).toBe(createHmac("sha512", "SECRET").update(["GET", "/api/v4/futures/usdt/position_close", "limit=100&offset=0", sha512(""), "1700000000"].join("\n")).digest("hex"));
  });

  // Ejemplo con la forma real de la respuesta de Gate (tamaño en contratos).
  const long = { contract: "SLERF_USDT", side: "long", long_price: "0.766306", short_price: "0.539119", pnl: "-23.41702352", pnl_pnl: "-22.7187", pnl_fee: "-0.06527125", pnl_fund: "-0.63305227", max_size: "100", accum_size: "100", time: 1711279263, first_open_time: 1711037985 };
  const short = { ...long, side: "short", contract: "BTC_USDT", short_price: "65000", long_price: "64000", pnl: "9.5", pnl_pnl: "10", max_size: "100", time: 1711279999 };

  it("convierte contratos y toma entrada y salida según el lado", () => {
    const [a, b] = ex.parseGateClosed([long, short], { SLERF_USDT: 1, BTC_USDT: 0.0001 });
    expect(a).toMatchObject({ symbol: "SLERFUSDT", direction: "LONG", qty: 100, entry: 0.766306, exit: 0.539119, pnl: -23.41702352, closedAt: 1711279263000, openedAt: 1711037985000 });
    // en el corto, short_price es la entrada y long_price la salida
    expect(b).toMatchObject({ direction: "SHORT", entry: 65000, exit: 64000, qty: 0.01 });
  });

  it("sin el valor del contrato deduce el tamaño del resultado de precio", () => {
    const [a] = ex.parseGateClosed([long], {});
    expect(a.qty).toBeCloseTo(100, 0);
  });

  it("pide por páginas y explica los errores", async () => {
    const offsets: string[] = [];
    const fake = (async (url: any, init: any) => {
      const u = new URL(String(url));
      if (u.pathname.includes("/contracts/")) return json({ quanto_multiplier: "1" });
      expect(init.headers.KEY).toBe("KEY");
      expect(init.headers.SIGN).toHaveLength(128);
      const off = Number(u.searchParams.get("offset"));
      offsets.push(String(off));
      return json(off === 0 ? Array.from({ length: 100 }, (_, i) => ({ ...long, first_open_time: 1000 + i })) : [short]);
    }) as unknown as typeof fetch;
    expect((await ex.checkKey("gate", "KEY", "SECRET", fake)).warning).toMatch(/SOLO LECTURA/);
    const got = await ex.fetchClosed("gate", "KEY", "SECRET", Date.now() - 864e5, undefined, fake);
    expect(got).toHaveLength(101);
    expect(offsets.slice(-2)).toEqual(["0", "100"]);
    const err = (label: string) => (async () => json({ label, message: "x" }, 401)) as unknown as typeof fetch;
    expect((await ex.checkKey("gate", "K", "S", err("INVALID_KEY"))).error).toMatch(/no aceptó la clave/);
    expect((await ex.checkKey("gate", "K", "S", err("IP_FORBIDDEN"))).error).toMatch(/restricción de IP/);
    expect((await ex.checkKey("gate", "K", "S", err("FORBIDDEN"))).error).toMatch(/permiso para leer Futuros/);
  });
});

describe("Bitget", () => {
  it("firma: HMAC-SHA256 en base64 de timestamp + método + ruta + query", async () => {
    const sig = await ex.bitgetSign("1700000000000", "GET", "/api/v2/mix/position/history-position?limit=1&productType=USDT-FUTURES", "SECRET");
    expect(sig).toBe(createHmac("sha256", "SECRET").update("1700000000000GET/api/v2/mix/position/history-position?limit=1&productType=USDT-FUTURES").digest("base64"));
  });

  const row = { symbol: "XRPUSDT", marginCoin: "USDT", holdSide: "long", openAvgPrice: "0.64967", closeAvgPrice: "0.58799", openTotalPos: "10", closeTotalPos: "10", pnl: "-0.62976205", netProfit: "-0.65356802", totalFunding: "-0.01638", openFee: "-0.00389802", closeFee: "-0.00352794", ctime: "1709590322199", utime: "1709667583395" };

  it("usa el resultado neto y el tamaño en moneda base", () => {
    const [p] = ex.parseBitgetClosed([row, { ...row, holdSide: "short", openAvgPrice: "0", netProfit: "1" }]);
    expect(p).toMatchObject({ symbol: "XRPUSDT", direction: "LONG", qty: 10, entry: 0.64967, exit: 0.58799, pnl: -0.65356802, closedAt: 1709667583395, openedAt: 1709590322199 });
    expect(p.externalId).toBe("XRPUSDT:long:1709590322199");
  });

  it("exige la contraseña de la API, la envía y explica los errores", async () => {
    expect((await ex.checkKey("bitget", "K", "S", undefined, "")).error).toMatch(/contraseña de la API/);
    const fake = (async (url: any, init: any) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/api/v2/mix/position/history-position");
      expect(init.headers["ACCESS-PASSPHRASE"]).toBe("PASS");
      expect(init.headers["ACCESS-KEY"]).toBe("KEY");
      const ts = init.headers["ACCESS-TIMESTAMP"];
      expect(init.headers["ACCESS-SIGN"]).toBe(createHmac("sha256", "SECRET").update(ts + "GET" + u.pathname + u.search).digest("base64"));
      return json({ code: "00000", msg: "success", data: { list: [row], endId: "" } });
    }) as unknown as typeof fetch;
    expect((await ex.checkKey("bitget", "KEY", "SECRET", fake, "PASS")).ok).toBe(true);
    expect(await ex.fetchClosed("bitget", "KEY", "SECRET", Date.now() - 864e5, undefined, fake, "PASS")).toHaveLength(1);
    const err = (code: string) => (async () => json({ code, msg: "x" })) as unknown as typeof fetch;
    expect((await ex.checkKey("bitget", "K", "S", err("40012"), "P")).error).toMatch(/contraseña de la API/);
    expect((await ex.checkKey("bitget", "K", "S", err("40014"), "P")).error).toMatch(/permiso para leer Futuros/);
  });
});

describe("OKX", () => {
  it("firma: HMAC-SHA256 en base64 de timestamp + método + ruta + query", async () => {
    const sig = await ex.okxSign("2024-01-01T00:00:00.000Z", "GET", "/api/v5/account/positions-history?instType=SWAP&limit=100", "SECRET");
    expect(sig).toBe(createHmac("sha256", "SECRET").update("2024-01-01T00:00:00.000ZGET/api/v5/account/positions-history?instType=SWAP&limit=100").digest("base64"));
  });

  // Ejemplo real de la documentación: realizedPnl = pnl + fee + fundingFee.
  const sushi = { cTime: "1708351230102", closeAvgPx: "1.2567", closeTotalPos: "40", direction: "short", fee: "-0.0351036", fundingFee: "0", instId: "SUSHI-USDT-SWAP", instType: "SWAP", openAvgPx: "1.2462", openMaxPos: "40", pnl: "-0.42", posId: "666159086676836352", realizedPnl: "-0.4551036", type: "2", uTime: "1708354805699" };

  it("toma el resultado neto y convierte contratos con su valor", () => {
    const [p] = ex.parseOkxClosed([sushi], { "SUSHI-USDT-SWAP": 1 });
    expect(p).toMatchObject({ externalId: "SUSHI-USDT-SWAP:666159086676836352", symbol: "SUSHIUSDT", direction: "SHORT", qty: 40, entry: 1.2462, exit: 1.2567, pnl: -0.4551036 });
    const [q] = ex.parseOkxClosed([{ ...sushi, instId: "BTC-USDT-SWAP", closeTotalPos: "100" }], { "BTC-USDT-SWAP": 0.01 });
    expect(q.qty).toBe(1);
    expect(q.symbol).toBe("BTCUSDT");
  });

  it("en modo neto deduce el lado del precio y del resultado", () => {
    const net = { ...sushi, direction: "net" };
    expect(ex.parseOkxClosed([net], {})[0].direction).toBe("SHORT"); // subió el precio y perdió
    expect(ex.parseOkxClosed([{ ...net, closeAvgPx: "1.2", pnl: "0.2" }], {})[0].direction).toBe("SHORT"); // bajó el precio y ganó
    expect(ex.parseOkxClosed([{ ...net, closeAvgPx: "1.3", pnl: "0.2" }], {})[0].direction).toBe("LONG");
    expect(ex.parseOkxClosed([net], {})[0].qty).toBeCloseTo(40, 0);
  });

  const okx = (perm: string) => (async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/v5/public/instruments") return json({ code: "0", data: [{ ctVal: "1", ctMult: "1" }] });
    expect(init.headers["OK-ACCESS-PASSPHRASE"]).toBe("PASS");
    if (u.pathname === "/api/v5/account/config") return json({ code: "0", data: [{ perm }] });
    expect(u.pathname).toBe("/api/v5/account/positions-history");
    return json({ code: "0", data: u.searchParams.get("instType") === "SWAP" ? [{ ...sushi, uTime: String(Date.now() - 36e5) }] : [] });
  }) as unknown as typeof fetch;

  it("acepta claves de solo lectura y rechaza las que operan o retiran", async () => {
    expect((await ex.checkKey("okx", "K", "S", okx("read_only"), "PASS")).ok).toBe(true);
    expect((await ex.checkKey("okx", "K", "S", okx("read_only,trade"), "PASS")).error).toMatch(/SOLO LECTURA/);
    expect((await ex.checkKey("okx", "K", "S", okx("read_only,withdraw"), "PASS")).ok).toBe(false);
    expect((await ex.checkKey("okx", "K", "S", okx("read_only"), "")).error).toMatch(/contraseña de la API/);
  });

  it("trae las posiciones de perpetuos y futuros dentro del período", async () => {
    const got = await ex.fetchClosed("okx", "K", "S", Date.now() - 864e5, undefined, okx("read_only"), "PASS");
    expect(got).toHaveLength(1);
    expect(got[0].qty).toBe(40);
  });

  it("explica los errores en español", async () => {
    const err = (code: string) => (async () => json({ code, msg: "x" })) as unknown as typeof fetch;
    expect((await ex.checkKey("okx", "K", "S", err("50105"), "P")).error).toMatch(/contraseña de la API/);
    expect((await ex.checkKey("okx", "K", "S", err("50110"), "P")).error).toMatch(/restricción de IP/);
  });
});

describe("KuCoin", () => {
  it("firma y contraseña: HMAC-SHA256 en base64", async () => {
    const sig = await ex.kucoinSign("1700000000000", "GET", "/api/v1/history-positions?limit=1", "SECRET");
    expect(sig).toBe(createHmac("sha256", "SECRET").update("1700000000000GET/api/v1/history-positions?limit=1").digest("base64"));
  });

  // Ejemplo de la documentación: pnl = (cierre − apertura) × tamaño − comisión + funding.
  const btc = { closeId: "500000000036305465", symbol: "XBTUSDTM", settleCurrency: "USDT", leverage: "1.0", type: "CLOSE_LONG", pnl: "0.51214413", realisedGrossCost: "-0.5837", tradeFee: "0.03766066", fundingFee: "-0.03389521", openTime: 1735549162120, closeTime: 1735589352069, openPrice: "93859.8", closePrice: "94443.5" };

  it("el resultado ya viene neto y el lado sale del tipo de cierre", () => {
    const [p] = ex.parseKucoinClosed([btc, { ...btc, closeId: "2", type: "CLOSE_SHORT", closeSize: 1 }], { XBTUSDTM: 0.001 });
    expect(p).toMatchObject({ externalId: "XBTUSDTM:500000000036305465", symbol: "BTCUSDT", direction: "LONG", entry: 93859.8, exit: 94443.5, pnl: 0.51214413, closedAt: 1735589352069 });
    expect(p.qty).toBeCloseTo(0.001, 6); // deducido del resultado bruto
    const [, q] = ex.parseKucoinClosed([btc, { ...btc, closeId: "2", type: "CLOSE_SHORT", closeSize: 1 }], { XBTUSDTM: 0.001 });
    expect(q).toMatchObject({ direction: "SHORT", qty: 0.001 });
  });

  it("exige la contraseña, la firma al enviarla y explica los errores", async () => {
    expect((await ex.checkKey("kucoin", "K", "S", undefined, "")).error).toMatch(/contraseña de la API/);
    const fake = (async (url: any, init: any) => {
      const u = new URL(String(url));
      if (u.pathname.startsWith("/api/v1/contracts/")) return json({ code: "200000", data: { multiplier: 0.001 } });
      expect(init.headers["KC-API-KEY-VERSION"]).toBe("2");
      expect(init.headers["KC-API-PASSPHRASE"]).toBe(createHmac("sha256", "SECRET").update("PASS").digest("base64"));
      const ts = init.headers["KC-API-TIMESTAMP"];
      expect(init.headers["KC-API-SIGN"]).toBe(createHmac("sha256", "SECRET").update(ts + "GET" + u.pathname + u.search).digest("base64"));
      return json({ code: "200000", data: { currentPage: 1, totalPage: 1, items: [btc] } });
    }) as unknown as typeof fetch;
    expect((await ex.checkKey("kucoin", "KEY", "SECRET", fake, "PASS")).warning).toMatch(/SOLO LECTURA/);
    expect(await ex.fetchClosed("kucoin", "KEY", "SECRET", Date.now() - 864e5, undefined, fake, "PASS")).toHaveLength(1);
    const err = (code: string) => (async () => json({ code, msg: "x" }, 400)) as unknown as typeof fetch;
    expect((await ex.checkKey("kucoin", "K", "S", err("400004"), "P")).error).toMatch(/contraseña de la API/);
    expect((await ex.checkKey("kucoin", "K", "S", err("400006"), "P")).error).toMatch(/restricción de IP/);
  });
});

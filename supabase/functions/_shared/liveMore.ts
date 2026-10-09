// ─── VELTRIX · Bot real: Binance, Bybit, OKX, Bitget, BingX, Gate y KuCoin (futuros USDT) ──────────────
// Igual que Bitunix y MEXC: esto SÍ opera con dinero, solo se usa desde la función «trade», con la clave con permiso de
// operar de la persona, con los topes de bot_live y empezando siempre en «prueba en seco».
// Las documentaciones no se pudieron consultar al escribirlo: por eso la primera orden real es una orden mínima de prueba,
// confirmada a mano, que se cierra enseguida; recién si sale bien se habilita el modo automático.
// Si el stop o el objetivo no se pueden colocar junto con la orden (Binance y Gate los piden aparte), la posición se cierra
// al instante: nunca queda una posición abierta sin stop.
// OKX y Bitget piden además una contraseña de la API (passphrase): se guarda junto a la clave secreta separada por \u0001.

import type { BxPair, BxSignal } from "./bitunixTrade.ts";

type FetchFn = typeof fetch;

export interface LvReply {
  ok: boolean;
  msg: string;
  code: number | null;
  data?: unknown;
}
export interface LvPos {
  symbol: string;
  qty: number;
  positionId: string;
  raw: any;
}
export type LvPair = BxPair & { contractSize?: number };
export interface LvAdapter {
  balance(f: FetchFn, key: string, secret: string): Promise<{ ok: boolean; available: number; msg: string; code: number | null }>;
  pair(f: FetchFn, key: string, secret: string, symbol: string): Promise<LvPair | null>;
  positions(f: FetchFn, key: string, secret: string): Promise<LvPos[] | null>;
  setup(f: FetchFn, key: string, secret: string, symbol: string, leverage: number): Promise<string[]>;
  order(sig: BxSignal, qty: number, clientId: string, pair: LvPair, leverage: number): Record<string, unknown>;
  place(f: FetchFn, key: string, secret: string, body: Record<string, unknown>): Promise<LvReply>;
  close(f: FetchFn, key: string, secret: string, pos: LvPos): Promise<LvReply>;
  cancelAll(f: FetchFn, key: string, secret: string): Promise<LvReply>;
}

/** Exchanges que piden contraseña de la API; se guarda pegada a la clave secreta. */
export const LV_PASS_SEP = "\u0001";
export const lvSplit = (packed: string): [string, string] => {
  const i = packed.indexOf(LV_PASS_SEP);
  return i < 0 ? [packed, ""] : [packed.slice(0, i), packed.slice(i + 1)];
};

const lvN = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};
const lvDec = (x: number) => {
  if (!(x > 0)) return 0;
  const s = x.toFixed(12).replace(/0+$/, "");
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};
const lvQs = (params: Record<string, string | number>) => Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
const lvSorted = (params: Record<string, string | number>) => Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as Record<string, string | number>;
const lvEnc = new TextEncoder();
const lvHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const lvB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
async function lvHmac(secret: string, msg: string, hash: "SHA-256" | "SHA-512"): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", lvEnc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, lvEnc.encode(msg));
}
const lvSha512 = async (t: string) => lvHex(await crypto.subtle.digest("SHA-512", lvEnc.encode(t)));
const lvId = (s: string, max: number) => s.replace(/[^a-zA-Z0-9]/g, "").slice(0, max);
const lvPx = (v: number, d: number | null | undefined) => (d == null ? v : Number(v.toFixed(d)));
const lvNoConn = (name: string): LvReply => ({ ok: false, msg: `No se pudo conectar con ${name}.`, code: null });
const lvOpp = (sig: BxSignal) => (sig.direction === "LONG" ? "SELL" : "BUY");

interface Raw {
  status: number;
  j: any;
  text: string;
}
/** Un pedido que nunca lanza: null = no se pudo conectar. */
async function lvFetch(f: FetchFn, url: string, init: RequestInit): Promise<Raw | null> {
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* no era JSON */
    }
    return { status: res.status, j, text };
  } catch {
    return null;
  }
}
const lvBad = (r: Raw) => r.j === null && r.text ? r.text.slice(0, 120) : "";

// ─── Bybit (v5, lineales) ───────────────────────────────────────────────────

async function byCall(f: FetchFn, method: "GET" | "POST", path: string, params: Record<string, string | number>, body: unknown, key: string, secret: string): Promise<LvReply> {
  const query = lvQs(params);
  const bodyStr = body ? JSON.stringify(body) : "";
  const ts = String(Date.now());
  const sign = lvHex(await lvHmac(secret, ts + key + "10000" + (method === "GET" ? query : bodyStr), "SHA-256"));
  const r = await lvFetch(f, `https://api.bybit.com${path}${method === "GET" && query ? `?${query}` : ""}`, {
    method,
    headers: { "X-BAPI-API-KEY": key, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": "10000", "X-BAPI-SIGN": sign, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: bodyStr } : {}),
  });
  if (!r) return lvNoConn("Bybit");
  const code = r.j?.retCode === undefined ? null : Number(r.j.retCode);
  return { ok: r.status < 400 && code === 0, code, msg: String(r.j?.retMsg ?? lvBad(r)), data: r.j?.result };
}
const bybit: LvAdapter = {
  async balance(f, k, s) {
    const r = await byCall(f, "GET", "/v5/account/wallet-balance", { accountType: "UNIFIED", coin: "USDT" }, null, k, s);
    const d: any = (r.data as any)?.list?.[0];
    return { ok: r.ok && !!d, available: lvN(d?.totalAvailableBalance) || lvN(d?.coin?.[0]?.availableToWithdraw), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const r = await byCall(f, "GET", "/v5/market/instruments-info", { category: "linear", symbol }, null, k, s);
    const d: any = (r.data as any)?.list?.[0];
    if (!r.ok || !d) return null;
    const step = lvN(d.lotSizeFilter?.qtyStep);
    const minQty = lvN(d.lotSizeFilter?.minOrderQty);
    if (!(step > 0) || !(minQty > 0)) return null;
    return { symbol, minQty, qtyStep: step, qtyDecimals: lvDec(step), maxLeverage: lvN(d.leverageFilter?.maxLeverage) || 20, priceDecimals: lvDec(lvN(d.priceFilter?.tickSize)) };
  },
  async positions(f, k, s) {
    const r = await byCall(f, "GET", "/v5/position/list", { category: "linear", settleCoin: "USDT", limit: 200 }, null, k, s);
    if (!r.ok) return null;
    return (((r.data as any)?.list ?? []) as any[]).filter((p) => lvN(p.size) > 0).map((p) => ({ symbol: String(p.symbol), qty: lvN(p.size), positionId: String(p.symbol), raw: p }));
  },
  async setup(f, k, s, symbol, leverage) {
    const warn: string[] = [];
    const lv = String(leverage);
    const m = await byCall(f, "POST", "/v5/position/switch-isolated", {}, { category: "linear", symbol, tradeMode: 1, buyLeverage: lv, sellLeverage: lv }, k, s);
    if (!m.ok && m.code !== 110026) warn.push(`margen aislado: ${m.msg || m.code}`);
    const l = await byCall(f, "POST", "/v5/position/set-leverage", {}, { category: "linear", symbol, buyLeverage: lv, sellLeverage: lv }, k, s);
    if (!l.ok && l.code !== 110043) warn.push(`apalancamiento: ${l.msg || l.code}`);
    return warn;
  },
  order: (sig, qty, clientId, pair) => ({
    category: "linear",
    symbol: sig.symbol,
    side: sig.direction === "LONG" ? "Buy" : "Sell",
    orderType: "Market",
    qty: String(qty),
    takeProfit: String(lvPx(sig.tp, pair.priceDecimals)),
    stopLoss: String(lvPx(sig.sl, pair.priceDecimals)),
    tpslMode: "Full",
    tpTriggerBy: "MarkPrice",
    slTriggerBy: "MarkPrice",
    tpOrderType: "Market",
    slOrderType: "Market",
    orderLinkId: lvId(clientId, 36),
    positionIdx: 0,
  }),
  place: (f, k, s, body) => byCall(f, "POST", "/v5/order/create", {}, body, k, s),
  close: (f, k, s, p) => byCall(f, "POST", "/v5/order/create", {}, { category: "linear", symbol: p.symbol, side: p.raw?.side === "Sell" ? "Buy" : "Sell", orderType: "Market", qty: String(p.qty), reduceOnly: true, positionIdx: Number(p.raw?.positionIdx) || 0 }, k, s),
  cancelAll: (f, k, s) => byCall(f, "POST", "/v5/order/cancel-all", {}, { category: "linear", settleCoin: "USDT" }, k, s),
};

// ─── OKX (v5, perpetuos) ────────────────────────────────────────────────────
// Las cuentas europeas (EEA) usan otro dominio: se prueba primero ese y, si la clave no es de ese entorno, el global.

const OKX_BASES = ["https://eea.okx.com", "https://www.okx.com"];
const okxInst = (symbol: string) => (symbol.includes("-") ? symbol : symbol.replace(/(USDT|USDC)$/, "-$1") + "-SWAP");
const okxFrom = (instId: string) => instId.replace(/-SWAP$/, "").replace(/-/g, "");

async function okCall(f: FetchFn, method: "GET" | "POST", path: string, params: Record<string, string | number>, body: unknown, packed: string, key: string): Promise<LvReply> {
  const [secret, pass] = lvSplit(packed);
  const query = lvQs(params);
  const full = `${path}${method === "GET" && query ? `?${query}` : ""}`;
  const bodyStr = body ? JSON.stringify(body) : "";
  let last: LvReply = lvNoConn("OKX");
  for (const base of OKX_BASES) {
    const ts = new Date().toISOString();
    const sign = lvB64(await lvHmac(secret, ts + method + full + bodyStr, "SHA-256"));
    const r = await lvFetch(f, `${base}${full}`, {
      method,
      headers: { "OK-ACCESS-KEY": key, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": pass, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: bodyStr } : {}),
    });
    if (!r) {
      last = lvNoConn("OKX");
      if (method === "POST") return last; // un envío que pudo salir no se repite
      continue;
    }
    const code = r.j?.code === undefined ? null : Number(r.j.code);
    let ok = r.status < 400 && code === 0;
    let msg = String(r.j?.msg ?? lvBad(r));
    let c = code;
    const first = Array.isArray(r.j?.data) ? r.j.data[0] : null;
    if (ok && first && first.sCode !== undefined && String(first.sCode) !== "0") {
      ok = false;
      msg = String(first.sMsg ?? msg);
      c = Number(first.sCode);
    }
    last = { ok, code: c, msg, data: r.j?.data };
    // 50101 / 50100: la clave es de otro dominio (europeo o global). El pedido fue rechazado, se puede probar en el otro.
    if (code !== 50101 && code !== 50100) return last;
  }
  return last;
}
async function okCtVal(f: FetchFn, k: string, s: string, instId: string): Promise<{ cs: number; d: any } | null> {
  const r = await okCall(f, "GET", "/api/v5/public/instruments", { instType: "SWAP", instId }, null, s, k);
  const d: any = (r.data as any[])?.[0];
  const cs = lvN(d?.ctVal) * (lvN(d?.ctMult) || 1);
  return r.ok && d && cs > 0 ? { cs, d } : null;
}
const okx: LvAdapter = {
  async balance(f, k, s) {
    const r = await okCall(f, "GET", "/api/v5/account/balance", { ccy: "USDT" }, null, s, k);
    const d: any = (r.data as any[])?.[0];
    const det = (d?.details ?? []).find((x: any) => x.ccy === "USDT");
    return { ok: r.ok && !!d, available: lvN(det?.availBal), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const x = await okCtVal(f, k, s, okxInst(symbol));
    if (!x) return null;
    const step = lvN(x.d.lotSz) * x.cs;
    const minQty = lvN(x.d.minSz) * x.cs;
    if (!(step > 0) || !(minQty > 0)) return null;
    return { symbol, minQty, qtyStep: step, qtyDecimals: lvDec(step), maxLeverage: lvN(x.d.lever) || 20, priceDecimals: lvDec(lvN(x.d.tickSz)), contractSize: x.cs };
  },
  async positions(f, k, s) {
    const r = await okCall(f, "GET", "/api/v5/account/positions", { instType: "SWAP" }, null, s, k);
    if (!r.ok) return null;
    const out: LvPos[] = [];
    const sizes: Record<string, number> = {};
    for (const p of (r.data as any[]) ?? []) {
      const n = Math.abs(lvN(p.pos));
      if (!(n > 0)) continue;
      const id = String(p.instId);
      if (!(id in sizes)) sizes[id] = (await okCtVal(f, k, s, id))?.cs ?? 0;
      out.push({ symbol: okxFrom(id), qty: Number((n * sizes[id]).toFixed(12)), positionId: id, raw: p });
    }
    return out;
  },
  async setup(f, k, s, symbol, leverage) {
    const warn: string[] = [];
    const cfg = await okCall(f, "GET", "/api/v5/account/config", {}, null, s, k);
    if ((cfg.data as any[])?.[0]?.posMode === "long_short_mode") {
      const m = await okCall(f, "POST", "/api/v5/account/set-position-mode", {}, { posMode: "net_mode" }, s, k);
      if (!m.ok) warn.push(`modo de posición neto: ${m.msg || m.code}`);
    }
    const l = await okCall(f, "POST", "/api/v5/account/set-leverage", {}, { instId: okxInst(symbol), lever: String(leverage), mgnMode: "isolated" }, s, k);
    if (!l.ok) warn.push(`apalancamiento: ${l.msg || l.code}`);
    return warn;
  },
  order: (sig, qty, clientId, pair) => ({
    instId: okxInst(sig.symbol),
    tdMode: "isolated",
    side: sig.direction === "LONG" ? "buy" : "sell",
    ordType: "market",
    sz: String(Math.round(qty / (pair.contractSize || 1))),
    clOrdId: lvId(clientId, 32),
    attachAlgoOrds: [{ tpTriggerPx: String(lvPx(sig.tp, pair.priceDecimals)), tpOrdPx: "-1", tpTriggerPxType: "mark", slTriggerPx: String(lvPx(sig.sl, pair.priceDecimals)), slOrdPx: "-1", slTriggerPxType: "mark" }],
  }),
  place: (f, k, s, body) => okCall(f, "POST", "/api/v5/trade/order", {}, body, s, k),
  close: (f, k, s, p) => okCall(f, "POST", "/api/v5/trade/close-position", {}, { instId: p.positionId, mgnMode: "isolated", ...(p.raw?.posSide && p.raw.posSide !== "net" ? { posSide: p.raw.posSide } : {}) }, s, k),
  async cancelAll(f, k, s) {
    let ok = true;
    let msg = "";
    const pend = await okCall(f, "GET", "/api/v5/trade/orders-pending", { instType: "SWAP" }, null, s, k);
    if (!pend.ok) ok = false;
    const orders = ((pend.data as any[]) ?? []).map((o) => ({ instId: o.instId, ordId: o.ordId }));
    if (orders.length) {
      const c = await okCall(f, "POST", "/api/v5/trade/cancel-batch-orders", {}, orders, s, k);
      if (!c.ok) (ok = false), (msg = c.msg);
    }
    for (const ordType of ["conditional", "oco"]) {
      const al = await okCall(f, "GET", "/api/v5/trade/orders-algo-pending", { ordType }, null, s, k);
      if (!al.ok) {
        ok = false;
        continue;
      }
      const algos = ((al.data as any[]) ?? []).map((o) => ({ algoId: o.algoId, instId: o.instId }));
      if (algos.length) {
        const c = await okCall(f, "POST", "/api/v5/trade/cancel-algos", {}, algos, s, k);
        if (!c.ok) (ok = false), (msg = c.msg);
      }
    }
    return { ok, msg: msg || pend.msg, code: pend.code };
  },
};

// ─── Bitget (mix v2, USDT-FUTURES) ──────────────────────────────────────────

async function bgCall(f: FetchFn, method: "GET" | "POST", path: string, params: Record<string, string | number>, body: unknown, packed: string, key: string): Promise<LvReply> {
  const [secret, pass] = lvSplit(packed);
  const query = lvQs(lvSorted(params));
  const full = `${path}${method === "GET" && query ? `?${query}` : ""}`;
  const bodyStr = body ? JSON.stringify(body) : "";
  const ts = String(Date.now());
  const sign = lvB64(await lvHmac(secret, ts + method + full + bodyStr, "SHA-256"));
  const r = await lvFetch(f, `https://api.bitget.com${full}`, {
    method,
    headers: { "ACCESS-KEY": key, "ACCESS-SIGN": sign, "ACCESS-TIMESTAMP": ts, "ACCESS-PASSPHRASE": pass, "Content-Type": "application/json", locale: "en-US" },
    ...(method === "POST" ? { body: bodyStr } : {}),
  });
  if (!r) return lvNoConn("Bitget");
  const code = r.j?.code === undefined ? null : Number(r.j.code);
  return { ok: r.status < 400 && String(r.j?.code) === "00000", code, msg: String(r.j?.msg ?? lvBad(r)), data: r.j?.data };
}
const BG = "USDT-FUTURES";
const bitget: LvAdapter = {
  async balance(f, k, s) {
    const r = await bgCall(f, "GET", "/api/v2/mix/account/accounts", { productType: BG }, null, s, k);
    const d: any = ((r.data as any[]) ?? []).find((x) => x.marginCoin === "USDT");
    return { ok: r.ok && !!d, available: lvN(d?.available), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const r = await bgCall(f, "GET", "/api/v2/mix/market/contracts", { productType: BG, symbol }, null, s, k);
    const d: any = ((r.data as any[]) ?? []).find((x) => String(x.symbol).toUpperCase() === symbol.toUpperCase());
    if (!r.ok || !d) return null;
    const qtyDecimals = Number(d.volumePlace);
    const step = lvN(d.sizeMultiplier) || 10 ** -qtyDecimals;
    const minQty = lvN(d.minTradeNum);
    if (!(step > 0) || !(minQty > 0) || !Number.isInteger(qtyDecimals)) return null;
    return { symbol, minQty, qtyStep: step, qtyDecimals, maxLeverage: lvN(d.maxLever) || 20, priceDecimals: Number.isInteger(Number(d.pricePlace)) ? Number(d.pricePlace) : null };
  },
  async positions(f, k, s) {
    const r = await bgCall(f, "GET", "/api/v2/mix/position/all-position", { productType: BG, marginCoin: "USDT" }, null, s, k);
    if (!r.ok) return null;
    return ((r.data as any[]) ?? []).filter((p) => lvN(p.total) > 0).map((p) => ({ symbol: String(p.symbol), qty: lvN(p.total), positionId: `${p.symbol}:${p.holdSide}`, raw: p }));
  },
  async setup(f, k, s, symbol, leverage) {
    const warn: string[] = [];
    // Las órdenes se mandan en modo «hedge» (abrir/cerrar): se pide ese modo; si hay posiciones abiertas puede no dejar cambiarlo.
    const pm = await bgCall(f, "POST", "/api/v2/mix/account/set-position-mode", {}, { productType: BG, posMode: "hedge_mode" }, s, k);
    if (!pm.ok) warn.push(`modo de posición: ${pm.msg || pm.code}`);
    const m = await bgCall(f, "POST", "/api/v2/mix/account/set-margin-mode", {}, { symbol, productType: BG, marginCoin: "USDT", marginMode: "isolated" }, s, k);
    if (!m.ok) warn.push(`margen aislado: ${m.msg || m.code}`);
    const l = await bgCall(f, "POST", "/api/v2/mix/account/set-leverage", {}, { symbol, productType: BG, marginCoin: "USDT", leverage: String(leverage) }, s, k);
    if (!l.ok) warn.push(`apalancamiento: ${l.msg || l.code}`);
    return warn;
  },
  order: (sig, qty, clientId, pair) => ({
    symbol: sig.symbol,
    productType: BG,
    marginMode: "isolated",
    marginCoin: "USDT",
    size: String(qty),
    side: sig.direction === "LONG" ? "buy" : "sell",
    tradeSide: "open",
    orderType: "market",
    clientOid: lvId(clientId, 40),
    presetStopSurplusPrice: String(lvPx(sig.tp, pair.priceDecimals)),
    presetStopLossPrice: String(lvPx(sig.sl, pair.priceDecimals)),
  }),
  place: (f, k, s, body) => bgCall(f, "POST", "/api/v2/mix/order/place-order", {}, body, s, k),
  close: (f, k, s, p) => bgCall(f, "POST", "/api/v2/mix/order/close-positions", {}, { symbol: p.symbol, productType: BG, holdSide: p.raw?.holdSide }, s, k),
  async cancelAll(f, k, s) {
    const a = await bgCall(f, "POST", "/api/v2/mix/order/cancel-all-orders", {}, { productType: BG, marginCoin: "USDT" }, s, k);
    const b = await bgCall(f, "POST", "/api/v2/mix/order/cancel-plan-order", {}, { productType: BG, marginCoin: "USDT" }, s, k);
    return a.ok && b.ok ? a : { ...(a.ok ? b : a), ok: false };
  },
};

// ─── BingX (swap v2) ────────────────────────────────────────────────────────

const bxSym = (symbol: string) => (symbol.includes("-") ? symbol : symbol.replace(/(USDT|USDC)$/, "-$1"));
const bxFrom = (symbol: string) => symbol.replace(/-/g, "");
async function bnxCall(f: FetchFn, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number>, key: string, secret: string): Promise<LvReply> {
  const all = lvSorted({ ...params, recvWindow: 10000, timestamp: Date.now() });
  const raw = Object.entries(all).map(([k, v]) => `${k}=${v}`).join("&");
  const sign = lvHex(await lvHmac(secret, raw, "SHA-256"));
  const r = await lvFetch(f, `https://open-api.bingx.com${path}?${lvQs(all)}&signature=${sign}`, { method, headers: { "X-BX-APIKEY": key } });
  if (!r) return lvNoConn("BingX");
  const code = r.j?.code === undefined ? null : Number(r.j.code);
  return { ok: r.status < 400 && code === 0, code, msg: String(r.j?.msg ?? lvBad(r)), data: r.j?.data };
}
const bingx: LvAdapter = {
  async balance(f, k, s) {
    const r = await bnxCall(f, "GET", "/openApi/swap/v2/user/balance", {}, k, s);
    const d: any = (r.data as any)?.balance;
    return { ok: r.ok && !!d, available: lvN(d?.availableMargin), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const r = await bnxCall(f, "GET", "/openApi/swap/v2/quote/contracts", { symbol: bxSym(symbol) }, k, s);
    const d: any = ((r.data as any[]) ?? []).find((x) => String(x.symbol).toUpperCase() === bxSym(symbol).toUpperCase());
    if (!r.ok || !d) return null;
    const qtyDecimals = Number(d.quantityPrecision);
    const minQty = lvN(d.tradeMinQuantity);
    if (!Number.isInteger(qtyDecimals) || qtyDecimals < 0 || qtyDecimals > 12 || !(minQty > 0)) return null;
    return { symbol, minQty, qtyDecimals, maxLeverage: 20, priceDecimals: Number.isInteger(Number(d.pricePrecision)) ? Number(d.pricePrecision) : null };
  },
  async positions(f, k, s) {
    const r = await bnxCall(f, "GET", "/openApi/swap/v2/user/positions", {}, k, s);
    if (!r.ok) return null;
    return ((r.data as any[]) ?? []).filter((p) => Math.abs(lvN(p.positionAmt)) > 0).map((p) => ({ symbol: bxFrom(String(p.symbol)), qty: Math.abs(lvN(p.positionAmt)), positionId: String(p.positionId), raw: p }));
  },
  async setup(f, k, s, symbol, leverage) {
    const warn: string[] = [];
    const sym = bxSym(symbol);
    const m = await bnxCall(f, "POST", "/openApi/swap/v2/trade/marginType", { symbol: sym, marginType: "ISOLATED" }, k, s);
    if (!m.ok) warn.push(`margen aislado: ${m.msg || m.code}`);
    for (const side of ["LONG", "SHORT"]) {
      const l = await bnxCall(f, "POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side, leverage }, k, s);
      if (!l.ok) warn.push(`apalancamiento ${side}: ${l.msg || l.code}`);
    }
    return warn;
  },
  order: (sig, qty, clientId, pair) => {
    const stop = (type: string, px: number) => JSON.stringify({ type, stopPrice: lvPx(px, pair.priceDecimals), workingType: "MARK_PRICE" });
    return {
      symbol: bxSym(sig.symbol),
      type: "MARKET",
      side: sig.direction === "LONG" ? "BUY" : "SELL",
      positionSide: sig.direction,
      quantity: qty,
      clientOrderID: lvId(clientId, 40),
      takeProfit: stop("TAKE_PROFIT_MARKET", sig.tp),
      stopLoss: stop("STOP_MARKET", sig.sl),
    };
  },
  place: (f, k, s, body) => bnxCall(f, "POST", "/openApi/swap/v2/trade/order", body as Record<string, string | number>, k, s),
  close: (f, k, s, p) => bnxCall(f, "POST", "/openApi/swap/v2/trade/closePosition", { positionId: p.positionId }, k, s),
  cancelAll: (f, k, s) => bnxCall(f, "DELETE", "/openApi/swap/v2/trade/allOpenOrders", {}, k, s),
};

// ─── Gate (futuros USDT v4) ─────────────────────────────────────────────────
// El tamaño va en contratos con signo (positivo compra, negativo venta). Stop y objetivo son dos órdenes por disparador aparte.

const gtSym = (symbol: string) => (symbol.includes("_") ? symbol : symbol.replace(/(USDT|USDC)$/, "_$1"));
const gtFrom = (symbol: string) => symbol.replace(/_/g, "");
async function gtCall(f: FetchFn, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number>, body: unknown, key: string, secret: string): Promise<LvReply> {
  const query = lvQs(params);
  const bodyStr = body ? JSON.stringify(body) : "";
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = lvHex(await lvHmac(secret, [method, `/api/v4${path}`, query, await lvSha512(bodyStr), ts].join("\n"), "SHA-512"));
  const r = await lvFetch(f, `https://api.gateio.ws/api/v4${path}${query ? `?${query}` : ""}`, {
    method,
    headers: { KEY: key, Timestamp: ts, SIGN: sign, Accept: "application/json", "Content-Type": "application/json" },
    ...(method === "POST" ? { body: bodyStr } : {}),
  });
  if (!r) return lvNoConn("Gate");
  const failed = r.status >= 400 || typeof r.j?.label === "string";
  return { ok: !failed && r.j !== null, code: null, msg: String(r.j?.message ?? r.j?.label ?? lvBad(r)), data: r.j };
}
const gtMult = async (f: FetchFn, k: string, s: string, contract: string) => {
  const r = await gtCall(f, "GET", `/futures/usdt/contracts/${contract}`, {}, null, k, s);
  const d: any = r.data;
  return r.ok && lvN(d?.quanto_multiplier) > 0 ? { cs: lvN(d.quanto_multiplier), d } : null;
};
const gtClose = (f: FetchFn, k: string, s: string, contract: string) => gtCall(f, "POST", "/futures/usdt/orders", {}, { contract, size: 0, close: true, price: "0", tif: "ioc" }, k, s);
const gate: LvAdapter = {
  async balance(f, k, s) {
    const r = await gtCall(f, "GET", "/futures/usdt/accounts", {}, null, k, s);
    const d: any = r.data;
    return { ok: r.ok && d != null && d.available !== undefined, available: lvN(d?.available), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const x = await gtMult(f, k, s, gtSym(symbol));
    if (!x) return null;
    const minQty = (lvN(x.d.order_size_min) || 1) * x.cs;
    return { symbol, minQty, qtyStep: x.cs, qtyDecimals: lvDec(x.cs), maxLeverage: lvN(x.d.leverage_max) || 20, priceDecimals: lvDec(lvN(x.d.order_price_round)), contractSize: x.cs };
  },
  async positions(f, k, s) {
    const r = await gtCall(f, "GET", "/futures/usdt/positions", {}, null, k, s);
    if (!r.ok || !Array.isArray(r.data)) return null;
    const out: LvPos[] = [];
    for (const p of r.data as any[]) {
      const size = lvN(p.size);
      if (!size) continue;
      const m = await gtMult(f, k, s, String(p.contract));
      out.push({ symbol: gtFrom(String(p.contract)), qty: Number((Math.abs(size) * (m?.cs ?? 0)).toFixed(12)), positionId: String(p.contract), raw: p });
    }
    return out;
  },
  async setup(f, k, s, symbol, leverage) {
    // Con apalancamiento mayor que cero el margen queda aislado.
    const l = await gtCall(f, "POST", `/futures/usdt/positions/${gtSym(symbol)}/leverage`, { leverage }, null, k, s);
    return l.ok ? [] : [`apalancamiento: ${l.msg || l.code}`];
  },
  order: (sig, qty, clientId, pair) => {
    const long = sig.direction === "LONG";
    const n = Math.round(qty / (pair.contractSize || 1));
    const contract = gtSym(sig.symbol);
    const trig = (price: number, rule: 1 | 2) => ({ initial: { contract, size: 0, close: true, price: "0", tif: "ioc" }, trigger: { strategy_type: 0, price_type: 1, price: String(lvPx(price, pair.priceDecimals)), rule, expiration: 2592000 } });
    return { contract, size: long ? n : -n, price: "0", tif: "ioc", text: `t-${lvId(clientId, 26)}`, _after: [trig(sig.sl, long ? 2 : 1), trig(sig.tp, long ? 1 : 2)] };
  },
  async place(f, k, s, body) {
    const { _after, ...main } = body as any;
    const r = await gtCall(f, "POST", "/futures/usdt/orders", {}, main, k, s);
    if (!r.ok) return r;
    for (const t of (_after as unknown[]) ?? []) {
      const q = await gtCall(f, "POST", "/futures/usdt/price_orders", {}, t, k, s);
      if (!q.ok) {
        await gtClose(f, k, s, String(main.contract));
        return { ok: false, code: null, msg: `No se pudo colocar el stop o el objetivo (${q.msg}): se cerró la posición.` };
      }
    }
    return r;
  },
  close: (f, k, s, p) => gtClose(f, k, s, p.positionId),
  async cancelAll(f, k, s) {
    const pos = await gate.positions(f, k, s);
    if (pos == null) return { ok: false, code: null, msg: "No se pudieron leer las posiciones." };
    let ok = true;
    let msg = "";
    for (const p of pos) {
      for (const path of ["/futures/usdt/price_orders", "/futures/usdt/orders"]) {
        const c = await gtCall(f, "DELETE", path, { contract: p.positionId }, null, k, s);
        if (!c.ok) (ok = false), (msg = c.msg);
      }
    }
    return { ok, code: null, msg };
  },
};

// ─── KuCoin (futuros, contratos USDTM) ──────────────────────────────────────
// El tamaño va en lotes (cada lote vale «multiplier» de la moneda base). Stop y objetivo son órdenes condicionales aparte.

const kcSym = (symbol: string) => (symbol.endsWith("USDTM") ? symbol : symbol.replace(/^BTC/, "XBT").replace(/USDT$/, "USDTM"));
const kcFrom = (symbol: string) => symbol.replace(/^XBT/, "BTC").replace(/USDTM$/, "USDT");
async function kcCall(f: FetchFn, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number>, body: unknown, packed: string, key: string): Promise<LvReply> {
  const [secret, pass] = lvSplit(packed);
  const query = lvQs(params);
  const full = `${path}${query ? `?${query}` : ""}`;
  const bodyStr = body ? JSON.stringify(body) : "";
  const ts = String(Date.now());
  const sign = lvB64(await lvHmac(secret, ts + method + full + bodyStr, "SHA-256"));
  const passSigned = lvB64(await lvHmac(secret, pass, "SHA-256"));
  const r = await lvFetch(f, `https://api-futures.kucoin.com${full}`, {
    method,
    headers: { "KC-API-KEY": key, "KC-API-SIGN": sign, "KC-API-TIMESTAMP": ts, "KC-API-PASSPHRASE": passSigned, "KC-API-KEY-VERSION": "2", "Content-Type": "application/json" },
    ...(method === "POST" ? { body: bodyStr } : {}),
  });
  if (!r) return lvNoConn("KuCoin");
  const code = r.j?.code === undefined ? null : Number(r.j.code);
  return { ok: r.status < 400 && code === 200000, code, msg: String(r.j?.msg ?? lvBad(r)), data: r.j?.data };
}
const kcMult = async (f: FetchFn, k: string, s: string, symbol: string) => {
  const r = await kcCall(f, "GET", `/api/v1/contracts/${symbol}`, {}, null, s, k);
  const d: any = r.data;
  return r.ok && lvN(d?.multiplier) > 0 ? { m: lvN(d.multiplier), d } : null;
};
const kcCloseOrder = (f: FetchFn, k: string, s: string, symbol: string, side: "buy" | "sell") =>
  kcCall(f, "POST", "/api/v1/orders", {}, { clientOid: lvId(`vxclose${Date.now()}`, 32), symbol, side, type: "market", closeOrder: true }, s, k);
const kucoin: LvAdapter = {
  async balance(f, k, s) {
    const r = await kcCall(f, "GET", "/api/v1/account-overview", { currency: "USDT" }, null, s, k);
    const d: any = r.data;
    return { ok: r.ok && d != null, available: lvN(d?.availableBalance), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const x = await kcMult(f, k, s, kcSym(symbol));
    if (!x) return null;
    const step = (lvN(x.d.lotSize) || 1) * x.m;
    return { symbol, minQty: step, qtyStep: step, qtyDecimals: lvDec(step), maxLeverage: lvN(x.d.maxLeverage) || 20, priceDecimals: lvDec(lvN(x.d.tickSize)), contractSize: x.m };
  },
  async positions(f, k, s) {
    const r = await kcCall(f, "GET", "/api/v1/positions", {}, null, s, k);
    if (!r.ok) return null;
    const out: LvPos[] = [];
    for (const p of (Array.isArray(r.data) ? r.data : []) as any[]) {
      const lots = lvN(p.currentQty);
      if (!lots) continue;
      const m = await kcMult(f, k, s, String(p.symbol));
      out.push({ symbol: kcFrom(String(p.symbol)), qty: Number((Math.abs(lots) * (m?.m ?? 0)).toFixed(12)), positionId: String(p.symbol), raw: p });
    }
    return out;
  },
  async setup(f, k, s, symbol) {
    const m = await kcCall(f, "POST", "/api/v2/position/changeMarginMode", {}, { symbol: kcSym(symbol), marginMode: "ISOLATED" }, s, k);
    return m.ok ? [] : [`margen aislado: ${m.msg || m.code}`];
  },
  order: (sig, qty, clientId, pair, leverage) => {
    const long = sig.direction === "LONG";
    const symbol = kcSym(sig.symbol);
    const cond = (px: number, stop: "up" | "down") => ({ clientOid: lvId(`${clientId}${stop}`, 32), symbol, side: long ? "sell" : "buy", type: "market", closeOrder: true, stop, stopPriceType: "MP", stopPrice: String(lvPx(px, pair.priceDecimals)) });
    return {
      clientOid: lvId(clientId, 32),
      symbol,
      side: long ? "buy" : "sell",
      type: "market",
      size: Math.round(qty / (pair.contractSize || 1)),
      leverage,
      marginMode: "ISOLATED",
      _after: [cond(sig.sl, long ? "down" : "up"), cond(sig.tp, long ? "up" : "down")],
    };
  },
  async place(f, k, s, body) {
    const { _after, ...main } = body as any;
    const r = await kcCall(f, "POST", "/api/v1/orders", {}, main, s, k);
    if (!r.ok) return r;
    for (const t of (_after as unknown[]) ?? []) {
      const q = await kcCall(f, "POST", "/api/v1/orders", {}, t, s, k);
      if (!q.ok) {
        await kcCloseOrder(f, k, s, String(main.symbol), main.side === "buy" ? "sell" : "buy");
        await kcCall(f, "DELETE", "/api/v1/stopOrders", { symbol: String(main.symbol) }, null, s, k);
        return { ok: false, code: q.code, msg: `No se pudo colocar el stop o el objetivo (${q.msg || q.code}): se cerró la posición.` };
      }
    }
    return r;
  },
  close: (f, k, s, p) => kcCloseOrder(f, k, s, p.positionId, lvN(p.raw?.currentQty) > 0 ? "sell" : "buy"),
  async cancelAll(f, k, s) {
    const a = await kcCall(f, "DELETE", "/api/v1/orders", {}, null, s, k);
    const b = await kcCall(f, "DELETE", "/api/v1/stopOrders", {}, null, s, k);
    return a.ok && b.ok ? a : { ...(a.ok ? b : a), ok: false };
  },
};

// ─── Binance (futuros USDⓈ-M) ───────────────────────────────────────────────
// Stop y objetivo van como órdenes condicionales aparte (cierran la posición entera).

async function bnCall(f: FetchFn, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number>, key: string, secret: string): Promise<LvReply> {
  const all = lvSorted({ ...params, recvWindow: 10000, timestamp: Date.now() });
  const q = lvQs(all);
  const sign = lvHex(await lvHmac(secret, q, "SHA-256"));
  const r = await lvFetch(f, `https://fapi.binance.com${path}?${q}&signature=${sign}`, { method, headers: { "X-MBX-APIKEY": key } });
  if (!r) return lvNoConn("Binance");
  const code = typeof r.j?.code === "number" ? r.j.code : null;
  return { ok: r.status < 400 && r.j !== null && !(code !== null && code < 0), code, msg: String(r.j?.msg ?? lvBad(r)), data: r.j };
}
const bnClose = (f: FetchFn, k: string, s: string, symbol: string, side: "BUY" | "SELL", qty: number | string) => bnCall(f, "POST", "/fapi/v1/order", { symbol, side, type: "MARKET", quantity: String(qty), reduceOnly: "true" }, k, s);
const binance: LvAdapter = {
  async balance(f, k, s) {
    const r = await bnCall(f, "GET", "/fapi/v2/balance", {}, k, s);
    const d: any = Array.isArray(r.data) ? (r.data as any[]).find((x) => x.asset === "USDT") : null;
    return { ok: r.ok && !!d, available: lvN(d?.availableBalance), msg: r.msg, code: r.code };
  },
  async pair(f, k, s, symbol) {
    const r = await bnCall(f, "GET", "/fapi/v1/exchangeInfo", {}, k, s);
    const d: any = ((r.data as any)?.symbols ?? []).find((x: any) => x.symbol === symbol.toUpperCase());
    if (!r.ok || !d) return null;
    const lot = (d.filters ?? []).find((x: any) => x.filterType === "LOT_SIZE");
    const tick = (d.filters ?? []).find((x: any) => x.filterType === "PRICE_FILTER");
    const step = lvN(lot?.stepSize);
    const minQty = lvN(lot?.minQty);
    if (!(step > 0) || !(minQty > 0)) return null;
    return { symbol, minQty, qtyStep: step, qtyDecimals: lvDec(step), maxLeverage: 20, priceDecimals: lvDec(lvN(tick?.tickSize)) };
  },
  async positions(f, k, s) {
    const r = await bnCall(f, "GET", "/fapi/v2/positionRisk", {}, k, s);
    if (!r.ok || !Array.isArray(r.data)) return null;
    return (r.data as any[]).filter((p) => lvN(p.positionAmt) !== 0).map((p) => ({ symbol: String(p.symbol), qty: Math.abs(lvN(p.positionAmt)), positionId: `${p.symbol}:${p.positionSide ?? "BOTH"}`, raw: p }));
  },
  async setup(f, k, s, symbol, leverage) {
    const warn: string[] = [];
    const dual = await bnCall(f, "GET", "/fapi/v1/positionSide/dual", {}, k, s);
    if ((dual.data as any)?.dualSidePosition === true) {
      const m = await bnCall(f, "POST", "/fapi/v1/positionSide/dual", { dualSidePosition: "false" }, k, s);
      if (!m.ok) warn.push(`modo de posición único: ${m.msg || m.code}`);
    }
    const m = await bnCall(f, "POST", "/fapi/v1/marginType", { symbol, marginType: "ISOLATED" }, k, s);
    if (!m.ok && m.code !== -4046) warn.push(`margen aislado: ${m.msg || m.code}`);
    const l = await bnCall(f, "POST", "/fapi/v1/leverage", { symbol, leverage }, k, s);
    if (!l.ok) warn.push(`apalancamiento: ${l.msg || l.code}`);
    return warn;
  },
  order: (sig, qty, clientId, pair) => {
    const opp = lvOpp(sig);
    const algo = (type: string, px: number) => ({ algoType: "CONDITIONAL", symbol: sig.symbol, side: opp, type, triggerPrice: String(lvPx(px, pair.priceDecimals)), closePosition: "true", workingType: "MARK_PRICE" });
    return { symbol: sig.symbol, side: sig.direction === "LONG" ? "BUY" : "SELL", type: "MARKET", quantity: String(qty), newClientOrderId: lvId(clientId, 36), _after: [algo("STOP_MARKET", sig.sl), algo("TAKE_PROFIT_MARKET", sig.tp)] };
  },
  async place(f, k, s, body) {
    const { _after, ...main } = body as any;
    const r = await bnCall(f, "POST", "/fapi/v1/order", main as Record<string, string | number>, k, s);
    if (!r.ok) return r;
    for (const t of (_after as Array<Record<string, string>>) ?? []) {
      const q = await bnCall(f, "POST", "/fapi/v1/algoOrder", t, k, s);
      if (!q.ok) {
        await bnClose(f, k, s, String(main.symbol), t.side as "BUY" | "SELL", main.quantity as string);
        await bnCall(f, "DELETE", "/fapi/v1/algoOpenOrders", { symbol: String(main.symbol) }, k, s);
        return { ok: false, code: q.code, msg: `No se pudo colocar el stop o el objetivo (${q.msg || q.code}): se cerró la posición.` };
      }
    }
    return r;
  },
  close: (f, k, s, p) => bnClose(f, k, s, p.symbol, lvN(p.raw?.positionAmt) > 0 ? "SELL" : "BUY", p.qty),
  async cancelAll(f, k, s) {
    const pos = await binance.positions(f, k, s);
    if (pos == null) return { ok: false, code: null, msg: "No se pudieron leer las posiciones." };
    let ok = true;
    let msg = "";
    for (const p of pos) {
      for (const path of ["/fapi/v1/allOpenOrders", "/fapi/v1/algoOpenOrders"]) {
        const c = await bnCall(f, "DELETE", path, { symbol: p.symbol }, k, s);
        if (!c.ok) (ok = false), (msg = c.msg);
      }
    }
    return { ok, code: null, msg };
  },
};

export const LV_ADAPTERS = { binance, bybit, okx, bitget, bingx, gate, kucoin } as const;
export type LvExchangeId = keyof typeof LV_ADAPTERS;
